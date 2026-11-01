// dsh-delivery-guard：交付流程的运行时守卫（Host 插件，随 @local/delivery-kit 安装）
// 只在项目里存在 .delivery/ 目录时生效，对其他会话没有影响。
// 规则：
//   R1 冻结后等待验收期间，冻结清单里的文件禁止修改（write/edit；bash 做简单识别）
//   R2 freeze.json：版本号只能递增；已有 QA 结论的版本不能覆盖；不能预填 QA 结论
//   R3 .delivery/qa/*.json 只能由子 Agent（QA）写，主 Agent 不能写
//   R4 当前冻结版本还没有 QA 结论时，不能写 report.md（除非写明“未验收”及原因）
//   R5 行业经验包的 lessons.jsonl 只能通过 lessons.py merge 写入
//   E1 运行冻结清单里的测试命令时，把结果追加到 .delivery/evidence.jsonl
// 交付工作台：
//   - 只读路由 GET /api/deliverykit.workbench?sessionId=…，给面板（client.js）取数，不写会话日志
//   - 斜杠命令 /delivery-workbench，用户手动输入查看摘要
import fs from 'node:fs'
import path from 'node:path'

export const name = 'delivery-guard'
export const inject = ['tools']
// workingDirectory 和 agents 是可选服务，用 ctx.get() 在调用时取，缺了也不报错

const WRITE_TOOLS = new Set(['write', 'edit'])
const QA_KEYS = ['qa', 'release_status', 'requirements', 'verdict', 'qa_result', 'qa_status']

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

