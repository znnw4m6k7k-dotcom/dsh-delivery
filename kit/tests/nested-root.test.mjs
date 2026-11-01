// 修复 1：bash 守卫和证据记录定位到正确的项目（工作区里同时有多个交付项目）
// 场景来自 2026-11-01 新手试跑：会话工作区根目录本身就是项目 A（奶茶店，冻结 v1.4），
// 子目录装修报价单模板是项目 B（冻结 v7）。命令 `cd 装修报价单模板 && pytest` 的证据
// 以前全被记进了 A，导致 B 没有 evidence.jsonl、QA 计数和 R6 重跑拦截都失真。
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, apply, resolveCommandRoot } from '../bundle/index.js'

const SUB = '装修报价单模板'

/** 工作区根目录本身就是项目 A；子目录 SUB 是项目 B，两个都冻结了版本 */
function workspace() {
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-'))
  const B = path.join(A, SUB)
  fs.mkdirSync(path.join(B, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(B, 'tests', 'test_quote.py'), 'def test_ok():\n    assert True\n')
  for (const [root, version] of [[A, 'v1.4'], [B, 'v7']]) {
    fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
    fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({ version, files: [], test_commands: ['pytest'] }))
  }
  return { A, B }
}

const evidenceOf = (root) => {
  let text
  try { text = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8') } catch { return [] }
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}

/** 模拟 Host：run(command) 走 tools/pre-execute + tools/result，会话 cwd 固定为工作区根 A */
function host(cwd) {
  const handlers = {}
  const main = { id: 'main' }
  const ctx = {
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => (n === 'workingDirectory' ? { ensure: async () => cwd } : n === 'agents' ? { roots: () => [main] } : undefined),
  }
  apply(ctx)
  const next = async () => ({ kind: 'allow' })
  const run = async (command, output = '1 passed in 0.01s') => {
    const exec = { name: 'bash', agent: main, arguments: { command } }
    const r = await handlers['tools/pre-execute'](exec, next)
    if (r.kind === 'allow') handlers['tools/result'](exec, { isError: false, content: [{ type: 'text', text: output }] })
    return r
  }
  return { run }
}

test('resolveCommandRoot：cd 子项目 / 带引号 cd / 参数里的子项目路径都定位到 B', () => {
  const { A, B } = workspace()
  // 1) cd 链
  assert.equal(resolveCommandRoot(`cd ${SUB} && pytest`, A), B)
  assert.equal(resolveCommandRoot(`cd "${SUB}" && pytest`, A), B)
  // 2) 命令参数里真实存在的路径
  assert.equal(resolveCommandRoot(`pytest ${SUB}/tests`, A), B)
  assert.equal(resolveCommandRoot(`python3 -m pytest ${SUB}/tests -q`, A), B)
  assert.equal(resolveCommandRoot(`node --test ${SUB}/tests/*.test.py`, A), B)
  // 多个 cd：取执行测试命令之前的最后一个；测试命令后面的 cd 不算
  assert.equal(resolveCommandRoot(`cd . && cd ${SUB} && pytest`, A), B)
  assert.equal(resolveCommandRoot(`pytest && cd ${SUB}`, A), A)
  // 3) 都没有就退回会话 cwd
  assert.equal(resolveCommandRoot('pytest', A), A)
  assert.equal(resolveCommandRoot('pytest tests', A), A)
  assert.equal(resolveCommandRoot(undefined, A), A)
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-plain-'))
  assert.equal(resolveCommandRoot('pytest', plain), undefined)
})

test('证据记录：cd 子项目 / 带路径跑测试都记到 B，不污染根目录项目 A', async () => {
  for (const command of [
    `cd ${SUB} && pytest`,
    `cd "${SUB}" && pytest`,
    `pytest ${SUB}/tests`,
    `python3 -m pytest ${SUB}/tests -q`,
  ]) {
    const { A, B } = workspace()
    const { run } = host(A)
    assert.equal((await run(command)).kind, 'allow', command)
    assert.equal(evidenceOf(A).length, 0, `不应记到 A：${command}`)
    const lines = evidenceOf(B)
    assert.equal(lines.length, 1, `应记到 B：${command}`)
    assert.equal(lines[0].version, 'v7')
    assert.equal(lines[0].purpose, 'delivery')
  }
})

test('证据记录：在根目录直接 pytest 仍记到 A', async () => {
  const { A, B } = workspace()
  const { run } = host(A)
  assert.equal((await run('pytest')).kind, 'allow')
  assert.equal(evidenceOf(B).length, 0)
  const lines = evidenceOf(A)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].version, 'v1.4')
  assert.equal(lines[0].purpose, 'delivery')
})

test('R6 重跑拦截按命令实际作用的项目判断', async () => {
  const { A, B } = workspace()
  const { run } = host(A)
  // 第一次 cd 到 B 跑：放行并记到 B
  assert.equal((await run(`cd ${SUB} && pytest`)).kind, 'allow')
  // 同一冻结版本 v7 + 同一条命令原样再跑：按 B 的 evidence 拦
  const second = await run(`cd ${SUB} && pytest`)
  assert.equal(second.kind, 'deny')
  assert.match(second.reason, /同一个测试已经跑过/)
  assert.match(second.reason, /v7/)
  // 根目录项目 A 自己还没跑过，不受 B 的证据影响
  assert.equal((await run('pytest')).kind, 'allow')
  // 反过来 A 跑过之后，B 仍然按自己的版本判断（第一条 cd 命令已经记过，所以这里拦的是 B 自己）
  assert.equal(evidenceOf(B).length, 1)
})

test('守卫直接调用（evaluate）也按 B 的冻结版本判断 R1', () => {
  const { A, B } = workspace()
  fs.mkdirSync(path.join(B, 'out'), { recursive: true })
  fs.writeFileSync(path.join(B, 'out', 'plan.txt'), 'x')
  fs.writeFileSync(path.join(B, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v7', files: ['out/plan.txt'], test_commands: ['pytest'] }))
  // 子项目 B 的冻结文件：cd 到 B 改它，按 B 的版本号 v7 拦（而不是根目录 A 的 v1.4）
  assert.match(evaluate({ tool: 'bash', args: { command: `cd ${SUB} && echo hi > out/plan.txt` }, cwd: A }), /v7/)
  // 根目录 A 没冻结这个文件，在 A 里改同名相对路径不会被拦
  assert.equal(evaluate({ tool: 'bash', args: { command: 'echo hi > B-no-such.txt' }, cwd: A }), undefined)
})
