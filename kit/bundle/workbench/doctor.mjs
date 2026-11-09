// 交付工具包自检（/delivery-doctor 的数据层）：只读检查，不改任何文件。
// 每行格式固定为“✓ 项目：说明”或“✗ 项目：怎么修”，方便用户一眼看出哪里不正常、怎么修。
import fs from 'node:fs'
import path from 'node:path'
import { listDeliveryProjects } from './state.mjs'

// 交付预设需要随包安装的技能目录
const REQUIRED_SKILLS = ['delivery-protocol', 'delivery-intake', 'independent-qa', 'industry-learning', 'project-retro']

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

/**
 * 生成自检报告。
 * kitDir：工具包根目录（安装后是 ~/.dsh-delivery-kit，里面有 bundle/ 和 skills/）
 * cwd：当前会话的工作目录
 * home：用户主目录（行业经验包在 ~/.agents/skills/ 下的 industry-… 目录里）
 */
export function doctorReport({ kitDir, cwd, home } = {}) {
  const lines = []
  const ok = (item, text) => lines.push(`✓ ${item}：${text}`)
  const bad = (item, fix) => lines.push(`✗ ${item}：${fix}`)
  const kit = kitDir ? path.resolve(kitDir) : undefined

  // 1. 插件版本：读 bundle/package.json 的 version
  const pkgFile = kit ? path.join(kit, 'bundle', 'package.json') : undefined
  const pkg = pkgFile ? readJson(pkgFile) : undefined
  if (pkg && typeof pkg.version === 'string') ok('插件版本', pkg.version)
  else bad('插件版本', `读不到 ${pkgFile ?? 'bundle/package.json'} 的版本号；重新运行 install.sh 覆盖安装`)

  // 2. 守卫是否加载：这个命令能运行，就说明 Host 插件加载成功
  ok('守卫加载', '/delivery-doctor 能运行，说明交付守卫 Host 插件已加载')

  // 3. 技能目录：交付预设依赖的 5 个技能是否都在
  if (!kit) {
    bad('技能目录', '不知道工具包装在哪；重新运行 install.sh')
  } else {
    const skillsDir = path.join(kit, 'skills')
    const missing = REQUIRED_SKILLS.filter((n) => !fs.existsSync(path.join(skillsDir, n, 'SKILL.md')))
    if (missing.length) bad('技能目录', `缺少 ${missing.join('、')}（应在 ${skillsDir} 下）；重新运行 install.sh 覆盖安装`)
    else ok('技能目录', `${REQUIRED_SKILLS.length} 个交付技能都在 ${skillsDir}`)
  }

  // 4. 当前工作目录和找到的交付项目
  if (!cwd) {
    bad('工作目录', '拿不到当前会话的工作目录；在项目目录里重新打开会话再试')
  } else {
    const projects = listDeliveryProjects(cwd)
    if (!projects.length) ok('工作目录', `${cwd}（没有找到交付项目，还没有 .delivery/）`)
    else ok('工作目录', `${cwd}（找到 ${projects.length} 个交付项目）`)

    // 5. 每个项目的 .delivery/ 关键文件能否正常解析；坏掉的 JSON 要指出文件名
    for (const p of projects) {
      ok('交付项目', `${p.name} · ${p.root}`)
      const d = path.join(p.root, '.delivery')
      const broken = []
      const check = (rel) => {
        const full = path.join(d, rel)
        if (!fs.existsSync(full)) return
        try { JSON.parse(fs.readFileSync(full, 'utf8')) } catch { broken.push(rel) }
      }
      check('contract.json')
      check('freeze.json')
      let qaFiles = []
      try { qaFiles = fs.readdirSync(path.join(d, 'qa')).filter((n) => n.endsWith('.json')) } catch {}
      for (const f of qaFiles) check(path.join('qa', f))
      if (broken.length) bad(`项目 ${p.name}`, `这些文件不是合法 JSON：${broken.join('、')}（打开对应文件修正 JSON，或删掉重写）`)
      else ok(`项目 ${p.name}`, '.delivery/ 的关键文件（contract.json、freeze.json、qa/*.json）都能正常解析')
    }
  }

  // 6. 行业经验包：~/.agents/skills/industry-* 有几个、各自版本号
  const homeDir = home ? path.resolve(home) : undefined
  if (!homeDir) {
    bad('行业经验包', '拿不到用户主目录，无法检查 ~/.agents/skills/ 下的 industry-…；设置 HOME 环境变量后重新打开 DSH 再试')
  } else {
    const packsDir = path.join(homeDir, '.agents', 'skills')
    let packs = []
    try {
      packs = fs.readdirSync(packsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith('industry-'))
        .map((e) => e.name)
    } catch {}
    if (!packs.length) {
      ok('行业经验包', '还没有（复盘并经你逐条确认后才会生成）')
    } else {
      const detail = packs.map((n) => {
        const pack = readJson(path.join(packsDir, n, 'pack.json'))
        return `${n} v${pack?.version ?? '？'}`
      })
      ok('行业经验包', `${packs.length} 个：${detail.join('、')}`)
    }
  }

  return lines.join('\n')
}
