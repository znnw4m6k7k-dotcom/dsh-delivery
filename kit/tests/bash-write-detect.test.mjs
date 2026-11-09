// 运行：node --test kit/tests/
// 实机误拦回归：QA 用 node -e 只读核对冻结文件时，被当成“写文件”拦下（2026-11-02 电商财务项目）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, looksWrite, shellSkeleton } from '../bundle/index.js'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-w-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'build'))
  fs.writeFileSync(path.join(root, 'src', 'style.css'), 'a{}')
  fs.writeFileSync(path.join(root, 'build', 'build.mjs'), '')
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({
    version: 'v1', files: [{ path: 'src/style.css', sha256: 'x' }, { path: 'build/build.mjs', sha256: 'y' }], test_commands: ['node --test'],
  }))
  return root
}
const bash = (root, command, isRoot) => evaluate({ tool: 'bash', args: { command }, cwd: root, isRoot })

test('引号里的脚本代码不算写操作', () => {
  const qaRead = `node -e '
const fs=require("fs"),cp=require("crypto");
const fz=JSON.parse(fs.readFileSync(".delivery/freeze.json","utf8"));
for(const f of fz.files){ if(cp.createHash("sha256").update(fs.readFileSync(f.path)).digest("hex")!==f.sha256) console.log(f.path) }
'`
  assert.equal(looksWrite(qaRead), false)
  const hashes = `node -e "const v1={'build/build.mjs':'aa'}; for (const [k,v] of Object.entries(v1)) console.log(k, v.length > 3)"`
  assert.equal(looksWrite(hashes), false)
  assert.equal(looksWrite(`awk '$1 > 3' src/style.css`), false)
  assert.equal(looksWrite('node --test 2>&1 | tail -5'), false)
  assert.equal(looksWrite('cat src/style.css >/dev/null'), false)
})

test('真正的写操作仍然识别', () => {
  assert.equal(looksWrite('echo x > src/style.css'), true)
  assert.equal(looksWrite('echo x >> src/style.css'), true)
  assert.equal(looksWrite('cp a src/style.css'), true)
  assert.equal(looksWrite("sed -i '' 's/a/b/' src/style.css"), true)
  assert.equal(looksWrite('cat > src/style.css <<EOF\nx > y\nEOF'), true)
  assert.equal(looksWrite(`python3 - <<'EOF'\np='src/style.css'\nopen(p,'w').write('x')\nEOF`), true)
  assert.equal(looksWrite(`node -e 'require("fs").writeFileSync("src/style.css","")'`), true)
})

test('heredoc 正文里的 > 不算重定向', () => {
  const cmd = `python3 - <<'EOF'\nprint(1 > 0)\nEOF`
  assert.equal(shellSkeleton(cmd).includes('print'), false)
  assert.equal(looksWrite(cmd), false)
})

test('等验收期间：QA 只读核对放行，改冻结文件仍拦截', () => {
  const root = project()
  const qaRead = `node -e 'const cp=require("crypto"); const fs=require("fs"); console.log(fs.readFileSync(".delivery/freeze.json","utf8"), "build/build.mjs")'`
  assert.equal(bash(root, qaRead, false), undefined)
  assert.equal(bash(root, qaRead, true), undefined)
  assert.match(bash(root, 'echo x >> src/style.css', true), /冻结/)
  assert.match(bash(root, `python3 - <<'EOF'\np='src/style.css'\nopen(p,'w').write('x')\nEOF`, true), /冻结/)
})

test('QA 结论写成 qa-<版本>.json 也算已验收', () => {
  const root = project()
  fs.writeFileSync(path.join(root, '.delivery', 'qa', 'qa-v1.json'), '{"release_status":"blocked"}')
  assert.equal(bash(root, 'echo x >> src/style.css', true), undefined)
})
