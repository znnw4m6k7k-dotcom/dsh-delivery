// dsh-delivery-guard：交付流程的运行时守卫（Host 插件，随 @local/delivery-kit 安装）
// 只在项目里存在 .delivery/ 目录时生效，对其他会话没有影响。
// 规则：
//   R1 冻结后等待验收期间，冻结清单里的文件禁止修改（write/edit；bash 做简单识别）
//   R2 freeze.json：版本号只能递增；已有 QA 结论的版本不能覆盖；不能预填 QA 结论
//   R3 .delivery/qa/*.json 只能由子 Agent（QA）写；冻结后等待验收期间，子 Agent 只能写 .delivery/qa/
//   R4 当前冻结版本还没有 QA 结论时，不能写 report.md（除非写明“未验收”及原因）
//   R5 行业经验包的 lessons.jsonl 只能通过 lessons.py merge 写入
//   R6 同一冻结版本、同一条测试命令、同一角色已经验收跑过时，禁止原样重跑（命令里写 # retry_reason 可放行）
//   E1 记录测试证据：区分验收运行（delivery）和排查运行（diagnostic），并写入 tests 计数；grep/cat 等只读查看不记录
// 项目定位：会话 cwd 是工作区根，但命令里 `cd 子项目` 或参数里写了子项目路径时，按子项目判断（工作区可同时有多个项目）
// 交付工作台：
//   - 只读路由 GET /api/deliverykit.workbench?sessionId=…，给面板（client.js）取数，不写会话日志
//   - 斜杠命令 /delivery-workbench，用户手动输入查看摘要
//   - 斜杠命令 /delivery-doctor，逐项自检工具包（版本、守卫、技能目录、项目文件、行业经验包）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ---- 命令定位：一次命令到底作用在哪个交付项目 ----
// 会话 cwd 是工作区根目录，但工作区里可能同时有多个交付项目（工作台本身就支持同一工作区多项目切换）。
// 命令里 `cd 子项目 && pytest` 或 `pytest 子项目/tests` 实际测的是子项目，证据、R1/R3QA/R6
// 都要按子项目判断，否则会记到根目录的另一个项目上去（2026-11-01 新手试跑就踩了这个坑）。

/** 可能是“跑测试”的命令片段：只用来判断多个 cd 里哪个才是测试命令执行前的最后一个 */
const TEST_CMD = /\b(?:pytest|unittest|nose2?)\b|\bnode\s+(?:--test|-e|--eval|--check)\b|\bnpm\s+(?:run\s+)?test\b|\bgo\s+test\b|\bpython3?\s+-m\s+(?:unittest|pytest)\b/

/** 按 && / || / ; / 换行拆成 shell 片段（够用即可，不追求完整 shell 语法） */
function shellSegments(command) {
  return String(command ?? '').split(/\s*(?:&&|\|\||;|\n)\s*/).map((s) => s.trim()).filter(Boolean)
}

/** 去掉开头的 cd 链：`cd A && cd B && node --test` → `node --test` */
function stripCdPrefix(command) {
  let s = String(command ?? '').trim()
  for (;;) {
    const m = s.match(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|\|\||;)\s*/)
    if (!m) return s
    s = s.slice(m[0].length)
  }
}

/** 取 cd 的参数：支持带引号的路径；`cd -`、`cd --help` 之类忽略 */
function cdArgOf(rest) {
  const s = String(rest ?? '').trim()
  if (!s || s.startsWith('-')) return undefined
  const quote = s[0] === '"' || s[0] === "'" ? s[0] : ''
  if (quote) {
    const end = s.indexOf(quote, 1)
    return end > 1 ? s.slice(1, end) : undefined
  }
  // 先把 “\ ”（转义的空格）当成一个整体，再取到空白/分隔符为止
  const token = s.match(/^(?:\\ |[^\s;&|])+/)?.[0]
  return token ? token.replace(/\\ /g, ' ') : undefined
}

/**
 * 命令最后会落到哪个目录：
 * 有测试命令时取“测试命令执行前的最后一个 cd”（多个 cd 以前面的为准）；
 * 没有测试命令时取最后一个 cd；整条命令没有 cd 返回 undefined。
 */
