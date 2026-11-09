// 第 1 项：测试证据计数（E1 增强）的单元测试
// 运行：node --test tests/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseTestCounts, evidencePurpose, retryReason, recordEvidence, readEvidence, normalizeCommand } from '../bundle/index.js'

function project(freeze) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  if (freeze) fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify(freeze))
  return root
}
const F = { version: 'v1', files: [], test_commands: ['node --test'] }

test('parseTestCounts：node --test 的 # pass / # fail / # tests', () => {
  assert.deepEqual(parseTestCounts('# tests 5\n# pass 4\n# fail 1\n'), { passed: 4, failed: 1, total: 5 })
  // Node 20+ 用 ℹ 前缀，也要认
  assert.deepEqual(parseTestCounts('ℹ tests 8\nℹ pass 8\nℹ fail 0\n'), { passed: 8, failed: 0, total: 8 })
  // 有 pass/fail 没有 tests 时，总数用两者之和
  assert.deepEqual(parseTestCounts('# pass 2\n# fail 0'), { passed: 2, failed: 0, total: 2 })
})

test('parseTestCounts：pytest 的 “N passed, M failed”', () => {
  assert.deepEqual(parseTestCounts('===== 5 passed, 2 failed in 0.10s ====='), { passed: 5, failed: 2, total: 7 })
  assert.deepEqual(parseTestCounts('3 passed in 0.02s'), { passed: 3, failed: 0, total: 3 })
  // 计数行里的顺序反过来也要认
  assert.deepEqual(parseTestCounts('1 failed, 4 passed in 0.5s'), { passed: 4, failed: 1, total: 5 })
})

test('parseTestCounts：unittest 的 “Ran N tests” + OK / FAILED', () => {
  assert.deepEqual(parseTestCounts('Ran 29 tests in 0.123s\n\nOK'), { passed: 29, failed: 0, total: 29 })
  assert.deepEqual(parseTestCounts('Ran 7 tests in 0.010s\n\nFAILED (failures=2, errors=1)'), { passed: 4, failed: 3, total: 7 })
  // 只有 Ran 没有结论，算未确认
  assert.equal(parseTestCounts('Ran 3 tests in 0.001s'), null)
})

test('parseTestCounts：go test 的 --- PASS/FAIL 和 ok/FAIL 行', () => {
  assert.deepEqual(parseTestCounts('--- PASS: TestA (0.00s)\n--- PASS: TestB (0.00s)\n--- FAIL: TestC (0.01s)\nFAIL\texample/pkg\t0.02s'), { passed: 2, failed: 1, total: 3 })
  assert.deepEqual(parseTestCounts('ok  \texample/a\t0.01s\nok  \texample/b\t0.02s\nFAIL\texample/c\t0.03s'), { passed: 2, failed: 1, total: 3 })
})

test('parseTestCounts：jest / vitest 的 “Tests:” 行', () => {
  assert.deepEqual(parseTestCounts('Tests:       5 passed, 2 failed, 7 total'), { passed: 5, failed: 2, total: 7 })
  assert.deepEqual(parseTestCounts('Tests:       3 passed, 3 total'), { passed: 3, failed: 0, total: 3 })
  // vitest：没有 total 关键字，总数在括号里
  assert.deepEqual(parseTestCounts('Tests  1 failed | 2 passed (3)'), { passed: 2, failed: 1, total: 3 })
})

test('parseTestCounts：认不出时返回 null，不瞎猜', () => {
  assert.equal(parseTestCounts(''), null)
  assert.equal(parseTestCounts('all good\nDone in 1.2s'), null)
  assert.equal(parseTestCounts(undefined), null)
})

test('evidencePurpose：冻结命令算验收，其他测试类命令只算排查', () => {
  assert.equal(evidencePurpose('cd app && node --test tests/*.test.mjs', ['node --test tests/*.test.mjs']), 'delivery')
  assert.equal(evidencePurpose('node -e "console.log(1)"', ['node --test']), 'diagnostic')
  assert.equal(evidencePurpose('node --check src/a.js', ['node --test']), 'diagnostic')
  assert.equal(evidencePurpose('python3 -c "print(1)"', ['node --test']), 'diagnostic')
  assert.equal(evidencePurpose('python3 -m pytest -q', ['node --test']), 'diagnostic')
  assert.equal(evidencePurpose('python3 -m unittest discover -v', ['node --test']), 'diagnostic')
  assert.equal(evidencePurpose('pytest -q', ['npm test']), 'diagnostic')
  assert.equal(evidencePurpose('node --test', ['npm test']), 'diagnostic')
  // 只读查看类命令不记录
  assert.equal(evidencePurpose('echo done', ['node --test']), undefined)
  assert.equal(evidencePurpose('cd app && echo done', ['node --test']), undefined)
  assert.equal(evidencePurpose('ls -la', ['node --test']), undefined)
  // 命令里带 # retry_reason 注释不影响判定
  assert.equal(evidencePurpose('# retry_reason: 环境重建后再跑\nnode --test', ['node --test']), 'delivery')
})

