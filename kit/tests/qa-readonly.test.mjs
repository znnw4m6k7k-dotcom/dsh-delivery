// 第 3 项：QA 等待验收期间只读（R3 加强）的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, apply } from '../bundle/index.js'

function project(qa) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'out'))
  fs.writeFileSync(path.join(root, 'out', 'plan.docx'), 'x')
  fs.writeFileSync(path.join(root, 'out', 'other.md'), 'x')
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v1', files: [{ path: 'out/plan.docx' }], test_commands: [] }))
  if (qa) fs.writeFileSync(path.join(root, '.delivery', 'qa', 'v1.json'), JSON.stringify(qa))
  return root
}
const w = (root, file, content = 'x', extra = {}) => evaluate({ tool: 'write', args: { file_path: file, content }, cwd: root, ...extra })
const bash = (root, command, extra = {}) => evaluate({ tool: 'bash', args: { command }, cwd: root, ...extra })

test('R3 加强：等验收期间子 Agent 只能写 .delivery/qa/ 下的文件', () => {
  const root = project()
  assert.equal(w(root, '.delivery/qa/v1.json', '{}', { isRoot: false }), undefined)
  assert.equal(w(root, '.delivery/qa/notes.md', '验收记录', { isRoot: false }), undefined)
  assert.match(w(root, 'out/other.md', 'y', { isRoot: false }), /只能写 \.delivery\/qa\//)
  assert.match(w(root, 'new-file.txt', 'y', { isRoot: false }), /只能写 \.delivery\/qa\//)
  assert.match(w(root, '.delivery/freeze.json', '{}', { isRoot: false }), /只能写 \.delivery\/qa\//)
})

test('R3 加强：子 Agent 写项目外的文件也拒绝', () => {
  const root = project()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-out-'))
  assert.match(w(root, path.join(outside, 'a.txt'), 'y', { isRoot: false }), /只能写 \.delivery\/qa\//)
  // 主 Agent 不受这条限制（R1 只管冻结文件）
  assert.equal(w(root, path.join(outside, 'a.txt'), 'y', { isRoot: true }), undefined)
})

test('R3 加强：主 Agent 和无法判断身份时的行为不变', () => {
  const root = project()
  // 主 Agent：非冻结文件可以写，冻结文件仍由 R1 拦；写 qa 仍由原 R3 拦
  assert.equal(w(root, 'out/other.md', 'y', { isRoot: true }), undefined)
  assert.match(w(root, 'out/plan.docx', 'y', { isRoot: true }), /已冻结的版本 v1/)
  assert.match(w(root, '.delivery/qa/v1.json', '{}', { isRoot: true }), /QA 子 Agent/)
  // 无法判断是不是子 Agent 时不阻断（保持原有行为）
  assert.equal(w(root, 'out/other.md', 'y', { isRoot: undefined }), undefined)
})

test('R3 加强：QA 结论出来后子 Agent 恢复正常写权限', () => {
  const root = project({ release_status: 'fail', must_fix: ['修 a'] })
  assert.equal(w(root, 'out/other.md', 'y', { isRoot: false }), undefined)
})

test('R3 加强（bash）：子 Agent 不能借 shell 改 .delivery 里的其他文件', () => {
  const root = project()
  assert.match(bash(root, 'echo x > .delivery/freeze.json', { isRoot: false }), /只能写 \.delivery\/qa\//)
  assert.match(bash(root, 'rm -rf .delivery', { isRoot: false }), /只能写 \.delivery\/qa\//)
  assert.equal(bash(root, 'echo ok > .delivery/qa/note.txt', { isRoot: false }), undefined)
  // 主 Agent 不受这条限制
  assert.equal(bash(root, 'echo x > .delivery/note.txt', { isRoot: true }), undefined)
})

test('R3 加强走 Host 事件（模拟 apply）：主/子 Agent 分发正确', async () => {
  const root = project()
  const handlers = {}
  const mainAgent = { id: 'main' }, qaAgent = { id: 'qa' }
  const ctx = {
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => n === 'workingDirectory' ? { ensure: async () => root } : n === 'agents' ? { roots: () => [mainAgent] } : undefined,
  }
  apply(ctx)
  const next = async () => ({ kind: 'allow' })
  const pre = (agent, file) => handlers['tools/pre-execute']({ name: 'write', agent, arguments: { file_path: file, content: 'x' } }, next)
  assert.equal((await pre(qaAgent, '.delivery/qa/v1.json')).kind, 'allow')
  const denied = await pre(qaAgent, 'out/other.md')
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /^\[交付守卫\]/)
  assert.match(denied.reason, /只能写 \.delivery\/qa\//)
  assert.equal((await pre(mainAgent, 'out/other.md')).kind, 'allow')
})
