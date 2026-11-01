// 把 readWorkbench() 的结果渲染成一个自包含的 HTML 页面（无外部资源、无脚本）。
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

const STATUS = {
  pass: ['通过', 'ok'],
  fail: ['未通过', 'bad'],
  other: ['其他', 'warn'],
  missing: ['QA 未覆盖', 'bad'],
  none: ['未验收', 'mute'],
}
const FILE = {
  unchanged: ['未变', 'ok'],
  modified: ['冻结后被改', 'bad'],
  missing: ['文件不见了', 'bad'],
  unknown: ['未记录哈希', 'warn'],
}
const VERDICT = { pass: ['可交付', 'ok'], fail: ['不可交付', 'bad'], unknown: ['结论不明', 'warn'], none: ['未验收', 'mute'] }
const pill = ([label, cls]) => `<span class="pill ${cls}">${esc(label)}</span>`
const list = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${esc(text(x))}</li>`).join('')}</ul>` : '<p class="mute">无</p>')

export function renderWorkbench(s, { now = new Date() } = {}) {
  if (!s.found) {
    return page('交付工作台', `<p>在 ${esc(s.start)} 及上级目录里没有找到 <code>.delivery/</code>，这个项目还没有进入交付流程。</p>`, now)
  }
  const c = s.contract
  const rows = s.acceptance
  const passN = rows.filter((r) => r.status === 'pass').length
  const cv = s.evidence.currentVersion
  const testText = cv.unconfirmed === false ? `${cv.passed ?? 0}/${cv.total ?? 0}` : '数量未确认'
  const rework = s.rework ?? 0
  // 顶部一句话：现在卡在哪、在等谁；返工 3 轮及以上标红并提示停下来确认范围
  const nextLine = `<div class="next${rework >= 3 ? ' alert' : ''}">下一步：${esc(s.next?.text ?? '')}${
    rework ? `（返工 ${rework} 轮）` : ''
  }${rework >= 3 ? ' 建议停下来和用户确认范围' : ''}</div>`
  const head = `
<header>
  <h1>${esc(s.name)} <small>交付工作台</small></h1>
  ${nextLine}
  <div class="kpis">
    <div><b>${esc(s.stage)}</b><span class="lbl">当前阶段</span></div>
    <div><b>${esc(s.freeze.version ?? '—')}</b><span class="lbl">冻结版本</span></div>
    <div>${pill(VERDICT[s.qa.verdict] ?? VERDICT.unknown)}<span class="lbl">QA 结论</span></div>
    <div><b>${passN}/${rows.length}</b><span class="lbl">验收通过</span></div>
    <div><b>${esc(testText)}</b><span class="lbl">测试</span></div>
  </div>
</header>`

  const contract = c
    ? `<section><h2>合同 ${c.confirmed_by_user ? pill(['用户已确认', 'ok']) : pill(['用户未确认', 'warn'])}</h2>
<p><b>目标：</b>${esc(c.goal)}</p>
<p><b>行业：</b>${esc(c.industry || '未填')}　<b>合规：</b>${esc(c.compliance || '未填')}</p>
<h3>交付物</h3>${list(c.deliverables)}
<h3>假设</h3>${list(c.assumptions)}</section>`
    : '<section><h2>合同</h2><p class="mute">还没有 contract.json。</p></section>'

  const acc = `<section><h2>验收条目</h2>${
    rows.length
      ? `<table><thead><tr><th>编号</th><th>条目</th><th>状态</th><th>证据</th></tr></thead><tbody>${rows
          .map(
            (r) => `<tr${r.orphan ? ' class="orphan"' : ''}><td>${esc(r.id)}</td><td>${esc(r.statement)}${
              r.orphan ? '<div class="note">合同里没有这条（可能被删了）</div>' : ''
            }${r.source ? `<div class="note">来源：${esc(text(r.source))}</div>` : ''}</td><td>${pill(STATUS[r.status] ?? STATUS.other)}${
              r.status === 'other' ? `<div class="note">${esc(r.rawStatus)}</div>` : ''
            }</td><td class="ev">${esc(text(r.evidence))}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="mute">合同里没有验收条目。</p>'
  }</section>`

  const files = s.freeze.files
  const freeze = `<section><h2>冻结 ${s.freeze.version ? esc(s.freeze.version) : ''}</h2>${
    s.freeze.version
      ? `${files.length ? `<table><thead><tr><th>文件</th><th>哈希核对</th></tr></thead><tbody>${files
          .map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>${pill(FILE[f.status])}</td></tr>`)
          .join('')}</tbody></table>` : '<p class="mute">冻结清单为空。</p>'}
<h3>测试命令</h3>${s.freeze.tests.length ? `<ul>${s.freeze.tests.map((t) => `<li><code>${esc(t)}</code></li>`).join('')}</ul>` : '<p class="mute">无</p>'}
<p class="note">本版本已记录 ${s.evidence.currentVersion.runs} 次测试运行，其中 ${s.evidence.currentVersion.errors} 次出错。验收历史：${esc(s.qa.history.join('、') || '无')}</p>`
      : '<p class="mute">还没有冻结。</p>'
  }</section>`

  const qa = `<section><h2>QA 结论</h2>${
    s.qa.exists
      ? `<p>${pill(VERDICT[s.qa.verdict] ?? VERDICT.unknown)} ${esc(s.qa.release_status)}</p>
<h3>必须修复</h3>${list(s.qa.must_fix)}<h3>发布缺口</h3>${list(s.qa.release_gaps)}<h3>建议</h3>${list(s.qa.suggestions)}`
      : '<p class="mute">当前版本还没有独立 QA 结论。</p>'
  }</section>`

  const ev = `<section><h2>最近的测试证据</h2>${
    s.evidence.recent.length
      ? `<table><thead><tr><th>时间</th><th>版本</th><th>执行者</th><th>命令</th><th>结果</th></tr></thead><tbody>${s.evidence.recent
          .map(
            (e) => `<tr><td>${esc(e.ts ?? '')}</td><td>${esc(e.version ?? '')}</td><td>${esc(e.agent === 'subagent' ? '子 Agent' : '主 Agent')}</td><td><code>${esc(
              e.command ?? ''
            )}</code><details><summary>输出末尾</summary><pre>${esc(e.output_tail ?? '')}</pre></details></td><td>${pill(e.is_error ? ['出错', 'bad'] : ['正常', 'ok'])}</td></tr>`
          )
          .join('')}</tbody></table>`
      : '<p class="mute">还没有证据记录（守卫插件会在运行冻结清单里的测试命令时自动记录）。</p>'
  }</section>`

  const rb = s.retro.byReview
  const tail = `<section><h2>报告与复盘</h2>
<p><b>报告：</b>${s.report.exists ? (s.report.unverified ? pill(['已写，注明未验收', 'warn']) : pill(['已写', 'ok'])) : pill(['未写', 'mute'])}</p>
<p><b>用到的行业经验：</b>${s.industryUsage.length} 条</p>
<p><b>复盘候选经验：</b>${s.retro.total} 条${
    s.retro.total ? `（待确认 ${rb.pending ?? 0}，已确认 ${(rb.approved ?? 0) + (rb.edited ?? 0)}，已拒绝 ${rb.rejected ?? 0}）` : ''
  }</p></section>`

  return page(`${s.name} · 交付工作台`, head + contract + acc + freeze + qa + ev + tail, now)
}

function page(title, body, now) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#e5e5ea;--ok:#1a7f37;--bad:#c62828;--warn:#9a6700;--card:#f6f6f8}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#f2f2f7;--mute:#a1a1a6;--line:#3a3a3c;--ok:#4cc26a;--bad:#ff6b6b;--warn:#e3b341;--card:#2c2c2e}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 12px}h1 small{font-size:14px;color:var(--mute);font-weight:400}
h2{font-size:16px;margin:0 0 8px}h3{font-size:13px;color:var(--mute);margin:12px 0 4px}
section{border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.next{margin:10px 0 0;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);font-size:13px}
.next.alert{border-color:var(--bad);color:var(--bad);font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:12px}
.kpis div{background:var(--card);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:4px}
.kpis b{font-size:18px}.kpis .lbl{color:var(--mute);font-size:12px}.kpis .pill{align-self:flex-start;font-size:14px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-top:1px solid var(--line)}
th{color:var(--mute);font-weight:500;font-size:12px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid currentColor;white-space:nowrap}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.mute{color:var(--mute)}
.note{color:var(--mute);font-size:12px}.ev{font-size:12px;max-width:320px;word-break:break-word}
.orphan td{background:var(--card)}code{font-size:12px}pre{white-space:pre-wrap;font-size:11px;max-height:240px;overflow:auto}
footer{color:var(--mute);font-size:12px;text-align:center;margin:24px 0}
@media (max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body><main>${body}<footer>生成于 ${esc(now.toISOString())} · 只读汇总 .delivery/，不修改任何文件</footer></main></body></html>
`
}
