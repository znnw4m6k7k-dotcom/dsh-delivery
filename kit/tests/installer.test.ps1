# 安装脚本测试（Windows）：用假的 DSH 命令行跑一遍安装、重装、卸载。
# 运行：powershell -ExecutionPolicy Bypass -File kit\tests\installer.test.ps1
$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Kit = Split-Path -Parent $Here
$T = Join-Path ([IO.Path]::GetTempPath()) ("dk-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $T | Out-Null
$env:DSH_HOME = Join-Path $T '.dsh'
$env:DSH_CLI = Join-Path $Here 'fake-dsh\dsh.cmd'
$env:DSH_DELIVERY_HOME = Join-Path $T "我的 工具包"
New-Item -ItemType Directory -Force -Path (Join-Path $env:DSH_HOME 'profiles\desktop'), (Join-Path $env:DSH_HOME 'profiles\web') | Out-Null
function Fail($m) { Write-Host "FAIL: $m"; exit 1 }
function Run($file) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | Out-String
  return @{ code = $LASTEXITCODE; out = $out }
}
function Has($p) { $f = Join-Path $env:DSH_HOME "profiles\$p\package.json"; (Test-Path $f) -and ((Get-Content -Raw $f) -match '"@local/delivery-kit"') }

$r = Run (Join-Path $Kit 'install.ps1'); if ($r.code -ne 0) { Write-Host $r.out; Fail '首次安装' }
foreach ($p in 'desktop', 'web') { if (-not (Has $p)) { Fail "profile $p 没注册" } }
$patch = [IO.File]::ReadAllText((Join-Path $env:DSH_DELIVERY_HOME 'bundle\cordis.patch.yml'), [Text.Encoding]::UTF8)
if ($patch -match '__KIT_DIR__') { Fail '还有占位符' }
if (-not $patch.Contains(($env:DSH_DELIVERY_HOME -replace '\\', '/') + '/skills')) { Fail '技能目录没替换成正斜杠路径' }

$env:FAKE_DSH_FAIL_IF_EXISTS = '1'
$r = Run (Join-Path $Kit 'install.ps1'); if ($r.code -ne 0) { Write-Host $r.out; Fail '重装' }
if ($r.out -notmatch '更新') { Write-Host $r.out; Fail '重装没提示更新' }
Remove-Item Env:FAKE_DSH_FAIL_IF_EXISTS

$saved = $env:DSH_CLI; $env:DSH_CLI = Join-Path $T 'nope\dsh.cmd'
$r = Run (Join-Path $Kit 'install.ps1'); if ($r.code -eq 0) { Fail '命令行不存在也成功了' }
$env:DSH_CLI = $saved

$r = Run (Join-Path $env:DSH_DELIVERY_HOME 'uninstall.ps1'); if ($r.code -ne 0) { Write-Host $r.out; Fail '卸载' }
foreach ($p in 'desktop', 'web') { if (Has $p) { Fail "profile $p 没移除" } }
if (Test-Path (Join-Path $env:DSH_DELIVERY_HOME 'bundle')) { Fail '卸载后文件还在' }
Remove-Item -Recurse -Force $T
Write-Host 'installer tests: ok'
