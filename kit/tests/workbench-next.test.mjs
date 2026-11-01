// 第 5 项：工作台显示“当前卡在哪”（next / rework / 测试计数）的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readWorkbench } from '../bundle/workbench/state.mjs'
import { renderWorkbench } from '../bundle/workbench/render.mjs'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, '.delivery', 'retro'), { recursive: true })
  return root
}
function write(root, file, data) {
  const full = path.join(root, '.delivery', file)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, typeof data === 'string' ? data : JSON.stringify(data))
}
const contract = (confirmed = true) => ({ goal: '开业方案', acceptance: [{ id: 'A1', statement: '含选址' }], confirmed_by_user: confirmed })
const freeze = (version) => ({ version, files: [], test_commands: ['node --test'] })

test('next：按阶段推断在等谁、等什么', () => {
  const root = project()

  // 还没有合同 → Agent 先做访谈
  assert.deepEqual(readWorkbench(root).next, { who: 'agent', text: '先做需求访谈，再把验收条目交给你确认' })

  // 合同未确认 → 等用户
  write(root, 'contract.json', contract(false))
  assert.deepEqual(readWorkbench(root).next, { who: 'user', text: '等你确认验收条目' })

  // 已确认、未冻结 → 等 Agent 实现
  write(root, 'contract.json', contract(true))
  assert.deepEqual(readWorkbench(root).next, { who: 'agent', text: 'Agent 正在实现，完成后冻结版本' })

  // 已冻结、没有 QA → 等 QA 验收
  write(root, 'freeze.json', freeze('v1'))
  assert.deepEqual(readWorkbench(root).next, { who: 'qa', text: '等 QA 验收 v1' })

  // QA 不通过 → Agent 在修第 1 轮
  write(root, 'qa/v1.json', { release_status: 'blocked', must_fix: ['修 a'] })
  const s1 = readWorkbench(root)
  assert.equal(s1.rework, 1)
  assert.deepEqual(s1.next, { who: 'agent', text: 'Agent 在修第 1 轮' })
})

test('next：QA 通过后依次等报告、等复盘、等确认经验、完成', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'freeze.json', freeze('v1'))
  write(root, 'qa/v1.json', { release_status: 'pass', requirements: [{ requirement_id: 'A1', status: 'pass' }] })

  // 验收过了、报告没写 → 等 Agent
  assert.deepEqual(readWorkbench(root).next, { who: 'agent', text: 'Agent 在写交付报告' })

  write(root, 'report.md', '# 报告')
  // 报告写了、没复盘 → 等用户做复盘
  assert.deepEqual(readWorkbench(root).next, { who: 'user', text: '验收通过，可以做复盘了' })

  write(root, 'retro/candidates.jsonl', JSON.stringify({ review: 'pending' }) + '\n')
  assert.deepEqual(readWorkbench(root).next, { who: 'user', text: '等你逐条确认复盘经验' })

  write(root, 'retro/candidates.jsonl', JSON.stringify({ review: 'approved' }) + '\n')
  assert.deepEqual(readWorkbench(root).next, { who: 'none', text: '交付和复盘都完成了，没有在等谁' })
})

test('next / stage：QA 文件存在但读不出结论时，不误报“在修第 1 轮”', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'freeze.json', freeze('v1'))
  write(root, 'qa/v1.json', {}) // 合法 JSON，但没有 release_status / verdict
  const s = readWorkbench(root)
  assert.equal(s.qa.verdict, 'unknown')
  assert.equal(s.stage, '验收结论无法识别')
  assert.deepEqual(s.next, { who: 'qa', text: 'QA 结论读不出来，检查 .delivery/qa/v1.json' })

  // 坏 JSON 同样不能误报“验收未通过”
  write(root, 'qa/v1.json', '{ 坏掉的 JSON')
  const s2 = readWorkbench(root)
  assert.equal(s2.qa.verdict, 'none')
  assert.equal(s2.stage, '验收结论无法识别')
  assert.deepEqual(s2.next, { who: 'qa', text: 'QA 结论读不出来，检查 .delivery/qa/v1.json' })
})

test('rework：等于 QA 不通过的版本数', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'qa/v1.json', { release_status: 'fail' })
  write(root, 'qa/v2.json', { release_status: 'failed' })
  write(root, 'qa/v3.json', { release_status: 'pass' })
  write(root, 'freeze.json', freeze('v4'))
  const s = readWorkbench(root)
  assert.equal(s.rework, 2)
  assert.equal(s.qa.verdict, 'none')
  assert.deepEqual(s.next, { who: 'qa', text: '等 QA 验收 v4' })
})

