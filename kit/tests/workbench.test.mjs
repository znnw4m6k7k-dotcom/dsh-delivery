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
    inject(names, fn) { if (names[0] === 'commands') fn({ commands: { register: (d) => { registered = d } } }) },
  }
  apply(ctx)
  assert.equal(registered.name, 'delivery-workbench')
  const r = await registered.handler({ agent: { session: {} }, rawInput: 'json' })
  assert.equal(JSON.parse(r.text).found, true)
})

test('面板取数路由：按 sessionId 找工作目录，返回 JSON，不经过命令', async () => {
  const { apply, WORKBENCH_PATH, workbenchResponse } = await import('../bundle/index.js')
  const root = project()
  const live = { header: { cwd: '/nowhere' } }
  const services = {
    sessions: { get: (id) => (id === 'live' ? live : undefined) },
    workingDirectory: { get: (s) => (s === live ? root : undefined) },
    sessionPersistence: { stat: async (id) => (id === 'cold' ? { header: { cwd: root } } : undefined) },
  }
  const routes = []
  const ctx = {
    get: (n) => services[n],
    inject: (deps, fn) => { if (deps.includes('connection')) fn({ connection: { fetch: { register: (r) => routes.push(r) } } }) },
    on: () => {},
  }
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, WORKBENCH_PATH)
  assert.match(WORKBENCH_PATH, /^\/api\/[a-z.]+$/)
  assert.deepEqual(routes[0].methods, ['GET'])

  const call = (q) => routes[0].fetch(new Request('http://x' + WORKBENCH_PATH + q))
  const r1 = await call('?sessionId=live')
  assert.equal(r1.status, 200)
  assert.equal(r1.headers.get('cache-control'), 'no-store')
  const s1 = await r1.json()
  assert.equal(s1.found, true)
  assert.equal(s1.contract.goal, '奶茶店开业方案')

  const s2 = await (await call('?sessionId=cold')).json()
  assert.equal(s2.found, true)
  assert.equal((await call('')).status, 400)
  assert.equal((await call('?sessionId=gone')).status, 404)
  assert.equal(typeof workbenchResponse, 'function')
})

test('面板 client.js 不再通过命令取数', () => {
  const src = fs.readFileSync(path.join(here, '..', 'bundle', 'client.js'), 'utf8')
  assert.doesNotMatch(src, /commands\.execute/)
  assert.match(src, /api\/deliverykit\.workbench/)
})

test('同一工作区多个交付项目：默认最近修改的，可切换，不接受候选外路径', async () => {
  const { workbenchResponse } = await import('../bundle/index.js')
  const { listDeliveryProjects } = await import('../bundle/workbench/state.mjs')
  const ws = project() // 工作区根本身是一个项目（奶茶店）
  const sub = path.join(ws, '健身房')
  fs.mkdirSync(path.join(sub, '.delivery'), { recursive: true })
  fs.writeFileSync(path.join(sub, '.delivery', 'contract.json'), JSON.stringify({ goal: '健身房开业方案', acceptance: [] }))
  const old = new Date(Date.now() - 3600e3)
  for (const f of fs.readdirSync(path.join(ws, '.delivery'), { recursive: true })) fs.utimesSync(path.join(ws, '.delivery', f), old, old)

  const list = listDeliveryProjects(ws)
  assert.deepEqual(list.map((p) => p.name), ['健身房', path.basename(ws)])

  const ctx = { get: (n) => (n === 'sessions' ? { get: () => ({}) } : n === 'workingDirectory' ? { get: () => ws } : undefined) }
  const call = async (q) => (await workbenchResponse(ctx, new Request('http://x/api/deliverykit.workbench?sessionId=s' + q))).json()
  const a = await call('')
  assert.equal(a.contract.goal, '健身房开业方案')
  assert.equal(a.projects.length, 2)
  const b = await call('&project=' + encodeURIComponent(ws))
  assert.equal(b.contract.goal, '奶茶店开业方案')
  const c = await call('&project=' + encodeURIComponent('/etc'))
  assert.equal(c.contract.goal, '健身房开业方案')
})
