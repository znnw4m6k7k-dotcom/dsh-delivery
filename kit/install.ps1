# 交付模式一键安装（Windows）
# 用法：双击 Install-Windows.bat，或在 PowerShell 里运行
#   powershell -ExecutionPolicy Bypass -File install.ps1
# 作用：
#   1. 把交付技能和组合包复制到 %USERPROFILE%\.dsh-delivery-kit
#   2. 通过 DSH 命令行把组合包装进你正在用的 profile（自动识别 desktop / web）
#   3. 新会话默认使用“交付”预设
# 不需要注册账号；模型费用走你自己的 DeepSeek API Key。
# 可选环境变量：DSH_CLI（dsh 命令行位置）、DSH_APP（DSH 安装目录）、DSH_PROFILE_NAME、DSH_HOME、DSH_DELIVERY_HOME
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$HelpUrl = 'https://github.com/znnw4m6k7k-dotcom/dsh-delivery/blob/main/docs/安装问题排查.md'
function Say($m) { Write-Host $m }
function Die($m) {
  Write-Host ''
  Write-Host "安装失败：$m" -ForegroundColor Red
  Write-Host ''
  Write-Host "常见问题和解决办法：$HelpUrl"
  exit 1
}

$SrcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$KitDir = if ($env:DSH_DELIVERY_HOME) { $env:DSH_DELIVERY_HOME } else { Join-Path $HOME '.dsh-delivery-kit' }
$DshData = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }

Say '== 交付模式安装 =='

# ---------- 1. 检查环境 ----------
if (-not (Test-Path (Join-Path $SrcDir 'bundle\cordis.patch.yml.in'))) {
  Die '安装包不完整：缺少 bundle\cordis.patch.yml.in。请先把下载的压缩包“全部解压”，再运行解压出来的文件夹里的安装程序（不要在压缩包里直接双击）。'
}
if (-not (Test-Path (Join-Path $SrcDir 'skills\delivery-protocol'))) { Die '安装包不完整：缺少 skills\。请重新下载并全部解压。' }

function Find-Cli {
  if ($env:DSH_CLI) { if (Test-Path $env:DSH_CLI) { return $env:DSH_CLI } else { Die "DSH_CLI 指定的文件不存在：$($env:DSH_CLI)" } }
  $names = @('dsh.cmd', 'dsh.exe', 'dsh.ps1', 'dsh')
  $roots = @()
  if ($env:DSH_APP) { $roots += $env:DSH_APP }
  foreach ($base in @($env:LOCALAPPDATA, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:APPDATA)) {
    if ($base -and (Test-Path $base)) {
      $roots += Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'deepseek|harness|^dsh' } | ForEach-Object { $_.FullName }
    }
  }
  foreach ($r in $roots) {
    foreach ($sub in @('resources\runtime\cli\bin', 'runtime\cli\bin', 'Resources\runtime\cli\bin', 'bin', '')) {
      foreach ($n in $names) {
        $p = if ($sub) { Join-Path (Join-Path $r $sub) $n } else { Join-Path $r $n }
        if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
      }
    }
    # 再往下找两层
    $hit = Get-ChildItem -LiteralPath $r -Recurse -Depth 6 -File -ErrorAction SilentlyContinue |
      Where-Object { $names -contains $_.Name -and $_.DirectoryName -match 'cli[\\/]bin$' } | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $null
}

