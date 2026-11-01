// 交付工作台的数据层：只读 .delivery/，汇总成一个对象，供 HTML 渲染和将来的 UI 插件共用。
// 不写任何文件，读不到的部分返回空值，不抛错。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { findDeliveryRoot, deliveryState, frozenFiles, parseVersion, compareVersion } from '../index.js'

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}
function readJsonl(file) {
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { out.push({ _invalid: true, raw: line.slice(0, 200) }) }
  }
  return out
}
function sha256(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') } catch { return undefined }
}

/** freeze.files 里每个文件的哈希核对：unchanged / modified / missing / unknown（冻结时没记哈希） */
export function checkFrozenFiles(root, freeze) {
  const f = freeze?.files
  const entries = []
  if (Array.isArray(f)) {
    for (const x of f) {
      if (typeof x === 'string') entries.push({ path: x, sha256: undefined })
      else if (x && typeof x.path === 'string') entries.push({ path: x.path, sha256: x.sha256 ?? x.sha })
    }
  } else if (f && typeof f === 'object') {
    for (const [p, h] of Object.entries(f)) entries.push({ path: p, sha256: typeof h === 'string' ? h : undefined })
  }
  return entries.map((e) => {
    const abs = path.resolve(root, e.path)
    const now = sha256(abs)
    let status
    if (now === undefined) status = 'missing'
    else if (!e.sha256) status = 'unknown'
    else status = now.toLowerCase() === String(e.sha256).toLowerCase() ? 'unchanged' : 'modified'
    return { path: e.path, status }
  })
}

const PASS = new Set(['pass', 'passed', 'ok', 'met', '通过'])
const FAIL = new Set(['fail', 'failed', 'not_met', 'unmet', '未通过', '不通过'])
export function normStatus(s) {
  const v = String(s ?? '').trim().toLowerCase()
  if (!v) return 'none'
  if (PASS.has(v)) return 'pass'
  if (FAIL.has(v)) return 'fail'
  return 'other'
}

/** 合同验收条目 × 当前版本 QA 结论 */
export function acceptanceRows(contract, qa) {
  const reqs = Array.isArray(qa?.requirements) ? qa.requirements : []
  const byId = new Map(reqs.filter((r) => r && r.requirement_id != null).map((r) => [String(r.requirement_id), r]))
  const rows = []
  const items = Array.isArray(contract?.acceptance) ? contract.acceptance : []
  for (const a of items) {
    const id = a?.id != null ? String(a.id) : ''
    const r = byId.get(id)
    byId.delete(id)
    rows.push({
      id,
      statement: a?.statement ?? '',
      source: a?.source ?? '',
      status: r ? normStatus(r.status) : qa ? 'missing' : 'none',
      rawStatus: r?.status ?? '',
      evidence: r?.evidence ?? '',
    })
  }
  // QA 里有、合同里没有的条目（可能是合同被删条目）
  for (const [id, r] of byId) {
    rows.push({ id, statement: r.requirement ?? '', source: '', status: normStatus(r.status), rawStatus: r.status ?? '', evidence: r.evidence ?? '', orphan: true })
  }
  return rows
}

/** 推断当前所处阶段（只用于展示） */
export function inferStage(s) {
  if (!s.contract) return '访谈'
  if (!s.contract.confirmed_by_user) return '合同待确认'
  if (!s.freeze.version) return '实现中'
  if (!s.qa.exists) return '等待独立验收'
  if (s.qa.verdict !== 'pass') return '验收未通过，修复中'
  if (!s.report.exists) return '写报告'
  if (s.retro.total === 0) return '已交付，待复盘'
  if (s.retro.byReview.pending) return '复盘：等待逐条确认'
  return '已复盘'
}

function verdictOf(qa) {
  if (!qa) return 'none'
  const r = String(qa.release_status ?? qa.verdict ?? '').toLowerCase()
  if (/^(pass|passed|release|ready|approved|通过)/.test(r)) return 'pass'
  if (r) return 'fail'
  return 'unknown'
}

