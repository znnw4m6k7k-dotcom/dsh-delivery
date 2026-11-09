# 卸载交付模式（Windows）。行业经验包（%USERPROFILE%\.agents\skills\industry-*）会保留。
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$KitDir = if ($env:DSH_DELIVERY_HOME) { $env:DSH_DELIVERY_HOME } else { Join-Path $HOME '.dsh-delivery-kit' }
$DshData = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }

$Cli = $env:DSH_CLI
if (-not $Cli) {
  foreach ($base in @($env:DSH_APP, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:LOCALAPPDATA, $env:ProgramFiles)) {
    if (-not $base -or -not (Test-Path $base)) { continue }
    $hit = Get-ChildItem -LiteralPath $base -Recurse -Depth 7 -File -ErrorAction SilentlyContinue |
      Where-Object { @('dsh.cmd', 'dsh.exe') -contains $_.Name -and $_.DirectoryName -match 'cli[\\/]bin$' } | Select-Object -First 1
    if ($hit) { $Cli = $hit.FullName; break }
  }
}
if (-not $Cli) { $c = Get-Command dsh -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $Cli = $c.Source } }

if ($env:DSH_PROFILE_NAME) { $Profiles = @($env:DSH_PROFILE_NAME) } else {
  $Profiles = @()
  $pd = Join-Path $DshData 'profiles'
  if (Test-Path $pd) {
    $Profiles = @(Get-ChildItem -LiteralPath $pd -Directory | Where-Object {
      $f = Join-Path $_.FullName 'package.json'; (Test-Path $f) -and ((Get-Content -Raw -Encoding UTF8 $f) -match '"@local/delivery-kit"')
    } | ForEach-Object { $_.Name })
  }
}

if (-not $Cli) { Write-Host '提示：没找到 DeepSeek Harness 命令行，跳过从 DSH 移除这一步。' }
elseif ($Profiles.Count -eq 0) { Write-Host '提示：DSH 里没有找到 @local/delivery-kit，可能已经卸载。' }
else {
  foreach ($p in $Profiles) {
    & $Cli plugin --profile $p remove '@local/delivery-kit' | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "提示：profile $p 里移除失败，可在 DSH 设置的插件页手动移除 @local/delivery-kit。" }
  }
}
foreach ($d in @('bundle', 'skills', 'uninstall.sh')) { $p = Join-Path $KitDir $d; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
Write-Host '已卸载交付模式。请完全退出并重新打开 DeepSeek Harness。行业经验包仍在 %USERPROFILE%\.agents\skills\ 下。'
# 最后删自己所在的目录（脚本可能就在这里）
$self = Join-Path $KitDir 'uninstall.ps1'
if (Test-Path $self) { Remove-Item -Force $self -ErrorAction SilentlyContinue }
if ((Test-Path $KitDir) -and -not (Get-ChildItem -LiteralPath $KitDir -Force)) { Remove-Item -Force $KitDir -ErrorAction SilentlyContinue }
