// 第 6 项：/delivery-doctor 自检命令的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctorReport } from '../bundle/workbench/doctor.mjs'
import { apply, DOCTOR_COMMAND } from '../bundle/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SKILLS = ['delivery-protocol', 'delivery-intake', 'independent-qa', 'industry-learning', 'project-retro']

function makeKit() {
  const kit = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'))
  fs.mkdirSync(path.join(kit, 'bundle'), { recursive: true })
  fs.writeFileSync(path.join(kit, 'bundle', 'package.json'), JSON.stringify({ name: '@local/delivery-kit', version: '1.4.1' }))
  for (const n of SKILLS) {
    fs.mkdirSync(path.join(kit, 'skills', n), { recursive: true })
    fs.writeFileSync(path.join(kit, 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n`)
  }
  return kit
}

function makeWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ws-'))
  const good = path.join(ws, '奶茶店')
  fs.mkdirSync(path.join(good, '.delivery', 'qa'), { recursive: true })
  fs.writeFileSync(path.join(good, '.delivery', 'contract.json'), JSON.stringify({ goal: '开业方案' }))
  fs.writeFileSync(path.join(good, '.delivery', 'freeze.json'), JSON.stringify({ version: 'v1' }))
  fs.writeFileSync(path.join(good, '.delivery', 'qa', 'v1.json'), JSON.stringify({ release_status: 'pass' }))
  const broken = path.join(ws, '健身房')
  fs.mkdirSync(path.join(broken, '.delivery'), { recursive: true })
  fs.writeFileSync(path.join(broken, '.delivery', 'freeze.json'), '{ 这不是 JSON')
  return { ws, good, broken }
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-home-'))
  const food = path.join(home, '.agents', 'skills', 'industry-food')
  fs.mkdirSync(food, { recursive: true })
  fs.writeFileSync(path.join(food, 'pack.json'), JSON.stringify({ industry: 'food', version: 1 }))
  const gov = path.join(home, '.agents', 'skills', 'industry-gov')
  fs.mkdirSync(gov, { recursive: true })
  return home
}
const linesOf = (text) => text.split('\n').filter(Boolean)

test('doctorReport：每行都是“✓/✗ 项目：说明”格式', () => {
  const { ws } = makeWorkspace()
  const text = doctorReport({ kitDir: makeKit(), cwd: ws, home: makeHome() })
  for (const line of linesOf(text)) {
    assert.match(line, /^[✓✗] [^：]+：.+/, `行格式不对：${line}`)
  }
})

test('doctorReport：版本、守卫、技能、工作目录、项目、经验包逐项检查', () => {
  const { ws, good } = makeWorkspace()
  const text = doctorReport({ kitDir: makeKit(), cwd: ws, home: makeHome() })
  assert.match(text, /✓ 插件版本：1\.4\.1/)
  assert.match(text, /✓ 守卫加载：\/delivery-doctor 能运行/)
  assert.match(text, /✓ 技能目录：5 个交付技能都在/)
  assert.ok(text.includes(`✓ 工作目录：${ws}（找到 2 个交付项目）`))
  assert.match(text, /✓ 交付项目：奶茶店/)
  assert.ok(text.includes(`✓ 交付项目：奶茶店 · ${good}`))
  assert.match(text, /✓ 项目 奶茶店：\.delivery\/ 的关键文件/)
  // 坏掉的 JSON 要点名
  assert.match(text, /✗ 项目 健身房：这些文件不是合法 JSON：freeze\.json/)
  // 行业经验包个数和版本号；没有 pack.json 的写“？”
  assert.match(text, /✓ 行业经验包：2 个：/)
  assert.match(text, /industry-food v1/)
  assert.match(text, /industry-gov v？/)
})

test('doctorReport：缺技能时给修复办法', () => {
  const { ws } = makeWorkspace()
  const kit = makeKit()
  fs.rmSync(path.join(kit, 'skills', 'delivery-intake'), { recursive: true })
  const text = doctorReport({ kitDir: kit, cwd: ws, home: makeHome() })
  assert.match(text, /✗ 技能目录：缺少 delivery-intake/)
  assert.match(text, /重新运行 install\.sh/)
})

test('doctorReport：install 目录不对、拿不到工作目录、经验包目录读不到', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-empty-'))
  const text = doctorReport({ kitDir: empty, cwd: undefined, home: undefined })
  assert.match(text, /✗ 插件版本：读不到/)
  assert.match(text, /✗ 技能目录：缺少/)
  assert.match(text, /✗ 工作目录：拿不到当前会话的工作目录/)
  assert.match(text, /✗ 行业经验包：拿不到用户主目录/)
  assert.match(text, /设置 HOME 环境变量后重新打开 DSH/)
})

test('doctorReport：没有交付项目和没有经验包时说明“还没有”，不是报错', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-empty-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-home-empty-'))
  const text = doctorReport({ kitDir: makeKit(), cwd: ws, home })
  assert.match(text, /✓ 工作目录：.*没有找到交付项目/)
  assert.match(text, /✓ 行业经验包：还没有/)
  assert.doesNotMatch(text, /✗/)
})

test('/delivery-doctor 注册到 commands 服务，返回中文检查结果', async () => {
  const { ws } = makeWorkspace()
  const registered = []
  const ctx = {
    on() {},
    get: (n) => (n === 'workingDirectory' ? { get: () => ws } : undefined),
    inject(names, fn) { if (names[0] === 'commands') fn({ commands: { register: (d) => registered.push(d) } }) },
  }
  apply(ctx)
  const doctor = registered.find((d) => d.name === DOCTOR_COMMAND)
  assert.ok(doctor, '应该注册 delivery-doctor 命令')
  assert.equal(DOCTOR_COMMAND, 'delivery-doctor')
  const r = await doctor.handler({ agent: { session: {} }, rawInput: '' })
  assert.equal(r.kind, 'success')
  assert.match(r.text, /✓ 插件版本：\d+\.\d+\.\d+/)
  assert.match(r.text, /✓ 守卫加载/)
  assert.match(r.text, /✓ 技能目录/)
  // 同一次 apply 里工作台命令也还在
  assert.ok(registered.some((d) => d.name === 'delivery-workbench'))
})

test('delivery-protocol 技能里提醒用户输入 /delivery-doctor', () => {
  const src = fs.readFileSync(path.join(here, '..', 'skills', 'delivery-protocol', 'SKILL.md'), 'utf8')
  assert.match(src, /检查一下交付工具/)
  assert.match(src, /\/delivery-doctor/)
})
