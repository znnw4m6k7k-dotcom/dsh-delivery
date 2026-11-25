// 经验包技能名（Agent Skills 的 name）必须是 [a-z0-9-]：Claude / Codex 版会拒绝中文名，
// DSH 版生成的经验包以后要能跨客户端复用，所以这里也要拦住。
// 运行：node --test "kit/tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(here, '..', 'skills', 'project-retro', 'scripts', 'lessons.py')

// CI 上三个系统都装了 python；本地没装就跳过，不让测试挡住无关改动
function python() {
  for (const cmd of process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)'])
    if (r.status === 0) return cmd
  }
  return undefined
}
const PY = python()

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-name-'))
}

function newPack(cwd, pack, industry, scenario) {
  return spawnSync(PY, [SCRIPT, 'new-pack', pack, '--industry', industry, '--scenario', scenario, '--title', '测试经验包'], {
    cwd, encoding: 'utf8',
  })
}

test('中文行业名：拒绝创建，并说清楚命名规则', { skip: !PY && '没有可用的 python3' }, () => {
  const cwd = workspace()
  const r = newPack(cwd, 'industry-餐饮-小店开业', '餐饮', '小店开业')
  assert.notEqual(r.status, 0, '中文技能名应该被拒绝')
  assert.match(r.stderr + r.stdout, /不合规/)
  assert.match(r.stderr + r.stdout, /小写字母、数字和连字符/)
  assert.equal(fs.existsSync(path.join(cwd, 'industry-餐饮-小店开业', 'pack.json')), false)
})

test('合规 slug：能创建，SKILL.md 的 name 与目录名一致', { skip: !PY && '没有可用的 python3' }, () => {
  const cwd = workspace()
  const name = 'industry-food-beverage-small-store-launch'
  const r = newPack(cwd, name, 'food-beverage', 'small-store-launch')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.equal(fs.existsSync(path.join(cwd, name, 'pack.json')), true)
  const skill = fs.readFileSync(path.join(cwd, name, 'SKILL.md'), 'utf8')
  assert.match(skill, new RegExp(`^name: ${name}$`, 'm'))
})

test('目录名与技能名不一致：提醒改名，但仍然创建', { skip: !PY && '没有可用的 python3' }, () => {
  const cwd = workspace()
  const r = newPack(cwd, 'my-pack', 'food-beverage', 'small-store')
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.match(r.stdout, /最好命名为 industry-food-beverage-small-store/)
  assert.equal(fs.existsSync(path.join(cwd, 'my-pack', 'SKILL.md')), true)
})