function commandDir(command, cwd) {
  const segments = shellSegments(command)
  let dir = path.resolve(cwd)
  let sawCd = false
  for (const seg of segments) {
    const m = seg.match(/^cd\s+([\s\S]+)$/)
    if (m) {
      sawCd = true
      const arg = cdArgOf(m[1])
      if (arg) dir = path.resolve(dir, arg)
      continue
    }
    if (TEST_CMD.test(seg)) return dir
  }
  return sawCd ? dir : undefined
}

/** 命令参数里出现的、真实存在的路径（相对 cwd 或绝对路径），按出现顺序返回绝对路径 */
function commandPaths(command, cwd) {
  const out = []
  const tokenRe = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s"'`<>|&;()]+)/g
  for (const seg of shellSegments(command)) {
    if (/^cd\s/.test(seg)) continue
    for (const m of seg.matchAll(tokenRe)) {
      let token = (m[1] ?? m[2] ?? m[3] ?? '').trim()
      if (!token || token.startsWith('-') || token.includes('=')) continue
      // pytest 的 nodeid 形式 tests/test_a.py::test_x 只看文件路径部分
      token = token.split('::')[0]
      // 通配符（node --test tests/*.test.mjs）：保留第一个通配符之前的部分，它一定存在
      const glob = token.search(/[*?[]/)
      if (glob >= 0) token = token.slice(0, glob)
      token = token.replace(/[\\/]+$/, '')
      if (!token || token === '.') continue
      const abs = path.isAbsolute(token) ? path.resolve(token) : path.resolve(cwd, token)
      try { if (!fs.existsSync(abs)) continue } catch { continue }
      out.push(abs)
    }
  }
  return out
}

/** root 是否比 base 更深（更靠近工作目录） */
function deeperThan(root, base) {
  if (!root) return false
  if (!base) return true
  if (root === base) return false
  return root.startsWith(base + path.sep)
}

/**
 * 命令实际作用的交付项目根目录（找不到返回 undefined）：
 *   1) 命令里有 cd：按 cwd 解析 cd 目标目录，从那里向上找 .delivery；
 *   2) 否则（或 cd 目标上找不到）：看命令参数里真实存在的路径，取第一个能找到
 *      比 findDeliveryRoot(cwd) 更深（更近）的 .delivery 的项目；
 *   3) 都没有就退回 findDeliveryRoot(cwd)。
 */
export function resolveCommandRoot(command, cwd) {
  const cmd = String(command ?? '')
  const base = cwd ? path.resolve(cwd) : undefined
  const baseRoot = findDeliveryRoot(base)

  // 1) cd 链
  if (base && /(?:^|[\s;&|()])cd\s/.test(cmd)) {
    const dir = commandDir(cmd, base)
    if (dir) {
      const root = findDeliveryRoot(dir)
      if (root) return root
    }
  }

  // 2) 命令参数里的路径
  if (base) {
    for (const abs of commandPaths(cmd, base)) {
      const root = findDeliveryRoot(abs)
      if (root && deeperThan(root, baseRoot)) return root
    }
  }

  // 3) 退回会话工作目录
  return baseRoot
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

// ---- E1：测试输出解析 ----
// 目的：把“测试到底过了几个”变成证据里的数字，而不是靠模型自己说。

/** 命令清洗：去掉 # retry_reason 注释，空白压成单个空格，便于比较“同一条命令” */
export function normalizeCommand(command) {
  return String(command ?? '')
    .replace(/#\s*retry_reason\s*[:：][^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 从输出里解析通过数、失败数和总数；认不出返回 null（调用方要记 count_unconfirmed） */
export function parseTestCounts(output) {
  // 先剥掉 ANSI 颜色码（CI / pty 里会有），否则汇总行匹配不上
  const text = String(output ?? '').replace(/\x1b\[[0-9;]*m/g, '')
  if (!text.trim()) return null
  const num = (m) => (m ? Number(m[1]) : undefined)

  // 1) node --test：# pass N / # fail N / # tests N（新版 Node 用 ℹ 前缀）
  {
    const get = (key) => num(text.match(new RegExp(`^[#ℹ]\\s*${key}\\s+(\\d+)\\s*$`, 'm')))
    const passed = get('pass')
    const failed = get('fail')
    const total = get('tests')
    if (passed !== undefined || failed !== undefined) {
      const p = passed ?? 0
      const f = failed ?? 0
      return { passed: p, failed: f, total: total ?? p + f }
    }
  }

  // 2) unittest：Ran N tests + OK / FAILED (failures=M, errors=K)
  {
    const ran = num(text.match(/^Ran (\d+) tests?\b/m))
    if (ran !== undefined) {
      const failedLine = text.match(/^FAILED \(([^)]*)\)/m)
      if (failedLine) {
        const failures = num(failedLine[1].match(/failures=(\d+)/)) ?? 0
        const errors = num(failedLine[1].match(/errors=(\d+)/)) ?? 0
        const failed = failures + errors
        return { passed: Math.max(0, ran - failed), failed, total: ran }
      }
      if (/^OK\b/m.test(text)) return { passed: ran, failed: 0, total: ran }
      return null
    }
  }

  // 3) go test：--- PASS/FAIL 标记，或 ok / FAIL 包级结果
  {
    const passes = text.match(/^--- PASS:/gm)
    const fails = text.match(/^--- FAIL:/gm)
    if (passes || fails) {
      const p = passes?.length ?? 0
      const f = fails?.length ?? 0
      return { passed: p, failed: f, total: p + f }
    }
    const oks = text.match(/^ok\s+\S+/gm)
    const failPkgs = text.match(/^FAIL\s+\S+/gm)
    if (oks || failPkgs) {
      const p = oks?.length ?? 0
      const f = failPkgs?.length ?? 0
      return { passed: p, failed: f, total: p + f }
    }
  }

  // 4) jest / vitest：Tests: N passed, M failed, T total（vitest 结尾是 (T)）
  {
    const line = text.match(/^\s*Tests:?\s+(.+)$/m)
    if (line) {
      const body = line[1]
      const passed = num(body.match(/(\d+)\s+passed/))
      const failed = num(body.match(/(\d+)\s+failed/))
      const total = num(body.match(/(\d+)\s+total/)) ?? num(body.match(/\((\d+)\)/))
      if (passed !== undefined || failed !== undefined) {
        const p = passed ?? 0
        const f = failed ?? 0
        return { passed: p, failed: f, total: total ?? p + f }
      }
    }
  }

  // 5) pytest：N passed, M failed（取最后一条带计数的汇总行）
  {
    const lines = text.split('\n').filter((l) => /\b\d+\s+(?:passed|failed)\b/.test(l))
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      const passed = num(l.match(/(\d+)\s+passed/))
      const failed = num(l.match(/(\d+)\s+failed/))
      if (passed !== undefined || failed !== undefined) {
        const p = passed ?? 0
        const f = failed ?? 0
        return { passed: p, failed: f, total: p + f }
      }
    }
  }

  return null
}

/** 排查类命令的特征：node -e / node --check / echo / python -c 等，只用于诊断，不算验收 */
const TESTISH = /\bnode\s+(?:-e|--eval|--check|--test)\b|\bnpm\s+(?:run\s+)?test\b|\bpytest\b|\bgo\s+test\b|\bpython3?\s+-m\s+(?:unittest|pytest)\b|^echo\b|\bpython3?\s+-c\b/

// 只读查看/打印类命令：不产生证据行；即使命令文本里出现了冻结命令字符串，也永远不算验收
// （例如 freeze 里是 npm test 时，`grep "npm test" package.json` 不能算测试通过）。
// 判断前先剥掉开头的 cd 链，`cd app && cat pytest.ini` 同样只是查看。
const READONLY_FIRST = /^\s*(?:echo|cat|grep|egrep|fgrep|rg|head|tail|wc|pwd|which|type|stat|diff|ls|file|tree|du|df)\b/

// 一次性脚本（node -e / node --check / python -c）常被拿来手工验证产出：记为排查，不算验收
const SCRIPT_FIRST = /^\s*(?:node\s+(?:-e|--eval|--check)|python3?\s+-c)\b/

/** 命令片段是否作为“完整的一段命令”出现（前后是命令边界，避免 pytest 命中 pytest.ini、npm test 命中带引号的 grep 参数） */
function containsCommand(cmd, fragment) {
  let from = 0
  for (;;) {
    const i = cmd.indexOf(fragment, from)
    if (i < 0) return false
    const before = i === 0 ? '' : cmd[i - 1]
    const after = i + fragment.length >= cmd.length ? '' : cmd[i + fragment.length]
    const boundaryBefore = i === 0 || /[\s;&|()]/.test(before)
    const boundaryAfter = after === '' || /[\s;&|()]/.test(after)
    if (boundaryBefore && boundaryAfter) return true
    from = i + 1
  }
}

/**
 * 一次 bash 运行为什么被记录：
 *   delivery = 命令里包含冻结清单里的测试命令（整段匹配），算验收运行
 *   diagnostic = 测试类命令或一次性脚本，记为排查运行，永远不算验收
 *   undefined = 与测试无关，或只是 grep/cat/head 这类只读查看，不记录
 */
export function evidencePurpose(command, testCommands = []) {
  const cmd = normalizeCommand(command)
  if (!cmd) return undefined
  const head = stripCdPrefix(cmd)
  if (READONLY_FIRST.test(head)) return undefined
  if (SCRIPT_FIRST.test(head)) return 'diagnostic'
  const frozen = testCommands.map((t) => String(t ?? '').trim()).filter(Boolean)
  if (frozen.some((t) => containsCommand(cmd, t))) return 'delivery'
  return TESTISH.test(cmd) ? 'diagnostic' : undefined
}

/** 命令里写的重跑原因：# retry_reason: xxx */
export function retryReason(command) {
  const m = String(command ?? '').match(/#\s*retry_reason\s*[:：]\s*([^\n]*)/)
  return m ? m[1].trim() : undefined
}

/** 读 evidence.jsonl（坏行跳过），按写入顺序返回 */
export function readEvidence(root) {
  let text
  try { text = fs.readFileSync(path.join(root, '.delivery', 'evidence.jsonl'), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

/** 读取项目的交付状态 */
export function deliveryState(root) {
  const freeze = readJson(path.join(root, '.delivery', 'freeze.json'))
  const version = freeze?.version !== undefined ? String(freeze.version) : undefined
  // QA 结论文件：<版本>.json；兼容 QA 写成 qa-<版本>.json 的情况（实机出现过，导致守卫以为还没验收）
  const qaFile = version
    ? [`${version}.json`, `qa-${version}.json`].map((n) => path.join(root, '.delivery', 'qa', n)).find((p) => fs.existsSync(p)) ??
      path.join(root, '.delivery', 'qa', `${version}.json`)
    : undefined
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

// 每条拒绝信息先给模型看原因，再另起一行给用户一句人话说明（固定以【给你的说明】开头）：
// 这是正常的保护还是流程出错、用户要不要做什么。大部分情况用户什么都不用做。
const USER_NOTES = {
  R1: '这是正常的保护：Agent 正在等独立验收，冻结的文件不能动，所以这次修改被拦住了。你不用做什么，Agent 会等 QA 结果或重新冻结版本后再改。',
  R2: '这是正常的保护：验收基准只能往前走，版本号不能倒退，已经验收过的版本也不能被覆盖。你不用做什么，Agent 会改用新的版本号。',
  R3: '这是正常的保护：验收结论必须由独立的 QA 子 Agent 写，主 Agent 不能给自己打分。你不用做什么，等 QA 返回结论就好。',
  R3QA: '这是正常的保护：QA 正在独立验收，这段时间它只能写验收结论，不能改项目文件。你不用做什么，等 QA 返回结论就好。',
  R4: '这是正常的保护：交付报告不能早于独立验收，避免把没验过的东西写成已完成。你不用做什么，Agent 会等 QA 结论出来再写报告。',
  R5: '这是正常的保护：行业经验要你逐条确认后才会写进经验包，所以直接改文件被拦住了。你只需要在复盘时确认经验，其他不用做。',
  R6: '这是正常的保护：同一个版本重复跑同一个测试不会有新结果，所以被拦住了，避免空转和浪费。你不用做什么，Agent 会改代码、重新冻结版本后再测。',
}
function noted(rule, reason) { return `${reason}\n【给你的说明】${USER_NOTES[rule]}` }

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
    return noted('R5', '行业经验只能经用户逐条确认后，用 `python3 <project-retro>/scripts/lessons.py merge` 写入，不能直接编辑 lessons.jsonl。')
  }

  const root = findDeliveryRoot(path.dirname(target))
  if (!root) {
    // R3 加强：子 Agent 在等验收期间只能写 .delivery/qa/，写项目外的文件同样拒绝
    if (isRoot === false && cwd) {
      const cwdRoot = findDeliveryRoot(path.resolve(cwd))
      if (cwdRoot) {
        const cst = deliveryState(cwdRoot)
        if (cst.version !== undefined && !cst.qaExists) {
          return noted('R3QA', `当前交付项目（${cwdRoot}）的版本 ${cst.version} 正在等待独立验收，QA 子 Agent 只能写 .delivery/qa/ 下的验收结论，不能写其他文件（${target}）。`)
        }
      }
    }
    return undefined
  }
  const dDir = path.join(root, '.delivery')
  const rel = path.relative(dDir, target)
  const st = deliveryState(root)

  // R3 加强：冻结后等待验收期间，子 Agent 只能写 .delivery/qa/ 下的文件（主 Agent 由 R1 保护冻结文件）
  const inQaDir = rel === 'qa' || rel.startsWith(`qa${path.sep}`)
  if (isRoot === false && st.version !== undefined && !st.qaExists && !inQaDir) {
    return noted('R3QA', `当前冻结版本 ${st.version} 正在等待独立验收，QA 子 Agent 只能写 .delivery/qa/ 下的验收结论，不能改 ${path.relative(root, target) || target}。`)
  }

  // R2 freeze.json
  if (rel === 'freeze.json') {
    const text = tool === 'write' ? String(args.content ?? '') : afterEdit(target, args)
    let next
    try { next = JSON.parse(text) } catch { return noted('R2', 'freeze.json 必须是合法 JSON。') }
    const pre = QA_KEYS.filter((k) => k in next)
    if (pre.length) return noted('R2', `freeze.json 只记录版本、文件、哈希和测试命令，不能包含验收结论字段（${pre.join(', ')}）。验收结论由 QA 写入 .delivery/qa/<版本>.json。`)
    if (next.version === undefined) return noted('R2', 'freeze.json 缺少 version 字段。')
    if (st.version !== undefined) {
      const a = parseVersion(next.version), b = parseVersion(st.version)
      if (a && b) {
        const c = compareVersion(a, b)
        if (c < 0) return noted('R2', `版本号只能递增：当前已冻结 ${st.version}，不能改成更小的 ${next.version}。`)
        if (c === 0 && st.qaExists) return noted('R2', `版本 ${st.version} 已有 QA 结论，不能覆盖。改了文件就冻结为新版本（比 ${st.version} 大）。`)
      }
    }
    const qaDir = path.join(dDir, 'qa')
    if (fs.existsSync(path.join(qaDir, `${next.version}.json`))) return noted('R2', `版本 ${next.version} 已经验收过，请使用新的版本号。`)
    return undefined
  }

  // R3 QA 结论
  if (rel.startsWith(`qa${path.sep}`) && rel.endsWith('.json')) {
    if (isRoot === true) return noted('R3', 'QA 结论只能由独立 QA 子 Agent 写入，主 Agent 不能写或修改 .delivery/qa/ 下的文件。')
    return undefined
  }

  // R4 报告
  if (rel === 'report.md' && st.version !== undefined && !st.qaExists) {
    const text = tool === 'write' ? String(args.content ?? '') : afterEdit(target, args)
    if (!/未验收/.test(text)) return noted('R4', `当前冻结版本 ${st.version} 还没有独立 QA 结论（.delivery/qa/${st.version}.json）。先等 QA 返回再写报告；如果确实无法验收，在报告里写明“未验收”及原因。`)
    return undefined
  }

  // R1 冻结文件
  if (st.version !== undefined && !st.qaExists && st.files.includes(target)) {
    return noted('R1', `${path.relative(root, target)} 属于已冻结的版本 ${st.version}，正在等待独立验收，不能修改。等 QA 结果出来后再改；或者先把 freeze.json 升级为新版本（这会作废当前这轮验收）。`)
  }
  return undefined
}

// 判断 bash 命令会不会写文件。
// 只看 shell 层：先去掉引号里的内容和 heredoc 正文，避免把 `node -e '…=>…'`、`cp=require(…)`
// 这类脚本代码误当成重定向/cp 命令（实机误拦过 QA 的只读核对）。脚本代码里的写操作另用 CODE_WRITE 识别。
const SHELL_WRITE = /(?:^|[\s;&|(])(?:\d?>>?(?![&>])(?!\s*\/dev\/null)|&>)|\btee\b|\bsed\s+(?:-[a-zA-Z]*\s+)*-i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bdd\b|\bln\b|\binstall\b/
const CODE_WRITE = /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|renameSync|unlinkSync|rmSync|copyFileSync|cpSync|write_text|write_bytes|shutil\.(?:copy\w*|move|rmtree)|os\.(?:remove|unlink|rename|replace))\b|\bopen\([^)]*,\s*['"][wax]/
export function shellSkeleton(cmd) {
  let s = String(cmd ?? '')
  // heredoc：只保留 << 那一行，去掉正文
  s = s.replace(/(<<-?\s*(['"]?)([A-Za-z_][\w]*)\2[^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, '$1')
  // 引号里的内容
  s = s.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""')
  return s
}
export function looksWrite(cmd) {
  return SHELL_WRITE.test(shellSkeleton(cmd)) || CODE_WRITE.test(String(cmd ?? ''))
}
function evaluateBash(call) {
  const cmd = String(call.args?.command ?? '')
  const cwd = call.args?.workdir ? path.resolve(call.cwd ?? '/', String(call.args.workdir)) : call.cwd
  if (/lessons\.jsonl/.test(cmd) && looksWrite(cmd) && !/lessons\.py/.test(cmd)) {
    return noted('R5', '行业经验只能用 `lessons.py merge` 写入，不能用 shell 直接改 lessons.jsonl。')
  }
  if (!cwd) return undefined
  // 按命令实际作用的项目定位（cd 到子项目 / 参数里写了子项目路径时，用子项目而不是会话 cwd）
  const root = resolveCommandRoot(cmd, cwd)
  if (!root) return undefined
  const st = deliveryState(root)
  if (st.version === undefined) return undefined
  const role = call.isRoot === false ? 'subagent' : 'main'

  // R6 原样重跑拦截：同一冻结版本 + 同一测试命令 + 同一角色已经跑过验收，
  // 冻结期间文件不能改（R1），再跑一次结果不会变，只会空转和烧钱。
  // 只有“同一条命令”才拦（避免误伤 grep/cat 之类只是提到命令名的排查操作）。
  // 确实只是环境问题时，用 # retry_reason: … 放行。
  if (evidencePurpose(cmd, st.tests) === 'delivery' && !retryReason(cmd)) {
    const key = normalizeCommand(cmd)
    const prev = readEvidence(root).find((e) => e && e.purpose === 'delivery' &&
      String(e.version) === st.version &&
      (e.agent === 'subagent' ? 'subagent' : 'main') === role &&
      normalizeCommand(e.command) === key)
    if (prev) {
      return noted('R6', `同一冻结版本 ${st.version} 的同一个测试已经跑过了（${prev.ts ?? '之前'}），冻结期间文件没改，再跑一次结果不会变。先改代码并重新冻结版本；如果确实只是环境问题，在命令前加一行注释 \`# retry_reason: ...\` 再跑。`)
    }
  }

  // R3 加强（bash）：等验收期间子 Agent 只能写 .delivery/qa/，不能改 .delivery/ 里的其他文件
  if (call.isRoot === false && !st.qaExists && looksWrite(cmd) &&
    /\.delivery(?:[\\/]|$)/.test(cmd) && !/\.delivery[\\/]qa(?:[\\/]|$)/.test(cmd)) {
    return noted('R3QA', `当前冻结版本 ${st.version} 正在等待独立验收，QA 子 Agent 只能写 .delivery/qa/ 下的验收结论，不能改 .delivery/ 里的其他文件。`)
  }

  if (st.qaExists || !looksWrite(cmd)) return undefined
  for (const f of st.files) {
    const rel = path.relative(root, f)
    if (rel && (cmd.includes(rel) || cmd.includes(f))) {
      return noted('R1', `命令看起来会修改已冻结的 ${rel}（版本 ${st.version} 正在等待验收）。等 QA 结果出来再改，或先升级冻结版本。`)
    }
  }
  return undefined
}

/** E1：测试命令的证据记录（交付运行 delivery / 排查运行 diagnostic） */
export function recordEvidence(root, entry) {
  const st = deliveryState(root)
  if (!st.version) return false
  const purpose = evidencePurpose(entry.command, st.tests)
  if (!purpose) return false
  const output = String(entry.output ?? entry.output_tail ?? '')
  const counts = parseTestCounts(output)
  const reason = retryReason(entry.command)
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    version: st.version,
    agent: entry.agent,
    command: String(entry.command ?? ''),
    purpose,
    ...(reason ? { retry_reason: reason } : {}),
    is_error: Boolean(entry.is_error),
    output_tail: output.slice(-1500),
    tests: counts,
    // 解析不出通过/失败数时明确标记，避免把它当成“测试通过”
    ...(counts ? {} : { count_unconfirmed: true }),
  }) + '\n'
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
  // 只有当前版本还没拿到 QA 通过且返工 3 轮及以上才提示停下来确认范围；QA 通过之后返工轮数照常显示
  const reworkAlert = s.reworkAlert ?? ((s.rework ?? 0) >= 3 && s.qa?.verdict !== 'pass')
  const lines = [
    `交付工作台：${s.name}`,
    `下一步：${s.next?.text ?? ''}${s.rework ? `（返工 ${s.rework} 轮）` : ''}${reworkAlert ? ' 建议停下来和用户确认范围' : ''}`,
    `阶段：${s.stage}`,
    `冻结版本：${s.freeze.version ?? '未冻结'}${changed ? `（${changed} 个冻结文件被改或丢失）` : ''}`,
    `QA：${s.qa.exists ? s.qa.release_status || s.qa.verdict : '未验收'}`,
    `验收条目：${pass}/${s.acceptance.length} 通过`,
    `复盘候选：${s.retro.total} 条，待确认 ${s.retro.byReview.pending ?? 0} 条`,
  ]
  return { kind: 'success', text: lines.join('\n') }
}

export const DOCTOR_COMMAND = 'delivery-doctor'

/** 工具包根目录：bundle/ 的上一级（安装后是 ~/.dsh-delivery-kit） */
function kitDirOf() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

/** /delivery-doctor 的处理：逐项自检，返回中文结果 */
export async function doctorCommand(cwd) {
  const { doctorReport } = await import('./workbench/doctor.mjs')
  return { kind: 'success', text: doctorReport({ kitDir: kitDirOf(), cwd, home: os.homedir() }) }
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
    const { readWorkbench, listDeliveryProjects } = await import('./workbench/state.mjs')
    const projects = listDeliveryProjects(cwd)
    // 只允许在候选项目之间切换，不接受任意路径
    const asked = new URL(request.url).searchParams.get('project')
    const pick = projects.find((p) => p.root === asked) ?? projects[0]
    const s = readWorkbench(pick ? pick.root : cwd)
    return json({ ...s, projects: projects.map(({ root, name, goal }) => ({ root, name, goal })) })
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500)
  }
}

export function apply(ctx) {
  // 交付工作台命令：commands 服务不存在时（比如命令行无 UI 的组合）静默跳过
  if (typeof ctx.inject === 'function') ctx.inject(['commands'], (c) => {
    c.commands.register({
      name: DOCTOR_COMMAND,
      description: '自检交付工具包：插件版本、守卫是否加载、技能目录、交付项目文件和行业经验包',
      recordInput: false,
      handler: async (inv) => {
        try {
          const wd = ctx.get('workingDirectory')
          const cwd = wd && inv.agent ? wd.get(inv.agent.session) : undefined
          return await doctorCommand(cwd)
        } catch (e) {
          return { kind: 'error', text: `[交付工具自检] 检查失败：${e?.message ?? e}` }
        }
      },
    })
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
      // 证据要记到命令实际作用的项目（cd 子项目 / 参数里的子项目路径），而不是会话 cwd 的项目
      const root = resolveCommandRoot(String(args.command ?? ''), cwd)
      if (!root) return
      const out = textOf(result)
      recordEvidence(root, {
        agent: isRootOf(exec) === false ? 'subagent' : 'main',
        command: String(args.command ?? ''),
        is_error: Boolean(result?.isError),
        output: out,
        output_tail: out.slice(-1500),
      })
    } catch {
      // 证据记录失败不影响工具结果
    }
  })
}