/** 从 dir 向上找含 .delivery/ 的目录 */
export function findDeliveryRoot(start) {
  let dir = start
  for (let i = 0; i < 40 && dir; i++) {
    try { if (fs.statSync(path.join(dir, '.delivery')).isDirectory()) return dir } catch {}
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return undefined
}

/** "v1.4" → [1,4]；无法解析返回 undefined */
export function parseVersion(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const nums = String(v).match(/\d+/g)
  return nums ? nums.map(Number) : undefined
}
export function compareVersion(a, b) {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 兼容几种 files 写法：["a"]、[{path}]、{path: sha} */
export function frozenFiles(freeze) {
  const f = freeze?.files
  if (Array.isArray(f)) return f.map((x) => (typeof x === 'string' ? x : x?.path)).filter((x) => typeof x === 'string')
  if (f && typeof f === 'object') return Object.keys(f)
  return []
}
export function testCommands(freeze) {
  const t = freeze?.test_commands ?? freeze?.test_command ?? freeze?.tests ?? freeze?.commands
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.map((x) => (typeof x === 'string' ? x : x?.command)).filter((x) => typeof x === 'string')
  return []
}

/** 读取项目的交付状态 */
export function deliveryState(root) {
  const freeze = readJson(path.join(root, '.delivery', 'freeze.json'))
  const version = freeze?.version !== undefined ? String(freeze.version) : undefined
  const qaFile = version ? path.join(root, '.delivery', 'qa', `${version}.json`) : undefined
  const qa = qaFile ? readJson(qaFile) : undefined
  return {
    freeze,
    version,
    qa,
    qaExists: qaFile ? fs.existsSync(qaFile) : false,
    files: frozenFiles(freeze).map((p) => path.resolve(root, p)),
    tests: testCommands(freeze),
  }
}

function deny(reason) { return { kind: 'deny', reason: `[交付守卫] ${reason}` } }

/** edit 工具执行后的预期内容 */
function afterEdit(file, args) {
  let cur = ''
  try { cur = fs.readFileSync(file, 'utf8') } catch {}
  const oldS = String(args.old_string ?? ''), newS = String(args.new_string ?? '')
  if (!oldS) return newS
  return args.replace_all ? cur.split(oldS).join(newS) : cur.replace(oldS, newS)
}

/**
 * 核心判定：返回拒绝原因字符串，或 undefined 表示放行。
 * call = { tool, args, cwd, isRoot }，isRoot 为 undefined 表示无法判断。
 */
export function evaluate(call) {
  const { tool, args = {}, cwd, isRoot } = call
  if (tool === 'bash') return evaluateBash(call)
  if (!WRITE_TOOLS.has(tool)) return undefined
  const raw = args.file_path ?? args.path
  if (typeof raw !== 'string' || !cwd) return undefined
  const target = path.resolve(cwd, raw)
  const base = path.basename(target)

  // R5 经验包
  if (base === 'lessons.jsonl' && /[\\/]industry-[^\\/]+[\\/]/.test(target)) {
    return '行业经验只能经用户逐条确认后，用 `python3 <project-retro>/scripts/lessons.py merge` 写入，不能直接编辑 lessons.jsonl。'
  }

  const root = findDeliveryRoot(path.dirname(target))
  if (!root) return undefined
  const dDir = path.join(root, '.delivery')
  const rel = path.relative(dDir, target)
  const st = deliveryState(root)

  // R2 freeze.json
  if (rel === 'freeze.json') {
    const text = tool === 'write' ? String(args.content ?? '') : afterEdit(target, args)
    let next
    try { next = JSON.parse(text) } catch { return 'freeze.json 必须是合法 JSON。' }
    const pre = QA_KEYS.filter((k) => k in next)
    if (pre.length) return `freeze.json 只记录版本、文件、哈希和测试命令，不能包含验收结论字段（${pre.join(', ')}）。验收结论由 QA 写入 .delivery/qa/<版本>.json。`
    if (next.version === undefined) return 'freeze.json 缺少 version 字段。'
    if (st.version !== undefined) {
      const a = parseVersion(next.version), b = parseVersion(st.version)
      if (a && b) {
        const c = compareVersion(a, b)
        if (c < 0) return `版本号只能递增：当前已冻结 ${st.version}，不能改成更小的 ${next.version}。`
        if (c === 0 && st.qaExists) return `版本 ${st.version} 已有 QA 结论，不能覆盖。改了文件就冻结为新版本（比 ${st.version} 大）。`
      }
    }
    const qaDir = path.join(dDir, 'qa')
    if (fs.existsSync(path.join(qaDir, `${next.version}.json`))) return `版本 ${next.version} 已经验收过，请使用新的版本号。`
    return undefined
  }

  // R3 QA 结论
  if (rel.startsWith(`qa${path.sep}`) && rel.endsWith('.json')) {
    if (isRoot === true) return 'QA 结论只能由独立 QA 子 Agent 写入，主 Agent 不能写或修改 .delivery/qa/ 下的文件。'
    return undefined
  }

  // R4 报告
  if (rel === 'report.md' && st.version !== undefined && !st.qaExists) {
    const text = tool === 'write' ? String(args.content ?? '') : afterEdit(target, args)
    if (!/未验收/.test(text)) return `当前冻结版本 ${st.version} 还没有独立 QA 结论（.delivery/qa/${st.version}.json）。先等 QA 返回再写报告；如果确实无法验收，在报告里写明“未验收”及原因。`
    return undefined
  }

  // R1 冻结文件
  if (st.version !== undefined && !st.qaExists && st.files.includes(target)) {
    return `${path.relative(root, target)} 属于已冻结的版本 ${st.version}，正在等待独立验收，不能修改。等 QA 结果出来后再改；或者先把 freeze.json 升级为新版本（这会作废当前这轮验收）。`
  }
  return undefined
}

const WRITEY = /(>>?|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bdd\b)/
function evaluateBash(call) {
  const cmd = String(call.args?.command ?? '')
  const cwd = call.args?.workdir ? path.resolve(call.cwd ?? '/', String(call.args.workdir)) : call.cwd
  if (/lessons\.jsonl/.test(cmd) && WRITEY.test(cmd) && !/lessons\.py/.test(cmd)) {
    return '行业经验只能用 `lessons.py merge` 写入，不能用 shell 直接改 lessons.jsonl。'
  }
  if (!cwd) return undefined
  const root = findDeliveryRoot(cwd)
  if (!root) return undefined
  const st = deliveryState(root)
  if (st.version === undefined || st.qaExists || !WRITEY.test(cmd)) return undefined
  for (const f of st.files) {
    const rel = path.relative(root, f)
    if (rel && (cmd.includes(rel) || cmd.includes(f))) {
      return `命令看起来会修改已冻结的 ${rel}（版本 ${st.version} 正在等待验收）。等 QA 结果出来再改，或先升级冻结版本。`
    }
  }
  return undefined
}

/** E1：测试命令的证据记录 */
export function recordEvidence(root, entry) {
  const st = deliveryState(root)
  if (!st.version || !st.tests.length) return false
  const cmd = entry.command.trim()
  if (!st.tests.some((t) => t.trim() && cmd.includes(t.trim()))) return false
  const line = JSON.stringify({ ts: new Date().toISOString(), version: st.version, ...entry }) + '\n'
  fs.appendFileSync(path.join(root, '.delivery', 'evidence.jsonl'), line)
  return true
}

function textOf(result) {
  const parts = Array.isArray(result?.content) ? result.content : []
  return parts.map((p) => (p && p.type === 'text' ? p.text : '')).join('\n')
}

export const WORKBENCH_COMMAND = 'delivery-workbench'

/** /delivery-workbench 的处理：rawInput 为 json 时返回 JSON（给面板用），否则返回中文摘要 */
export async function workbenchCommand(cwd, rawInput) {
  if (!cwd) return { kind: 'error', text: '[交付工作台] 拿不到当前会话的工作目录。' }
  const { readWorkbench } = await import('./workbench/state.mjs')
  const s = readWorkbench(cwd)
  if (String(rawInput ?? '').trim() === 'json') return { kind: 'success', text: JSON.stringify(s) }
  if (!s.found) return { kind: 'success', text: `当前目录（${cwd}）还没有 .delivery/，这个项目没有进入交付流程。` }
  const pass = s.acceptance.filter((r) => r.status === 'pass').length
  const changed = s.freeze.files.filter((f) => f.status === 'modified' || f.status === 'missing').length
  const lines = [
    `交付工作台：${s.name}`,
    `阶段：${s.stage}`,
    `冻结版本：${s.freeze.version ?? '未冻结'}${changed ? `（${changed} 个冻结文件被改或丢失）` : ''}`,
    `QA：${s.qa.exists ? s.qa.release_status || s.qa.verdict : '未验收'}`,
    `验收条目：${pass}/${s.acceptance.length} 通过`,
    `复盘候选：${s.retro.total} 条，待确认 ${s.retro.byReview.pending ?? 0} 条`,
  ]
  return { kind: 'success', text: lines.join('\n') }
}

export const WORKBENCH_PATH = '/api/deliverykit.workbench'

/** 由 sessionId 找当前工作目录：live 会话用 workingDirectory（跟随 cd），否则用会话创建时的 cwd */
export async function sessionCwd(ctx, sessionId) {
  if (!sessionId) return undefined
  const sessions = ctx.get('sessions')
  const session = sessions?.get(sessionId)
  if (session) {
    const wd = ctx.get('workingDirectory')
    const cwd = wd ? wd.get(session) : undefined
    return cwd ?? session.header?.cwd
  }
  const stored = await ctx.get('sessionPersistence')?.stat(sessionId)
  return stored?.header?.cwd
}

/** GET /api/deliverykit.workbench?sessionId=… → readWorkbench 的 JSON */
export async function workbenchResponse(ctx, request) {
  const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId')
    if (!sessionId) return json({ error: 'missing sessionId' }, 400)
    const cwd = await sessionCwd(ctx, sessionId)
    if (!cwd) return json({ error: 'session working directory not found' }, 404)
    const { readWorkbench } = await import('./workbench/state.mjs')
    return json(readWorkbench(cwd))
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
}

export function apply(ctx) {
  // 交付工作台命令：commands 服务不存在时（比如命令行无 UI 的组合）静默跳过
  if (typeof ctx.inject === 'function') ctx.inject(['commands'], (c) => {
    c.commands.register({
      name: WORKBENCH_COMMAND,
      description: '查看交付工作台：合同条目、冻结版本、QA 结论和测试证据（只读）',
      input: { hint: '[json]' },
      recordInput: false,
      handler: async (inv) => {
        try {
          const wd = ctx.get('workingDirectory')
          const cwd = wd && inv.agent ? wd.get(inv.agent.session) : undefined
          return await workbenchCommand(cwd, inv.rawInput)
        } catch (e) {
          return { kind: 'error', text: `[交付工作台] 读取失败：${e?.message ?? e}` }
        }
      },
    })
  })

  // 交付工作台面板的取数路由：只读、只给本机 owner，不经过命令，所以不会在会话里留下记录
  if (typeof ctx.inject === 'function') ctx.inject(['connection'], (c) => {
    c.connection.fetch.register({
      path: WORKBENCH_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => workbenchResponse(ctx, request),
    })
  })

  const cwdOf = async (exec) => {
    const wd = ctx.get('workingDirectory')
    if (!exec.agent || !wd) return undefined
    try { return await wd.ensure(exec.agent, exec.signal) } catch { return undefined }
  }
  const isRootOf = (exec) => {
    const agents = ctx.get('agents')
    try { return agents && exec.agent ? agents.roots().includes(exec.agent) : undefined } catch { return undefined }
  }
  const cwdByCall = new WeakMap()

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name !== 'bash' && !WRITE_TOOLS.has(exec.name)) return next()
    let reason
    try {
      const cwd = await cwdOf(exec)
      if (exec.name === 'bash') cwdByCall.set(exec, cwd)
      reason = evaluate({ tool: exec.name, args: exec.arguments ?? {}, cwd, isRoot: isRootOf(exec) })
    } catch {
      reason = undefined // 守卫自身出错时不阻断工作
    }
    return reason ? deny(reason) : next()
  })

  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'bash') return
    try {
      const cwd0 = cwdByCall.get(exec)
      const args = exec.arguments ?? {}
      const cwd = args.workdir && cwd0 ? path.resolve(cwd0, String(args.workdir)) : cwd0
      if (!cwd || args.run_in_background === true) return
      const root = findDeliveryRoot(cwd)
      if (!root) return
      const out = textOf(result)
      recordEvidence(root, {
        agent: isRootOf(exec) === false ? 'subagent' : 'main',
        command: String(args.command ?? ''),
        is_error: Boolean(result?.isError),
        output_tail: out.slice(-1500),
      })
    } catch {
      // 证据记录失败不影响工具结果
    }
  })
}
