// 跨副本的共享规则同步检查。
// 同一套交付规则在仓库里有 4 份（claude 源码 / codex 与 agent 生成 / kit 手写），
// 生成的两份由 build.py --check 守门，kit 那份没有生成流程，只能在这里守。
// 上次就是这里漏同步：kit 的 lessons.py 少了技能名校验，中文行业名能建出不合规的技能。
// 运行：node --test "kit/tests/*.test.mjs"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..', '..')

const COPIES = {
  claude: 'claude-skill/delivery-contract/scripts/lessons.py',
  codex: 'codex-skill/delivery-contract/scripts/lessons.py',
  agent: 'agent-skill/delivery-contract/scripts/lessons.py',
  kit: 'kit/skills/project-retro/scripts/lessons.py',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 取出形如 `NAME = [...]` / `NAME = {...}` 的整块赋值，去掉空白差异后用于比较
function block(src, name, open, close) {
  const m = src.match(new RegExp(`^${name} = \\${open}[\\s\\S]*?\\${close}`, 'm'))
  assert.ok(m, `没找到 ${name} 定义`)
  return m[0].replace(/\s+/g, ' ')
}

function scalar(src, name) {
  const m = src.match(new RegExp(`^${name} = (.+)$`, 'm'))
  assert.ok(m, `没找到 ${name} 定义`)
  return m[1].trim()
}

test('脱敏规则表 PATTERNS：四份 lessons.py 必须完全一致', () => {
  const ref = block(read(COPIES.claude), 'PATTERNS', '[', ']')
  for (const [name, rel] of Object.entries(COPIES)) {
    assert.equal(block(read(rel), 'PATTERNS', '[', ']'), ref, `${name} 版的 PATTERNS 与 Claude 版不一致：脱敏规则漏改了`)
  }
})

test('经验类型 TYPES / TYPE_NAMES：四份 lessons.py 必须完全一致', () => {
  for (const [key, open, close] of [['TYPES', '[', ']'], ['TYPE_NAMES', '{', '}']]) {
    const expected = block(read(COPIES.claude), key, open, close)
    for (const [name, rel] of Object.entries(COPIES)) {
      assert.equal(block(read(rel), key, open, close), expected, `${name} 版的 ${key} 与 Claude 版不一致`)
    }
  }
})

test('模板渲染标记 MARK_BEGIN / MARK_END：四份 lessons.py 必须完全一致', () => {
  for (const key of ['MARK_BEGIN', 'MARK_END']) {
    const expected = scalar(read(COPIES.claude), key)
    for (const [name, rel] of Object.entries(COPIES)) {
      assert.equal(scalar(read(rel), key), expected, `${name} 版的 ${key} 不一致：合并经验时会写坏 SKILL.md`)
    }
  }
})

test('kit 的行业经验包模板由 build.py 生成，不是手写', () => {
  const pkg = read('kit/skills/project-retro/pack-template/SKILL.md')
  // 生成结果会带 whenToUse（Claude 版没有）并且不留 delivery-contract 字样
  assert.match(pkg, /^whenToUse: /m)
  assert.doesNotMatch(pkg, /delivery-contract/)
  assert.equal(fs.existsSync(path.join(ROOT, 'kit/skills/project-retro/pack-template/SKILL.md.tmpl')), false,
    'kit 模板不该有 SKILL.md.tmpl：生成时会改成 SKILL.md')
})