test('parseTestCounts：先剥掉 ANSI 颜色码再解析', () => {
  assert.deepEqual(parseTestCounts('\x1b[32m# pass 2\x1b[0m\n\x1b[31m# fail 1\x1b[0m'), { passed: 2, failed: 1, total: 3 })
  assert.deepEqual(parseTestCounts('\x1b[32m3 passed\x1b[0m in 0.01s'), { passed: 3, failed: 0, total: 3 })
})

test('evidencePurpose：只读查看命令不记录，也永远不算验收', () => {
  assert.equal(evidencePurpose('grep "npm test" package.json', ['npm test']), undefined)
  assert.equal(evidencePurpose('cat pytest.ini', ['pytest']), undefined)
  assert.equal(evidencePurpose('echo "npm test"', ['npm test']), undefined)
  assert.equal(evidencePurpose('head -20 .delivery/evidence.jsonl', ['pytest']), undefined)
  assert.equal(evidencePurpose('cd app && grep "pytest" README.md', ['pytest']), undefined)
  assert.equal(evidencePurpose('rg -n TODO src', ['node --test']), undefined)
  // 命令边界匹配：make build-all 不是 make build；路径里的 pytest_helpers 也不算
  assert.equal(evidencePurpose('make build-all', ['make build']), undefined)
  assert.equal(evidencePurpose('make build', ['make build']), 'delivery')
  assert.equal(evidencePurpose('ls tests/pytest_helpers', ['pytest']), undefined)
})

test('retryReason / normalizeCommand：取出重跑原因并压平命令', () => {
  assert.equal(retryReason('node --test # retry_reason: 重装依赖'), '重装依赖')
  assert.equal(retryReason('node --test'), undefined)
  assert.equal(normalizeCommand('  node   --test  # retry_reason: x\n'), 'node --test')
})

test('recordEvidence：验收运行写 purpose=delivery 和 tests 计数', () => {
  const root = project(F)
  const ok = recordEvidence(root, {
    agent: 'main',
    command: 'node --test',
    is_error: false,
    output: '✔ a\n✔ b\nℹ tests 2\nℹ pass 2\nℹ fail 0\n',
  })
  assert.equal(ok, true)
  const lines = readEvidence(root)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].version, 'v1')
  assert.equal(lines[0].purpose, 'delivery')
  assert.deepEqual(lines[0].tests, { passed: 2, failed: 0, total: 2 })
  assert.equal(lines[0].count_unconfirmed, undefined)
})

test('recordEvidence：排查运行写 purpose=diagnostic 和 count_unconfirmed', () => {
  const root = project(F)
  assert.equal(recordEvidence(root, { agent: 'main', command: 'node -e "console.log(1)"', is_error: false, output: '1' }), true)
  const lines = readEvidence(root)
  assert.equal(lines[0].purpose, 'diagnostic')
  assert.equal(lines[0].tests, null)
  assert.equal(lines[0].count_unconfirmed, true)
})

test('recordEvidence：grep/cat 等只读查看命令不产生证据行', () => {
  const root = project(F)
  for (const command of [
    'grep "node --test" package.json',
    'cat README.md',
    'head -5 .delivery/freeze.json',
    'tail -3 .delivery/evidence.jsonl',
    'pwd',
    'which node',
    'echo "node --test"',
    'cd app && grep "node --test" package.json',
  ]) {
    assert.equal(recordEvidence(root, { agent: 'main', command, is_error: false, output: 'x' }), false, command)
  }
  assert.equal(fs.existsSync(path.join(root, '.delivery', 'evidence.jsonl')), false)
  // 真正跑测试但不在冻结清单里的命令照常记为排查
  assert.equal(recordEvidence(root, { agent: 'main', command: 'python3 -m pytest -q', is_error: false, output: '1 passed' }), true)
  const lines = readEvidence(root)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].purpose, 'diagnostic')
})

test('recordEvidence：解析不出计数时写 tests=null + count_unconfirmed=true', () => {
  const root = project(F)
  assert.equal(recordEvidence(root, { agent: 'subagent', command: 'node --test', is_error: false, output: '随便什么输出' }), true)
  const lines = readEvidence(root)
  assert.equal(lines[0].tests, null)
  assert.equal(lines[0].count_unconfirmed, true)
})

test('recordEvidence：带 # retry_reason 的命令把原因写进证据', () => {
  const root = project(F)
  assert.equal(recordEvidence(root, { agent: 'main', command: 'node --test # retry_reason: 重装依赖后重跑', is_error: false, output: '# pass 1\n# fail 0' }), true)
  const lines = readEvidence(root)
  assert.equal(lines[0].retry_reason, '重装依赖后重跑')
  assert.equal(lines[0].purpose, 'delivery')
})

test('recordEvidence：与测试无关的命令不写证据，未冻结也不写', () => {
  const root = project(F)
  assert.equal(recordEvidence(root, { agent: 'main', command: 'ls -la', is_error: false, output: 'a b c' }), false)
  assert.equal(fs.existsSync(path.join(root, '.delivery', 'evidence.jsonl')), false)
  const noFreeze = project(undefined)
  assert.equal(recordEvidence(noFreeze, { agent: 'main', command: 'node --test', is_error: false, output: '# pass 1' }), false)
})
