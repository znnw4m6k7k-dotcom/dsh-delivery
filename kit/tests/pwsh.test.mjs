// 运行：node --test kit/tests/
// Windows 上 DSH 用 PowerShell 跑命令（dsh-tool-pwsh）：守卫要和 bash 一样生效。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { evaluate, looksWrite, SHELL_TOOLS } from '../bundle/index.js'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-ps-'))
  fs.mkdirSync(path.join(root, '.delivery', 'qa'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'app.py'), 'x=1')
  fs.writeFileSync(path.join(root, '.delivery', 'freeze.json'), JSON.stringify({
    version: 'v1', files: [{ path: 'src/app.py', sha256: 'x' }], test_commands: ['py -m pytest'],
  }))
  return root
}

test('PowerShell 工具名都按命令行工具处理', () => {
  for (const n of ['bash', 'pwsh', 'powershell']) assert.ok(SHELL_TOOLS.has(n))
})

test('PowerShell 写文件命令能识别', () => {
  assert.equal(looksWrite("Set-Content -Path src\\app.py -Value 'x'"), true)
  assert.equal(looksWrite("'x' | Out-File src/app.py"), true)
  assert.equal(looksWrite('Remove-Item src\\app.py'), true)
  assert.equal(looksWrite('del src\\app.py'), true)
  assert.equal(looksWrite("[IO.File]::WriteAllText('src/app.py','x')"), true)
  assert.equal(looksWrite('Get-Content src\\app.py'), false)
  assert.equal(looksWrite('py -m pytest -q'), false)
})

test('冻结期间：pwsh 改冻结文件被拦，只读放行；反斜杠路径也认', () => {
  const root = project()
  const ps = (command) => evaluate({ tool: 'pwsh', args: { command }, cwd: root, isRoot: true })
  assert.match(ps("Set-Content -Path src\\app.py -Value 'y'"), /冻结/)
  assert.match(ps("Add-Content src/app.py 'y'"), /冻结/)
  assert.equal(ps('Get-Content src\\app.py'), undefined)
  fs.writeFileSync(path.join(root, '.delivery', 'qa', 'v1.json'), '{}')
  assert.equal(ps("Set-Content -Path src\\app.py -Value 'y'"), undefined)
})
