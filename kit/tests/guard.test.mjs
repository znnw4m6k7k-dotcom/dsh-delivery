// 运行：node --test kit/tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, recordEvidence, apply } from '../bundle/index.js'

function project(freeze, qa) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'out'))
  fs.writeFileSync(path.join(root, 'out', 'plan.docx'), 'x')
  if (freeze) fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify(freeze))
  if (qa) fs.writeFileSync(path.join(root, '.delivery', 'qa', `${freeze.version}.json`), JSON.stringify(qa))
  return root
}
const F = { version: 'v1.3', files: [{ path: 'out/plan.docx', sha256: 'aa' }], test_commands: ['python3 -m unittest tests'] }
const w = (root, file, content, extra = {}) => evaluate({ tool: 'write', args: { file_path: file, content }, cwd: root, ...extra })

test('没有 .delivery 的项目一律放行', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'))
  assert.equal(w(root, 'a.txt', 'x'), undefined)
  assert.equal(evaluate({ tool: 'bash', args: { command: 'rm -rf build' }, cwd: root }), undefined)
})

test('R1 等待验收时禁止修改冻结文件，QA 出结果后放行', () => {
  const root = project(F)
  assert.match(w(root, 'out/plan.docx', 'y'), /已冻结的版本 v1\.3/)
  assert.equal(w(root, 'out/other.md', 'y'), undefined)
  assert.match(evaluate({ tool: 'bash', args: { command: 'echo hi > out/plan.docx' }, cwd: root }), /冻结/)
  assert.equal(evaluate({ tool: 'bash', args: { command: 'cat out/plan.docx' }, cwd: root }), undefined)
  fs.writeFileSync(path.join(root, '.delivery', 'qa', 'v1.3.json'), '{"release_status":"blocked"}')
  assert.equal(w(root, 'out/plan.docx', 'y'), undefined)
})

test('R2 版本号不能倒退，已验收版本不能覆盖', () => {
  const root = project(F, { release_status: 'blocked' })
  assert.match(w(root, '.delivery/freeze.json', JSON.stringify({ ...F, version: 'v1.2' })), /只能递增/)
  assert.match(w(root, '.delivery/freeze.json', JSON.stringify(F)), /已有 QA 结论/)
  assert.equal(w(root, '.delivery/freeze.json', JSON.stringify({ ...F, version: 'v1.4' })), undefined)
  assert.equal(w(root, '.delivery/freeze.json', JSON.stringify({ ...F, version: 'v2' })), undefined)
})

test('R2 freeze.json 不能预填验收结论', () => {
  const root = project(F)
  assert.match(w(root, '.delivery/freeze.json', JSON.stringify({ ...F, version: 'v1.4', qa: { status: 'pending' } })), /不能包含验收结论/)
  assert.match(w(root, '.delivery/freeze.json', 'not json'), /合法 JSON/)
})

test('R2 edit 工具同样受约束', () => {
  const root = project(F, { release_status: 'blocked' })
  const r = evaluate({ tool: 'edit', args: { file_path: '.delivery/freeze.json', old_string: '"v1.3"', new_string: '"v1.1"' }, cwd: root })
  assert.match(r, /只能递增/)
})

test('R3 主 Agent 不能写 QA 结论，子 Agent 可以', () => {
  const root = project(F)
  assert.match(w(root, '.delivery/qa/v1.3.json', '{}', { isRoot: true }), /QA 子 Agent/)
  assert.equal(w(root, '.delivery/qa/v1.3.json', '{}', { isRoot: false }), undefined)
  assert.equal(w(root, '.delivery/qa/v1.3.json', '{}', { isRoot: undefined }), undefined)
})

test('R4 没有 QA 结论不能写报告，写明“未验收”可以', () => {
  const root = project(F)
  assert.match(w(root, '.delivery/report.md', '# 报告\n全部通过'), /还没有独立 QA 结论/)
  assert.equal(w(root, '.delivery/report.md', '# 报告\n验收状态：未验收（缺少测试环境）'), undefined)
  fs.writeFileSync(path.join(root, '.delivery', 'qa', 'v1.3.json'), '{"release_status":"ready"}')
  assert.equal(w(root, '.delivery/report.md', '# 报告'), undefined)
})

test('R5 经验包只能用 lessons.py 写', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-'))
  const f = path.join(home, '.agents/skills/industry-retail/lessons.jsonl')
  assert.match(w(home, f, '{}'), /lessons\.py/)
  assert.match(evaluate({ tool: 'bash', args: { command: `echo '{}' >> ${f}` }, cwd: home }), /lessons\.py/)
  assert.equal(evaluate({ tool: 'bash', args: { command: `python3 lessons.py merge --pack ${path.dirname(f)}` }, cwd: home }), undefined)
  assert.equal(evaluate({ tool: 'bash', args: { command: `cat ${f}` }, cwd: home }), undefined)
})

test('E1 只记录冻结清单里的测试命令', () => {
  const root = project(F)
  assert.equal(recordEvidence(root, { agent: 'subagent', command: 'ls', is_error: false, output_tail: '' }), false)
  assert.equal(recordEvidence(root, { agent: 'subagent', command: 'cd x && python3 -m unittest tests -v', is_error: false, output_tail: 'Ran 29 tests\nOK' }), true)
  const lines = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].version, 'v1.3')
  assert.match(lines[0].output_tail, /Ran 29 tests/)
})

test('apply 通过事件拦截写入并记录证据（模拟 Host）', async () => {
  const root = project(F)
  const handlers = {}
  const rootAgent = { id: 'main' }, child = { id: 'qa' }
  const ctx = {
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => n === 'workingDirectory' ? { ensure: async () => root } : n === 'agents' ? { roots: () => [rootAgent] } : undefined,
  }
  apply(ctx)
  const next = async () => ({ kind: 'allow' })
  const r1 = await handlers['tools/pre-execute']({ name: 'write', agent: rootAgent, arguments: { file_path: 'out/plan.docx', content: 'y' } }, next)
  assert.equal(r1.kind, 'deny'); assert.match(r1.reason, /交付守卫/)
  const r2 = await handlers['tools/pre-execute']({ name: 'write', agent: child, arguments: { file_path: '.delivery/qa/v1.3.json', content: '{}' } }, next)
  assert.equal(r2.kind, 'allow')
  const r3 = await handlers['tools/pre-execute']({ name: 'read', agent: rootAgent, arguments: {} }, next)
  assert.equal(r3.kind, 'allow')
  const exec = { name: 'bash', agent: child, arguments: { command: 'python3 -m unittest tests' } }
  assert.equal((await handlers['tools/pre-execute'](exec, next)).kind, 'allow')
  handlers['tools/result'](exec, { isError: false, content: [{ type: 'text', text: 'OK' }] })
  const ev = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8')
  assert.match(ev, /"agent":"subagent"/)
})
