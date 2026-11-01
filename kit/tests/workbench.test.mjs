import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readWorkbench, acceptanceRows, normStatus } from '../bundle/workbench/state.mjs'
import { renderWorkbench } from '../bundle/workbench/render.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, '..', 'bundle', 'workbench', 'cli.mjs')
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-'))
  const d = path.join(root, '.delivery')
  fs.mkdirSync(path.join(d, 'qa'), { recursive: true })
  fs.mkdirSync(path.join(d, 'retro'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'A')
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'B-changed')
  const w = (f, o) => fs.writeFileSync(path.join(d, f), typeof o === 'string' ? o : JSON.stringify(o))
  w('contract.json', {
    goal: '奶茶店开业方案', industry: '餐饮/茶饮', deliverables: ['方案.md'], assumptions: ['预算 20 万'],
    compliance: 'internet', confirmed_by_user: true,
    acceptance: [{ id: 'A1', statement: '含选址分析', source: '访谈第1轮' }, { id: 'A2', statement: '<b>成本表</b>可重算' }, { id: 'A3', statement: '有开业排期' }],
  })
  w('freeze.json', { version: 'v2', files: [{ path: 'src/a.js', sha256: sha('A') }, { path: 'src/b.js', sha256: sha('B') }, { path: 'src/c.js', sha256: sha('C') }], test_commands: ['node --test'] })
  w('qa/v1.json', { release_status: 'fail' })
  w('qa/v2.json', {
    release_status: 'pass',
    requirements: [{ requirement_id: 'A1', status: 'pass', evidence: '第2节' }, { requirement_id: 'A2', status: 'fail', evidence: '合计不一致' }, { requirement_id: 'X9', requirement: '多出来的', status: 'pass' }],
    must_fix: ['修正成本合计'], release_gaps: [], suggestions: ['加竞品表'],
  })
  w('evidence.jsonl', [
    { ts: '2026-11-01T01:00:00Z', version: 'v1', command: 'node --test', is_error: true },
    { ts: '2026-11-01T02:00:00Z', version: 'v2', command: 'node --test', is_error: false, agent: 'subagent' },
    'not json',
  ].map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n')
  w('report.md', '# 报告')
  w('retro/candidates.jsonl', [{ review: 'pending' }, { review: 'approved' }, { review: 'edited' }, { review: 'rejected' }].map((x) => JSON.stringify(x)).join('\n'))
  return root
}

test('readWorkbench 汇总合同、冻结、QA、证据和复盘', () => {
  const root = project()
  const s = readWorkbench(path.join(root, 'src'))
  assert.equal(s.found, true)
  assert.equal(s.root, root)
  assert.equal(s.freeze.version, 'v2')
  assert.deepEqual(s.freeze.files.map((f) => f.status), ['unchanged', 'modified', 'missing'])
  assert.equal(s.qa.verdict, 'pass')
  assert.deepEqual(s.qa.history, ['v1', 'v2'])
  assert.deepEqual(s.acceptance.map((r) => [r.id, r.status]), [['A1', 'pass'], ['A2', 'fail'], ['A3', 'missing'], ['X9', 'pass']])
  assert.equal(s.acceptance[3].orphan, true)
  assert.equal(s.evidence.recent.length, 3)
  assert.deepEqual(s.evidence.currentVersion, { runs: 1, errors: 0 })
  assert.deepEqual(s.retro.byReview, { pending: 1, approved: 1, edited: 1, rejected: 1 })
  assert.equal(s.stage, '复盘：等待逐条确认')
})

test('没有 .delivery/ 时返回 found:false，渲染出提示页', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-none-'))
  const s = readWorkbench(root)
  assert.equal(s.found, false)
  assert.match(renderWorkbench(s), /还没有进入交付流程/)
})

test('阶段推断：只有合同未确认 / 已冻结待验收', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-st-'))
  fs.mkdirSync(path.join(root, '.delivery'))
  assert.equal(readWorkbench(root).stage, '访谈')
  fs.writeFileSync(path.join(root, '.delivery', 'contract.json'), JSON.stringify({ goal: 'x', acceptance: [{ id: 'A1', statement: 's' }] }))
  assert.equal(readWorkbench(root).stage, '合同待确认')
  fs.writeFileSync(path.join(root, '.delivery', 'contract.json'), JSON.stringify({ goal: 'x', confirmed_by_user: true, acceptance: [{ id: 'A1', statement: 's' }] }))
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v1', files: [] }))
  const s = readWorkbench(root)
  assert.equal(s.stage, '等待独立验收')
  assert.equal(s.acceptance[0].status, 'none')
})

test('状态归一化和条目对齐', () => {
  assert.equal(normStatus('PASS'), 'pass')
  assert.equal(normStatus('未通过'), 'fail')
  assert.equal(normStatus('partial'), 'other')
  assert.equal(normStatus(undefined), 'none')
  assert.deepEqual(acceptanceRows(undefined, undefined), [])
})

test('渲染：转义 HTML、无外部资源和脚本', () => {
  const html = renderWorkbench(readWorkbench(project()), { now: new Date(0) })
  assert.match(html, /&lt;b&gt;成本表&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<script|https?:\/\//)
  assert.match(html, /冻结后被改/)
  assert.match(html, /合同里没有这条/)
})

test('命令行生成 workbench.html，--json 输出汇总', () => {
  const root = project()
  const file = execFileSync(process.execPath, [cli, root], { encoding: 'utf8' }).trim()
  assert.equal(file, path.join(root, '.delivery', 'workbench.html'))
  assert.ok(fs.readFileSync(file, 'utf8').startsWith('<!DOCTYPE html>'))
  const j = JSON.parse(execFileSync(process.execPath, [cli, root, '--json'], { encoding: 'utf8' }))
  assert.equal(j.freeze.version, 'v2')
})

test('/delivery-workbench 命令：json 和摘要两种输出', async () => {
  const { workbenchCommand } = await import('../bundle/index.js')
  const root = project()
  const j = await workbenchCommand(root, ' json ')
  assert.equal(j.kind, 'success')
  assert.equal(JSON.parse(j.text).freeze.version, 'v2')
  const s = await workbenchCommand(root, '')
  assert.match(s.text, /冻结版本：v2（2 个冻结文件被改或丢失）/)
  const none = await workbenchCommand(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-c-')), '')
  assert.match(none.text, /没有 \.delivery/)
  assert.equal((await workbenchCommand(undefined, 'json')).kind, 'error')
})

test('apply 注册 /delivery-workbench 命令（模拟 Host）', async () => {
  const { apply } = await import('../bundle/index.js')
  const root = project()
  let registered
  const ctx = {
    on() {}, get: (n) => (n === 'workingDirectory' ? { get: () => root } : undefined),
    inject(names, fn) { assert.deepEqual(names, ['commands']); fn({ commands: { register: (d) => { registered = d } } }) },
  }
  apply(ctx)
  assert.equal(registered.name, 'delivery-workbench')
  const r = await registered.handler({ agent: { session: {} }, rawInput: 'json' })
  assert.equal(JSON.parse(r.text).found, true)
})
