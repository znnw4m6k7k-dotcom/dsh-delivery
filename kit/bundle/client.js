// 交付工作台面板（Client 端）。会话标题栏右侧加一个按钮，点开后显示当前会话的交付状态。
// 数据来自 Host 端只读路由 GET api/deliverykit.workbench（同源 fetch，不经过命令，不会在聊天里留下记录）。
// 样式只用 --dsw-alias-* 主题 token；文案走 Client locale 服务。
window.__ModuleLoader__.load({
  id: '@local/delivery-kit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'local.deliveryKit.workbench'

    const zh = {
      button: '交付工作台', title: '交付工作台', project: '项目', refresh: '刷新', close: '关闭', loading: '读取中…',
      none: '这个会话的工作目录里还没有 .delivery/，项目还没有进入交付流程。',
      failed: '读取失败：{reason}', next: '下一步', test: '测试', testUnknown: '数量未确认', rework: '返工 {n} 轮', reworkHint: '建议停下来和用户确认范围',
      stage: '阶段', version: '冻结版本', qa: 'QA 结论', passed: '验收通过',
      contract: '合同', confirmed: '用户已确认', unconfirmed: '用户未确认', goal: '目标', industry: '行业',
      acceptance: '验收条目', noAcceptance: '合同里没有验收条目。', orphan: '合同里没有这条',
      freeze: '冻结文件', noFreeze: '还没有冻结。', tests: '本版本测试运行 {runs} 次，出错 {errors} 次',
      mustFix: '必须修复', gaps: '发布缺口', evidence: '最近的测试证据', noEvidence: '还没有证据记录。',
      retro: '复盘候选 {total} 条，待确认 {pending} 条', report: '报告', reportYes: '已写', reportNo: '未写',
      reportUnverified: '已写（注明未验收）', notFrozen: '未冻结', notChecked: '未验收',
      's.pass': '通过', 's.fail': '未通过', 's.other': '其他', 's.missing': 'QA 未覆盖', 's.none': '未验收',
      'f.unchanged': '未变', 'f.modified': '冻结后被改', 'f.missing': '文件不见了', 'f.unknown': '未记录哈希',
      'v.pass': '可交付', 'v.fail': '不可交付', 'v.unknown': '结论不明', 'v.none': '未验收',
      'e.ok': '正常', 'e.err': '出错',
    }
    const en = {
      button: 'Delivery workbench', title: 'Delivery workbench', project: 'Project', refresh: 'Refresh', close: 'Close', loading: 'Loading…',
      none: 'No .delivery/ in this session\'s working directory yet.',
      failed: 'Failed to read: {reason}', next: 'Next', test: 'Tests', testUnknown: 'Count unconfirmed', rework: '{n} rework rounds', reworkHint: 'Suggest stopping to confirm scope with the user',
      stage: 'Stage', version: 'Frozen version', qa: 'QA verdict', passed: 'Accepted',
      contract: 'Contract', confirmed: 'Confirmed by user', unconfirmed: 'Not confirmed', goal: 'Goal', industry: 'Industry',
      acceptance: 'Acceptance items', noAcceptance: 'No acceptance items in the contract.', orphan: 'Not in contract',
      freeze: 'Frozen files', noFreeze: 'Not frozen yet.', tests: '{runs} test runs for this version, {errors} failed',
      mustFix: 'Must fix', gaps: 'Release gaps', evidence: 'Recent test evidence', noEvidence: 'No evidence recorded yet.',
      retro: '{total} retro candidates, {pending} awaiting review', report: 'Report', reportYes: 'Written', reportNo: 'Not written',
      reportUnverified: 'Written (marked unverified)', notFrozen: 'Not frozen', notChecked: 'Not checked',
      's.pass': 'Pass', 's.fail': 'Fail', 's.other': 'Other', 's.missing': 'Not covered by QA', 's.none': 'Not checked',
      'f.unchanged': 'Unchanged', 'f.modified': 'Changed after freeze', 'f.missing': 'Missing', 'f.unknown': 'No hash',
      'v.pass': 'Releasable', 'v.fail': 'Not releasable', 'v.unknown': 'Unclear', 'v.none': 'Not checked',
      'e.ok': 'OK', 'e.err': 'Error',
    }

    const TONE = { ok: 'var(--dsw-alias-state-success-primary)', bad: 'var(--dsw-alias-state-error-primary)', warn: 'var(--dsw-alias-state-warn-primary)', mute: 'var(--dsw-alias-label-secondary)' }
    const S_TONE = { pass: 'ok', fail: 'bad', other: 'warn', missing: 'bad', none: 'mute' }
    const F_TONE = { unchanged: 'ok', modified: 'bad', missing: 'bad', unknown: 'warn' }
    const V_TONE = { pass: 'ok', fail: 'bad', unknown: 'warn', none: 'mute' }
    const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))

    const css = {
      button: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, fontSize: 12 },
      next: { marginTop: 8, padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)', fontSize: 13 },
      panel: { position: 'fixed', top: 56, right: 16, bottom: 16, width: 420, zIndex: 50, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-overlay, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.18)', fontSize: 13, lineHeight: 1.5 },
      head: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 16px 16px' },
      h: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '14px 0 6px', fontWeight: 600 },
      kpis: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 },
      kpi: { background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 8, padding: '8px 10px' },
      row: { display: 'flex', gap: 8, padding: '6px 0', borderTop: '1px solid var(--dsw-alias-border-l2)' },
      note: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      select: { flex: 1, minWidth: 0, background: 'var(--dsw-alias-bg-layer-1, Field)', color: 'inherit', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '2px 6px', fontSize: 12 },
      code: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, wordBreak: 'break-all' },
    }
    const Pill = ({ tone, children }) => h('span', { style: { color: TONE[tone] ?? TONE.mute, border: '1px solid currentColor', borderRadius: 999, padding: '0 8px', fontSize: 11, whiteSpace: 'nowrap', flex: 'none' } }, children)
    const Kpi = ({ label, children }) => h('div', { style: css.kpi }, h('div', { style: { fontWeight: 600 } }, children), h('div', { style: css.note }, label))
    const List = ({ items }) => h('ul', { style: { margin: 0, paddingLeft: 18 } }, items.map((x, i) => h('li', { key: i }, str(x))))

    function Content({ s, t }) {
      if (!s.found) return h('p', { style: css.note }, t('none'))
      const pass = s.acceptance.filter((r) => r.status === 'pass').length
      const c = s.contract
      // 本版本最近一次验收运行的测试计数；解析不出来时显示“数量未确认”
      const cv = s.evidence.currentVersion
      const testText = cv.unconfirmed === false ? `${cv.passed ?? 0}/${cv.total ?? 0}` : t('testUnknown')
      const rework = s.rework ?? 0
      // 只有当前版本还没拿到 QA 通过且返工 3 轮及以上才标红；QA 通过之后只显示轮数，不标红、不提示
      const alert = s.reworkAlert ?? (rework >= 3 && s.qa?.verdict !== 'pass')
      // 顶部一句话：现在卡在哪、在等谁
      const nextLine = h('div', { style: { ...css.next, ...(alert ? { color: TONE.bad, borderColor: TONE.bad, fontWeight: 600 } : {}) } },
        t('next') + '：' + (s.next?.text ?? ''),
        rework > 0 ? '（' + t('rework', { n: String(rework) }) + '）' : '',
        alert ? ' ' + t('reworkHint') : '')
      return h(React.Fragment, null,
        nextLine,
        h('div', { style: css.kpis },
          h(Kpi, { label: t('stage') }, s.stage),
          h(Kpi, { label: t('version') }, s.freeze.version ?? t('notFrozen')),
          h(Kpi, { label: t('qa') }, h(Pill, { tone: V_TONE[s.qa.verdict] }, t('v.' + s.qa.verdict))),
          h(Kpi, { label: t('passed') }, `${pass}/${s.acceptance.length}`),
          h(Kpi, { label: t('test') }, testText)),
        c && h(React.Fragment, null,
          h('div', { style: css.h }, t('contract'), ' ', h(Pill, { tone: c.confirmed_by_user ? 'ok' : 'warn' }, t(c.confirmed_by_user ? 'confirmed' : 'unconfirmed'))),
          h('div', null, h('b', null, t('goal'), '：'), c.goal),
          c.industry && h('div', null, h('b', null, t('industry'), '：'), c.industry)),
        h('div', { style: css.h }, t('acceptance')),
        s.acceptance.length === 0 ? h('div', { style: css.note }, t('noAcceptance')) : s.acceptance.map((r) => h('div', { key: r.id + (r.orphan ? '*' : ''), style: css.row },
          h('span', { style: { ...css.code, flex: 'none', minWidth: 28 } }, r.id),
          h('div', { style: { flex: 1 } }, r.statement, r.orphan && h('div', { style: css.note }, t('orphan')), r.evidence && h('div', { style: css.note }, str(r.evidence))),
          h(Pill, { tone: S_TONE[r.status] }, t('s.' + r.status)))),
        h('div', { style: css.h }, t('freeze')),
        !s.freeze.version ? h('div', { style: css.note }, t('noFreeze')) : h(React.Fragment, null,
          s.freeze.files.map((f) => h('div', { key: f.path, style: css.row }, h('span', { style: { ...css.code, flex: 1 } }, f.path), h(Pill, { tone: F_TONE[f.status] }, t('f.' + f.status)))),
          h('div', { style: css.note }, t('tests', { runs: String(s.evidence.currentVersion.runs), errors: String(s.evidence.currentVersion.errors) }))),
        s.qa.must_fix.length > 0 && h(React.Fragment, null, h('div', { style: css.h }, t('mustFix')), h(List, { items: s.qa.must_fix })),
        s.qa.release_gaps.length > 0 && h(React.Fragment, null, h('div', { style: css.h }, t('gaps')), h(List, { items: s.qa.release_gaps })),
        h('div', { style: css.h }, t('evidence')),
        s.evidence.recent.length === 0 ? h('div', { style: css.note }, t('noEvidence')) : s.evidence.recent.slice(0, 8).map((e, i) => h('div', { key: i, style: css.row },
          h('div', { style: { flex: 1 } }, h('div', { style: css.code }, e.command ?? ''), h('div', { style: css.note }, `${e.ts ?? ''} · ${e.version ?? ''}`)),
          h(Pill, { tone: e.is_error ? 'bad' : 'ok' }, t(e.is_error ? 'e.err' : 'e.ok')))),
        h('div', { style: css.h }, t('report')),
        h('div', null, t(s.report.exists ? (s.report.unverified ? 'reportUnverified' : 'reportYes') : 'reportNo')),
        h('div', { style: { ...css.note, marginTop: 6 } }, t('retro', { total: String(s.retro.total), pending: String(s.retro.byReview.pending ?? 0) })))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'delivery-kit: workbench dictionaries')

        async function load(sessionId, project, signal) {
          const q = 'sessionId=' + encodeURIComponent(sessionId) + (project ? '&project=' + encodeURIComponent(project) : '')
          const res = await fetch('api/deliverykit.workbench?' + q, { signal, cache: 'no-store' })
          const body = await res.json().catch(() => undefined)
          if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
          if (!body || typeof body.found !== 'boolean') throw new Error('unexpected response')
          return body
        }

        // 渲染出错时显示错误，不让整个标题栏崩掉
        class Boundary extends React.Component {
          constructor(props) { super(props); this.state = { error: undefined } }
          static getDerivedStateFromError(error) { return { error } }
          render() { return this.state.error ? h('p', { style: { color: TONE.bad } }, String(this.state.error?.message ?? this.state.error)) : this.props.children }
        }

        function WorkbenchButton({ sessionId, t }) {
          const [open, setOpen] = React.useState(false)
          const [state, setState] = React.useState({ loading: false })
          const [tick, setTick] = React.useState(0)
          const [project, setProject] = React.useState(undefined)
          React.useEffect(() => {
            if (!open || !sessionId) return undefined
            const ac = new AbortController()
            setState((prev) => ({ ...prev, loading: true, error: undefined }))
            load(sessionId, project, ac.signal).then(
              (s) => { if (!ac.signal.aborted) setState({ loading: false, s }) },
              (e) => { if (!ac.signal.aborted) setState({ loading: false, error: String(e?.message ?? e) }) })
            return () => ac.abort()
          }, [open, sessionId, project, tick])
          const projects = state.s?.projects ?? []
          const refresh = () => setTick((n) => n + 1)
          React.useEffect(() => {
            if (!open) return undefined
            const onKey = (ev) => { if (ev.key === 'Escape') setOpen(false) }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [open])
          return h(React.Fragment, null,
            h('button', { type: 'button', style: css.button, title: t('button'), 'aria-expanded': open, onClick: () => setOpen(!open) }, t('button')),
            open && h('div', { role: 'dialog', 'aria-label': t('title'), style: css.panel },
              h('div', { style: css.head },
                h('div', { style: { fontWeight: 600, flex: 1 } }, t('title'), state.s?.name ? ` · ${state.s.name}` : ''),
                h('button', { type: 'button', style: css.button, onClick: refresh }, t('refresh')),
                h('button', { type: 'button', style: css.button, onClick: () => setOpen(false) }, t('close'))),
              projects.length > 1 && h('div', { style: { ...css.head, paddingTop: 8, paddingBottom: 8 } },
                h('span', { style: css.note }, t('project')),
                h('select', { value: state.s?.root ?? '', onChange: (ev) => setProject(ev.target.value), style: css.select },
                  projects.map((p) => h('option', { key: p.root, value: p.root }, p.goal ? `${p.name} · ${p.goal.slice(0, 24)}` : p.name)))),
              h('div', { style: css.body },
                state.error ? h('p', { style: { color: TONE.bad } }, t('failed', { reason: state.error }))
                  : state.s ? h(Boundary, { key: tick }, state.loading && h('p', { style: css.note }, t('loading')), h(Content, { s: state.s, t }))
                  : h('p', { style: css.note }, t('loading')))))
        }

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'delivery-workbench',
          order: 50,
          locale: NS,
          label: () => ctx.locale.bind(NS)('button'),
        }, WorkbenchButton))
      },
    }
  },
})
