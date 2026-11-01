// 第 2 项：R6 原样重跑拦截的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, recordEvidence, apply } from '../bundle/index.js'

const CMD = 'node --test tests/*.test.mjs'

function project(version = 'v1', commands = [CMD]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tests'))
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({
    version,
    files: [],
    test_commands: commands,
  }))
  return root
}
const bash = (root, command, extra = {}) => evaluate({ tool: 'bash', args: { command }, cwd: root, ...extra })
const record = (root, command, agent = 'main') => recordEvidence(root, { agent, command, is_error: false, output: '# pass 3\n# fail 0' })

test('R6 第一次运行放行，同角色原样第二次被拦', () => {
  const root = project()
  assert.equal(bash(root, CMD), undefined)
  assert.equal(record(root, CMD), true)
  const reason = bash(root, CMD)
  assert.match(reason, /同一个测试已经跑过/)
  assert.match(reason, /retry_reason/)
})

test('R6 主 Agent 跑过之后，QA 子 Agent 第一次运行放行', () => {
  const root = project()
  assert.equal(record(root, CMD, 'main'), true)
  assert.equal(bash(root, CMD, { isRoot: false }), undefined)
  // 子 Agent 自己原样跑第二次仍然要拦
  assert.equal(record(root, CMD, 'subagent'), true)
  assert.match(bash(root, CMD, { isRoot: false }), /同一个测试已经跑过/)
  // 主 Agent 这边也照样拦
  assert.match(bash(root, CMD, { isRoot: true }), /同一个测试已经跑过/)
})

test('R6 带 # retry_reason 的命令放行，并把原因写进证据', () => {
  const root = project()
  assert.equal(record(root, CMD), true)
  const retry = `${CMD} # retry_reason: 换了 Node 版本，环境需要重跑`
  assert.equal(bash(root, retry), undefined)
  assert.equal(record(root, retry), true)
  const lines = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(lines.at(-1).retry_reason, '换了 Node 版本，环境需要重跑')
  assert.equal(lines.at(-1).purpose, 'delivery')
  // 带原因跑过之后，不带原因的原样重跑仍然被拦
  assert.match(bash(root, CMD), /同一个测试已经跑过/)
})

test('R6 不拦诊断运行、不拦别的版本、不拦别的角色之外的旧证据', () => {
  const root = project()
  // 诊断运行不是验收，不能挡住后面的验收运行
  assert.equal(record(root, 'node -e "console.log(1)"'), true)
  assert.equal(bash(root, CMD), undefined)
  assert.equal(record(root, CMD), true)
  // 旧证据没有 purpose 字段时不算交付运行（兼容 1.3.x 的记录）
  const root2 = project()
  fs.writeFileSync(path.join(root2, '.delivery', 'evidence.jsonl'), JSON.stringify({ version: 'v1', command: CMD, agent: 'main' }) + '\n')
  assert.equal(bash(root2, CMD), undefined)
  // 新版本要重新验收，可以再跑
  const root3 = project()
  assert.equal(record(root3, CMD), true)
  fs.writeFileSync(path.join(root3, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v2', files: [], test_commands: [CMD] }))
  assert.equal(bash(root3, CMD), undefined)
})

test('R6 不误伤只是提到命令名的排查命令，也不拦换了参数的测试命令', () => {
  // 冻结 npm test：grep / echo 只是提到命令名，不能算重跑验收，也不能记成 delivery
  const root = project('v1', ['npm test'])
  assert.equal(record(root, 'npm test'), true)
  assert.equal(bash(root, 'grep "npm test" package.json'), undefined)
  assert.equal(bash(root, 'echo "npm test"'), undefined)
  assert.equal(recordEvidence(root, { agent: 'main', command: 'grep "npm test" package.json', is_error: false, output: 'package.json:1:"npm test"' }), true)
  const lines = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(lines.at(-1).purpose, 'diagnostic')
  assert.equal(lines.at(-1).tests, null)
  assert.equal(lines.at(-1).count_unconfirmed, true)
  // 冻结 node --test：换一个测试文件是不同命令，不按“原样重跑”拦（但仍记 delivery，因为确实在跑测试）
  const root2 = project('v1', ['node --test'])
  assert.equal(record(root2, 'node --test'), true)
  assert.equal(bash(root2, 'node --test tests/other.test.mjs'), undefined)
})

test('R6 走 Host 事件时按 Agent 身份区分（模拟 apply）', async () => {
  const root = project()
  const handlers = {}
  const mainAgent = { id: 'main' }, qaAgent = { id: 'qa' }
  const ctx = {
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => n === 'workingDirectory' ? { ensure: async () => root } : n === 'agents' ? { roots: () => [mainAgent] } : undefined,
  }
  apply(ctx)
  const next = async () => ({ kind: 'allow' })
  const run = async (agent, command, output = '# pass 2\n# fail 0') => {
    const exec = { name: 'bash', agent, arguments: { command } }
    const r = await handlers['tools/pre-execute'](exec, next)
    if (r.kind === 'allow') handlers['tools/result'](exec, { isError: false, content: [{ type: 'text', text: output }] })
    return r
  }
  assert.equal((await run(mainAgent, CMD)).kind, 'allow')
  const second = await run(mainAgent, CMD)
  assert.equal(second.kind, 'deny')
  assert.match(second.reason, /^\[交付守卫\]/)
  assert.match(second.reason, /同一个测试已经跑过/)
  // 主 Agent 跑过不影响 QA 子 Agent 的第一次验收
  assert.equal((await run(qaAgent, CMD)).kind, 'allow')
})
