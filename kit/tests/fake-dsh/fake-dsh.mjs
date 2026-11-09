// 测试用的假 DSH 命令行：只模拟 `dsh plugin --profile <p> add <dir>` / `remove <name>`，
// 把注册结果写进 $DSH_HOME/profiles/<p>/package.json，供安装脚本核对。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const args = process.argv.slice(2)
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const i = args.indexOf('--profile')
const profile = i >= 0 ? args[i + 1] : 'desktop'
const rest = args.filter((_, k) => k !== i && k !== i + 1)
if (rest[0] !== 'plugin') { console.error('fake dsh: unsupported'); process.exit(2) }
const pkgFile = path.join(home, 'profiles', profile, 'package.json')
fs.mkdirSync(path.dirname(pkgFile), { recursive: true })
const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : { dependencies: {} }
pkg.dependencies ??= {}
if (rest[1] === 'add') {
  const dir = rest[2]
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const patch = fs.readFileSync(path.join(dir, 'cordis.patch.yml'), 'utf8')
  if (patch.includes('__KIT_DIR__')) { console.error('fake dsh: patch not rendered'); process.exit(3) }
  if (pkg.dependencies[meta.name] && process.env.FAKE_DSH_FAIL_IF_EXISTS) { console.error('fake dsh: already installed'); process.exit(4) }
  pkg.dependencies[meta.name] = 'file:' + dir
} else if (rest[1] === 'remove') {
  delete pkg.dependencies[rest[2]]
} else { console.error('fake dsh: unsupported'); process.exit(2) }
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2))
console.log(`fake dsh: ${rest[1]} ok (${profile})`)
