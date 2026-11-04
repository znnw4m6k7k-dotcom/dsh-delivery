# 在线安装（Windows），不需要 git。在 PowerShell 里粘贴运行：
#   irm https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.ps1 | iex
# 装到别的工具（先设置再运行上面那行）：
#   $env:DSH_KIT_TARGET = 'claude'   # Claude Code 技能（%USERPROFILE%\.claude\skills\omni-delivery）
#   $env:DSH_KIT_TARGET = 'codex'    # Codex 技能（%USERPROFILE%\.codex\skills\omni-delivery）
#   $env:DSH_KIT_TARGET = 'all'      # 三个都装
# 打不开 GitHub：用浏览器下载 ZIP，全部解压后双击 Install-Windows.bat。也可以用 $env:DSH_KIT_URL 指定可访问的 .zip 地址。
& {
  $ErrorActionPreference = 'Stop'
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
  $ProgressPreference = 'SilentlyContinue'   # 关掉进度条，Windows PowerShell 5 下载会快很多
  $Repo = 'znnw4m6k7k-dotcom/dsh-delivery'
  $Ref = if ($env:DSH_KIT_REF) { $env:DSH_KIT_REF } else { 'main' }
  $Target = if ($env:DSH_KIT_TARGET) { $env:DSH_KIT_TARGET } else { 'dsh' }
  $Help = "https://github.com/$Repo/blob/main/docs/安装问题排查.md"
  function Fail($m) { Write-Host "`n安装失败：$m" -ForegroundColor Red; Write-Host "常见问题和解决办法：$Help"; return }
  if (@('dsh', 'claude', 'codex', 'all') -notcontains $Target) { Fail "不认识的 DSH_KIT_TARGET：$Target（可选 dsh / claude / codex / all）"; return }

  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('dshkit-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $Tmp | Out-Null
  try {
    $zip = Join-Path $Tmp 'kit.zip'
    $urls = @()
    if ($env:DSH_KIT_URL) { $urls += $env:DSH_KIT_URL }
    $urls += "https://codeload.github.com/$Repo/zip/refs/heads/$Ref", "https://github.com/$Repo/archive/refs/heads/$Ref.zip"
    $got = $false
    foreach ($u in $urls) {
      Write-Host "下载 $u ..."
      try { Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $zip -TimeoutSec 120; $got = $true; break } catch { Write-Host "  失败：$($_.Exception.Message)" }
    }
    if (-not $got) { Fail "下载失败，可能是网络连不上 GitHub。可以换个网络或开代理后重试；或者在浏览器打开 https://github.com/$Repo ，点 Code → Download ZIP，全部解压后双击 Install-Windows.bat。"; return }
    Expand-Archive -LiteralPath $zip -DestinationPath $Tmp -Force
    $src = Get-ChildItem -LiteralPath $Tmp -Directory | Select-Object -First 1
    if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'kit\install.ps1'))) { Fail '下载的内容不完整，请重试。'; return }
    Get-ChildItem -LiteralPath $src.FullName -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

    function Copy-Skill($from, $to, $name) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
      if (Test-Path $to) { Remove-Item -Recurse -Force $to }
      Copy-Item -Recurse -Force $from $to
      Write-Host "已安装 $name 技能：$to（新开一个会话即可使用）"
    }
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
    $runDsh = { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src.FullName 'kit\install.ps1'); $LASTEXITCODE }
    switch ($Target) {
      'dsh' { $null = & $runDsh }
      'claude' { Copy-Skill (Join-Path $src.FullName 'claude-skill\omni-delivery') (Join-Path $HOME '.claude\skills\omni-delivery') 'Claude Code' }
      'codex' { Copy-Skill (Join-Path $src.FullName 'codex-skill\omni-delivery') (Join-Path $codexHome 'skills\omni-delivery') 'Codex' }
      'all' {
        $c = & $runDsh
        if ($c -ne 0) { Write-Host '（DSH 部分没装上，见上面的原因；继续安装 Claude / Codex 技能）' }
        Copy-Skill (Join-Path $src.FullName 'claude-skill\omni-delivery') (Join-Path $HOME '.claude\skills\omni-delivery') 'Claude Code'
        Copy-Skill (Join-Path $src.FullName 'codex-skill\omni-delivery') (Join-Path $codexHome 'skills\omni-delivery') 'Codex'
      }
    }
  } finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  }
}