$Cli = Find-Cli
if (-not $Cli) {
  Die "没找到 DeepSeek Harness 的命令行（dsh）。
请先安装 DeepSeek Harness 并打开一次，再运行本安装程序。
如果已经装了，请找到它的安装目录，用下面的方式指定后再运行：
  `$env:DSH_APP = 'C:\你的安装目录'
或者直接用应用内安装（见排查文档第 3 条）。"
}
Say "DSH 命令行：$Cli"

# 没有扩展名的 dsh 是 Node 脚本，需要用 node 运行
function Invoke-Dsh([string[]]$a) {
  # dsh 往 stderr 打印提示时，PowerShell 5 在 Stop 模式下会把它当成异常；这里按退出码判断
  $ErrorActionPreference = 'Continue'
  if ([IO.Path]::GetExtension($Cli) -eq '') {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $bundled = Join-Path (Split-Path -Parent (Split-Path -Parent $Cli)) 'node.exe'
    if (Test-Path $bundled) { & $bundled $Cli @a | Out-Host } elseif ($node) { & $node.Source $Cli @a | Out-Host } else { return 127 }
  } elseif ([IO.Path]::GetExtension($Cli) -eq '.ps1') {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Cli @a | Out-Host
  } else {
    & $Cli @a | Out-Host
  }
  return $LASTEXITCODE
}

# 选 profile
if ($env:DSH_PROFILE_NAME) { $Profiles = @($env:DSH_PROFILE_NAME) } else {
  $Profiles = @()
  $pd = Join-Path $DshData 'profiles'
  if (Test-Path $pd) { $Profiles = @(Get-ChildItem -LiteralPath $pd -Directory | Where-Object { $_.Name -notmatch '^\.|\s' } | ForEach-Object { $_.Name }) }
  if ($Profiles.Count -eq 0) {
    if (-not (Test-Path $DshData)) { Say "提示：没找到 $DshData，看起来 DSH 还没打开过。建议先打开一次 DSH 再安装；现在先按默认 profile（desktop）安装。" }
    $Profiles = @('desktop')
  }
}
Say ("安装到 profile：" + ($Profiles -join ' '))

$py = $null
foreach ($c in @('py', 'python3', 'python')) {
  $g = Get-Command $c -ErrorAction SilentlyContinue
  # Windows 自带的 python.exe 可能只是应用商店的占位程序，要真的能运行才算
  if ($g -and $g.Source -notmatch 'WindowsApps') { $py = $c; break }
  if ($g) { try { & $c -c 'import sys' 2>$null; if ($LASTEXITCODE -eq 0) { $py = $c; break } } catch {} }
}
if (-not $py) { Say '提示：没检测到可用的 Python。复盘时整理行业经验需要它，可从 https://www.python.org/downloads/ 安装（安装时勾选 Add python.exe to PATH）。不影响现在的安装。' }

# ---------- 2. 复制文件 ----------
Say "复制文件到 $KitDir ..."
try {
  New-Item -ItemType Directory -Force -Path $KitDir | Out-Null
  foreach ($d in @('bundle.new', 'skills.new')) { $p = Join-Path $KitDir $d; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
  Copy-Item -Recurse -Force (Join-Path $SrcDir 'bundle') (Join-Path $KitDir 'bundle.new')
  Copy-Item -Recurse -Force (Join-Path $SrcDir 'skills') (Join-Path $KitDir 'skills.new')
  # YAML 里用正斜杠路径，单引号要写两遍
  $kitYaml = ($KitDir -replace '\\', '/') -replace "'", "''"
  $tpl = [IO.File]::ReadAllText((Join-Path $KitDir 'bundle.new\cordis.patch.yml.in'), [Text.Encoding]::UTF8)
  [IO.File]::WriteAllText((Join-Path $KitDir 'bundle.new\cordis.patch.yml'), $tpl.Replace('__KIT_DIR__', $kitYaml), (New-Object Text.UTF8Encoding($false)))
  Remove-Item -Force (Join-Path $KitDir 'bundle.new\cordis.patch.yml.in')
  foreach ($d in @('bundle', 'skills')) { $p = Join-Path $KitDir $d; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
  Rename-Item (Join-Path $KitDir 'bundle.new') 'bundle'
  Rename-Item (Join-Path $KitDir 'skills.new') 'skills'
  foreach ($f in @('uninstall.ps1', 'uninstall.sh')) { $p = Join-Path $SrcDir $f; if (Test-Path $p) { Copy-Item -Force $p $KitDir } }
  # 去掉“从网上下载”的标记
  Get-ChildItem -LiteralPath $KitDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
} catch {
  Die "复制文件失败：$($_.Exception.Message)
如果 DSH 正开着，请先完全退出（右下角托盘图标右键退出）再重试；如果提示没有权限，请确认没有用管理员身份装过。"
}

# ---------- 3. 装进 DSH ----------
function Test-Registered($pkg) { (Test-Path $pkg) -and ((Get-Content -Raw -Encoding UTF8 $pkg) -match '"@local/delivery-kit"') }
$ok = @(); $failed = @()
$bundleDir = Join-Path $KitDir 'bundle'
foreach ($p in $Profiles) {
  $pkg = Join-Path $DshData "profiles\$p\package.json"
  $was = Test-Registered $pkg
  Say "把组合包装进 DeepSeek Harness（profile: $p）..."
  $code = Invoke-Dsh @('plugin', '--profile', $p, 'add', $bundleDir)
  if ($code -ne 0) {
    if ($code -eq 127) { Say '这个 dsh 需要 Node.js 才能运行，但没找到 node。' }
    elseif ($was) { Say '（以前装过，这次是更新：文件已替换，注册信息沿用。）' }
    else { Say '这个 profile 安装失败，上面是 DSH 的原始报错。' }
  }
  if (Test-Registered $pkg) { Say "已核对：$pkg 里有 @local/delivery-kit。"; $ok += $p } else { $failed += $p }
}

if ($ok.Count -eq 0) {
  Die ("组合包没有注册成功（profile: " + ($failed -join ' ') + "）。
请改用应用内安装：在 DSH 里新建会话，发送
  用 plugin_manager 的 install_bundle 安装 $($bundleDir -replace '\\', '/')
并在弹出的批准提示里点同意。")
}
if ($failed.Count -gt 0) { Say ("提示：profile " + ($failed -join ' ') + " 没装上，已装好的是 " + ($ok -join ' ') + "。只要你平时用的那个装上了就行。") }

Say @"

安装完成。接下来：
  1. 完全退出 DeepSeek Harness（右下角托盘图标右键“退出”，只关窗口不够）后重新打开。
  2. 首次使用：欢迎页选“添加 API Key”，填入你在 DeepSeek 开放平台充值后创建的 API Key。不需要注册 DSH 账号。
  3. 新建会话，确认智能体预设显示为“交付”。如果你以前在设置里手动选过默认预设，请在设置里改成“交付”。
  4. 直接说你要交付的成果。项目验收后说“做复盘”，它会整理经验并逐条请你确认。
  5. 想确认装好了：在会话里输入 /delivery-doctor 。

行业经验包保存在 $HOME\.agents\skills\industry-<行业>\，卸载交付模式不会删除它们。
更新：重新运行一次安装即可。
卸载：powershell -ExecutionPolicy Bypass -File "$KitDir\uninstall.ps1"
"@
