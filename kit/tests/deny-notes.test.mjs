// 第 4 项：守卫拒绝说人话（R1–R6 都带【给你的说明】）的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, recordEvidence, apply } from '../bundle/index.js'

const NOTE = '【给你的说明】'
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'out'))
  fs.writeFileSync(path.join(root, 'out', 'plan.docx'), 'x')
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v2', files: [{ path: 'out/plan.docx' }], test_commands: ['node --test'] }))
  return root
}
const w = (root, file, content, extra = {}) => evaluate({ tool: 'write', args: { file_path: file, content }, cwd: root, ...extra })
const bash = (root, command, extra = {}) => evaluate({ tool: 'bash', args: { command }, cwd: root, ...extra })

/** 每条拒绝信息：原因在上一行，最后一行是给用户看的说明 */
function assertUserNote(reason, rule) {
  assert.equal(typeof reason, 'string', `${rule} 应该有拒绝原因`)
  assert.doesNotMatch(reason, /未定义|undefined/, `${rule} 的说明不能是空的占位`)
  const idx = reason.lastIndexOf(NOTE)
  assert.ok(idx > 0, `${rule} 的拒绝信息里要有【给你的说明】`)
  // 说明另起一行
  assert.equal(reason[idx - 1], '\n', `${rule} 的说明要另起一行`)
  const note = reason.slice(idx + NOTE.length)
  assert.ok(note.trim().length >= 10, `${rule} 的说明要是完整的句子`)
  assert.match(note, /正常的(保护|提醒)/, `${rule} 的说明要讲清这是正常的保护`)
  assert.match(note, /不用做什么|只需要/, `${rule} 的说明要讲清用户要不要做什么`)
}

test('R1 冻结文件被拦时带【给你的说明】', () => {
  const root = project()
  assertUserNote(w(root, 'out/plan.docx', 'y', { isRoot: true }), 'R1(write)')
  assertUserNote(bash(root, 'echo x > out/plan.docx', { isRoot: true }), 'R1(bash)')
})

test('R2 版本/格式问题被拦时带【给你的说明】', () => {
  const root = project()
  assertUserNote(w(root, '.delivery/freeze.json', JSON.stringify({ version: 'v1', files: [] })), 'R2(版本倒退)')
  assertUserNote(w(root, '.delivery/freeze.json', 'not json'), 'R2(非法 JSON)')
  assertUserNote(w(root, '.delivery/freeze.json', JSON.stringify({ version: 'v3', qa: {} })), 'R2(预填结论)')
  assertUserNote(w(root, '.delivery/freeze.json', JSON.stringify({ files: [] })), 'R2(缺版本)')
})

test('R3 / R3 加强被拦时带【给你的说明】', () => {
  const root = project()
  // 主 Agent 写 QA 结论
  assertUserNote(w(root, '.delivery/qa/v2.json', '{}', { isRoot: true }), 'R3')
  // 子 Agent 在等验收期间写其他文件
  assertUserNote(w(root, 'out/other.md', 'y', { isRoot: false }), 'R3QA(write)')
  assertUserNote(bash(root, 'echo x > .delivery/freeze.json', { isRoot: false }), 'R3QA(bash)')
})

test('R4 报告早于验收被拦时带【给你的说明】', () => {
  const root = project()
  assertUserNote(w(root, '.delivery/report.md', '# 报告\n全部通过'), 'R4')
})

test('R5 直接改经验包被拦时带【给你的说明】', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'note-home-'))
  const f = path.join(home, '.agents/skills/industry-retail/lessons.jsonl')
  assertUserNote(w(home, f, '{}'), 'R5(write)')
  assertUserNote(bash(home, `echo '{}' >> ${f}`), 'R5(bash)')
})

test('R6 原样重跑被拦时带【给你的说明】', () => {
  const root = project()
  assert.equal(recordEvidence(root, { agent: 'main', command: 'node --test', is_error: false, output: '# pass 1\n# fail 0' }), true)
  assertUserNote(bash(root, 'node --test'), 'R6')
})

test('走 Host 事件返回的拒绝信息同样带说明，并保留 [交付守卫] 前缀', async () => {
  const root = project()
  const handlers = {}
  const ctx = {
    on: (ev, fn) => { handlers[ev] = fn },
    get: (n) => n === 'workingDirectory' ? { ensure: async () => root } : n === 'agents' ? { roots: () => [{ id: 'main' }] } : undefined,
  }
  apply(ctx)
  const r = await handlers['tools/pre-execute']({ name: 'write', agent: { id: 'main' }, arguments: { file_path: 'out/plan.docx', content: 'y' } }, async () => ({ kind: 'allow' }))
  assert.equal(r.kind, 'deny')
  assert.match(r.reason, /^\[交付守卫\]/)
  assertUserNote(r.reason, 'R1(Host)')
})