/** 读取项目的工作台数据。start 可以是项目里任意目录。 */
export function readWorkbench(start, { evidenceLimit = 20 } = {}) {
  const root = findDeliveryRoot(path.resolve(start))
  if (!root) return { found: false, start: path.resolve(start) }
  const d = path.join(root, '.delivery')
  const contract = readJson(path.join(d, 'contract.json'))
  const st = deliveryState(root)

  let qaVersions = []
  try {
    qaVersions = fs.readdirSync(path.join(d, 'qa')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5))
    qaVersions.sort((a, b) => compareVersion(parseVersion(a) ?? [], parseVersion(b) ?? []))
  } catch {}

  const evidenceAll = readJsonl(path.join(d, 'evidence.jsonl'))
  const evidence = evidenceAll.slice(-evidenceLimit).reverse()
  const evCur = evidenceAll.filter((e) => st.version && String(e.version) === st.version)

  let reportText
  try { reportText = fs.readFileSync(path.join(d, 'report.md'), 'utf8') } catch {}

  const cands = readJsonl(path.join(d, 'retro', 'candidates.jsonl')).filter((c) => !c._invalid)
  const byReview = {}
  for (const c of cands) { const k = c.review ?? 'pending'; byReview[k] = (byReview[k] ?? 0) + 1 }

  const usage = readJsonl(path.join(d, 'industry-usage.jsonl')).filter((c) => !c._invalid)

  const out = {
    found: true,
    root,
    name: path.basename(root),
    contract: contract
      ? {
          goal: contract.goal ?? '',
          industry: contract.industry ?? '',
          deliverables: Array.isArray(contract.deliverables) ? contract.deliverables : [],
          assumptions: Array.isArray(contract.assumptions) ? contract.assumptions : [],
          compliance: contract.compliance ?? '',
          confirmed_by_user: Boolean(contract.confirmed_by_user),
        }
      : undefined,
    freeze: {
      version: st.version,
      files: st.freeze ? checkFrozenFiles(root, st.freeze) : [],
      declaredFiles: frozenFiles(st.freeze).length,
      tests: st.tests,
    },
    qa: {
      exists: st.qaExists,
      verdict: verdictOf(st.qa),
      release_status: st.qa?.release_status ?? '',
      must_fix: Array.isArray(st.qa?.must_fix) ? st.qa.must_fix : [],
      release_gaps: Array.isArray(st.qa?.release_gaps) ? st.qa.release_gaps : [],
      suggestions: Array.isArray(st.qa?.suggestions) ? st.qa.suggestions : [],
      history: qaVersions,
    },
    acceptance: acceptanceRows(contract, st.qa),
    evidence: {
      recent: evidence,
      currentVersion: { runs: evCur.length, errors: evCur.filter((e) => e.is_error).length },
    },
    report: { exists: reportText !== undefined, unverified: reportText ? /未验收/.test(reportText) : false },
    industryUsage: usage,
    retro: { total: cands.length, byReview },
  }
  out.stage = inferStage(out)
  return out
}

function lastTouched(dir, depth = 2) {
  let t = 0
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth > 0) t = Math.max(t, lastTouched(p, depth - 1)) } else {
        try { t = Math.max(t, fs.statSync(p).mtimeMs) } catch {}
      }
    }
  } catch {}
  return t
}

/**
 * 一个工作区里可能有多个交付项目：向上找到的那个，加上 start 的直接子目录里带 .delivery/ 的。
 * 按 .delivery/ 里最近修改时间倒序，第一个是默认项目。
 */
export function listDeliveryProjects(start) {
  const base = path.resolve(start)
  const roots = new Set()
  const up = findDeliveryRoot(base)
  if (up) roots.add(up)
  try {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      const r = path.join(base, e.name)
      try { if (fs.statSync(path.join(r, '.delivery')).isDirectory()) roots.add(r) } catch {}
    }
  } catch {}
  return [...roots].map((root) => {
    const c = readJson(path.join(root, '.delivery', 'contract.json'))
    return { root, name: path.basename(root), goal: typeof c?.goal === 'string' ? c.goal : '', touched: lastTouched(path.join(root, '.delivery')) }
  }).sort((a, b) => b.touched - a.touched)
}