test('evidence.currentVersion：本版本最近一次验收运行的 passed / failed / unconfirmed', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'freeze.json', freeze('v2'))
  write(root, 'evidence.jsonl', [
    { version: 'v1', purpose: 'delivery', tests: { passed: 1, failed: 1, total: 2 } },
    { version: 'v2', purpose: 'diagnostic', command: 'node -e 1', tests: { passed: 0, failed: 0, total: 0 } },
    { version: 'v2', purpose: 'delivery', command: 'node --test', tests: { passed: 4, failed: 1, total: 5 } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n')
  const s = readWorkbench(root)
  assert.equal(s.evidence.currentVersion.runs, 2)
  assert.equal(s.evidence.currentVersion.errors, 0)
  assert.equal(s.evidence.currentVersion.passed, 4)
  assert.equal(s.evidence.currentVersion.failed, 1)
  assert.equal(s.evidence.currentVersion.total, 5)
  assert.equal(s.evidence.currentVersion.unconfirmed, false)
  // 渲染出“测试”格
  assert.match(renderWorkbench(s), /<b>4\/5<\/b>/)
  assert.match(renderWorkbench(s), /测试/)
})

test('evidence.currentVersion：最近一次验收运行解析不出计数时标记未确认', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'freeze.json', freeze('v1'))
  write(root, 'evidence.jsonl', [
    { version: 'v1', purpose: 'delivery', command: 'node --test', tests: { passed: 3, failed: 0, total: 3 } },
    { version: 'v1', purpose: 'delivery', command: 'node --test', tests: null, count_unconfirmed: true },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n')
  const s = readWorkbench(root)
  assert.equal(s.evidence.currentVersion.unconfirmed, true)
  assert.equal(s.evidence.currentVersion.passed, null)
  assert.match(renderWorkbench(s), /数量未确认/)
})

test('evidence.currentVersion：只有诊断运行（没有验收运行）时不编造计数', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'freeze.json', freeze('v1'))
  write(root, 'evidence.jsonl', JSON.stringify({ version: 'v1', purpose: 'diagnostic', tests: { passed: 0, failed: 0, total: 0 } }) + '\n')
  const s = readWorkbench(root)
  assert.equal(s.evidence.currentVersion.passed, undefined)
  assert.match(renderWorkbench(s), /数量未确认/)
})

test('渲染：顶部一句话、返工轮数，返工 3 轮及以上标红并提示停下来确认范围', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'qa/v1.json', { release_status: 'fail' })
  write(root, 'qa/v2.json', { release_status: 'fail' })
  write(root, 'qa/v3.json', { release_status: 'fail' })
  write(root, 'freeze.json', freeze('v4'))
  const s = readWorkbench(root)
  assert.equal(s.rework, 3)
  const html = renderWorkbench(s)
  assert.match(html, /下一步：等 QA 验收 v4（返工 3 轮） 建议停下来和用户确认范围/)
  assert.match(html, /<div class="next alert">/)
  assert.match(html, /class="lbl">测试/)
})

test('渲染：返工少于 3 轮时不标红', () => {
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'qa/v1.json', { release_status: 'fail' })
  write(root, 'freeze.json', freeze('v2'))
  const html = renderWorkbench(readWorkbench(root))
  assert.match(html, /<div class="next">/)
  assert.doesNotMatch(html, /next alert/)
  assert.match(html, /（返工 1 轮）/)
  assert.doesNotMatch(html, /建议停下来和用户确认范围/)
})

test('/delivery-workbench 摘要里带下一步和测试计数', async () => {
  const { workbenchCommand } = await import('../bundle/index.js')
  const root = project()
  write(root, 'contract.json', contract(true))
  write(root, 'qa/v1.json', { release_status: 'fail' })
  write(root, 'freeze.json', freeze('v2'))
  const r = await workbenchCommand(root, '')
  assert.match(r.text, /下一步：等 QA 验收 v2（返工 1 轮）/)
  const j = JSON.parse((await workbenchCommand(root, 'json')).text)
  assert.deepEqual(j.next, { who: 'qa', text: '等 QA 验收 v2' })
  assert.equal(j.rework, 1)
})
