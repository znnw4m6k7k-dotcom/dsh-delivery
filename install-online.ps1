# 在线安装（Windows），不需要 git。在 PowerShell 里粘贴运行：
#   irm https://raw.githubusercontent.com/znnw4m6k7k-dotcom/dsh-delivery/main/install-online.ps1 | iex
# 选装：先设 $env:DSH_KIT_TARGET = 'cursor'，再运行上面那行。
# 通用目录：设 $env:DSH_KIT_TARGET = 'generic'。
# 自定义目录：设 $env:DSH_KIT_TARGET = 'custom' 和 $env:DSH_KIT_SKILLS_DIR。
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
  function Fail($message) { throw "安装失败：$message`n常见问题和解决办法：$Help" }

  $claudeHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  $configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME '.config' }
  # all 只安装各客户端专用目录，通用目录和自定义目录由用户单独选择。
  $agentRoots = [ordered]@{
    claude = Join-Path $claudeHome 'skills'
    codex = Join-Path $codexHome 'skills'
    cursor = Join-Path $HOME '.cursor/skills'
    copilot = Join-Path $HOME '.copilot/skills'
    gemini = Join-Path $HOME '.gemini/skills'
    opencode = Join-Path $configHome 'opencode/skills'
    windsurf = Join-Path $HOME '.codeium/windsurf/skills'
    devin = Join-Path $configHome 'devin/skills'
  }
  $targets = @('dsh') + @($agentRoots.Keys) + @('generic', 'custom', 'all')
  if ($targets -notcontains $Target) { Fail "不认识的 DSH_KIT_TARGET：$Target（可选 $($targets -join ' / ')）" }
  if ($Target -eq 'custom' -and [string]::IsNullOrWhiteSpace($env:DSH_KIT_SKILLS_DIR)) { Fail '请设置 DSH_KIT_SKILLS_DIR 为技能根目录。' }

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
    if (-not $got) { Fail "下载失败，可能是网络连不上 GitHub。可以换个网络或开代理后重试；或者在浏览器打开 https://github.com/$Repo ，点 Code → Download ZIP，全部解压后双击 Install-Windows.bat。" }
    Expand-Archive -LiteralPath $zip -DestinationPath $Tmp -Force
    $src = Get-ChildItem -LiteralPath $Tmp -Directory | Select-Object -First 1
    if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'kit\install.ps1'))) { Fail '下载的内容不完整，请重试。' }
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
      Get-ChildItem -LiteralPath $src.FullName -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
    }

    function Install-Skill($name, $root) {
      $edition = switch ($name) {
        'claude' { 'claude-skill' }
        'codex' { 'codex-skill' }
        default { 'agent-skill' }
      }
      $from = Join-Path $src.FullName "$edition/delivery-contract"
      if (-not (Test-Path -LiteralPath (Join-Path $from 'SKILL.md') -PathType Leaf)) {
        Fail "压缩包里缺少 $name 的技能文件，请下载对应版本的完整源码压缩包。"
      }
      $to = Join-Path $root 'delivery-contract'
      $stage = Join-Path $root ('.delivery-contract.' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Force -Path $stage | Out-Null
      try {
        $stagedSkill = Join-Path $stage 'delivery-contract'
        Copy-Item -LiteralPath $from -Destination $stagedSkill -Recurse -Force
        if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }
        Move-Item -LiteralPath $stagedSkill -Destination $to
      } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
      }
      Write-Host "已安装 $name 技能：$to（重新加载技能或新开会话）"
    }
    $runDsh = { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $src.FullName 'kit/install.ps1') | Out-Host }
    switch ($Target) {
      'dsh' { & $runDsh }
      'all' {
        & $runDsh
        if ($LASTEXITCODE -ne 0) { Write-Host '（DSH 部分没装上，见上面的原因；继续安装其他技能）' }
        foreach ($name in $agentRoots.Keys) { Install-Skill $name $agentRoots[$name] }
      }
      'generic' { Install-Skill $Target (Join-Path $HOME '.agents/skills') }
      'custom' { Install-Skill $Target $env:DSH_KIT_SKILLS_DIR }
      default { Install-Skill $Target $agentRoots[$Target] }
    }
  } finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  }
}
