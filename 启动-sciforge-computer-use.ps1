<#
.SYNOPSIS
  一键启动「集成了 Computer-Use 模块」的 SciForge GUI。
  One-click launcher for the SciForge GUI with the GUI-Owl Computer-Use module wired in.

.DESCRIPTION
  流程 / What it does:
    1. 读取 启动-secrets.local.ps1 (没有则用 .example 并告警)
    2. 自动建立到 GPU 服务器的 SSH 隧道, 把远端 GUI-Owl vLLM 端口转发到本地
    3. 启动 Computer-Use 服务 (packages/workers/gui-owl-computer-use, HTTP :CUA_PORT)
    4. 设置 SCIFORGE_CUA_SERVICE_URL, 让 GUI 里的主 agent 出现 computer_use 工具
    5. 启动 SciForge GUI (npm run dev)
  在 GUI 里用自然语言下达桌面任务即可; 每次真机动作都会先弹出审批, 同意后才执行。

.PARAMETER SafeDryRun
  纯演练: Computer-Use 只规划不动鼠标键盘 (任何执行返回 NEEDS_APPROVAL)。
  不加该开关时默认允许真机执行, 但每个动作仍需在 GUI 里点“同意”。
.PARAMETER NoTunnel
  跳过 SSH 隧道 (当 CUA_MODEL_BASE_URL 已直连可用时)。
.PARAMETER SkipService
  不由本脚本启动 Computer-Use 服务 (已在别处运行时)。
.PARAMETER Install
  启动前安装依赖: 根目录 npm install + worker 的 pip install。

.EXAMPLE
  .\启动-sciforge-computer-use.ps1                 # 真机模式 (动作需 GUI 审批) + 启动 GUI
  .\启动-sciforge-computer-use.ps1 -SafeDryRun      # 演练模式, 不动真机
  .\启动-sciforge-computer-use.ps1 -Install         # 首次运行, 先装依赖
#>
[CmdletBinding()]
param(
  [switch]$SafeDryRun,
  [switch]$NoTunnel,
  [switch]$SkipService,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here
$worker = Join-Path $here "packages\workers\gui-owl-computer-use"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Info($m) { Write-Host "[cua] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[cua] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[cua] $m" -ForegroundColor Red; exit 1 }

# --- 1. secrets / config -----------------------------------------------------
$secretsLocal   = Join-Path $here "启动-secrets.local.ps1"
$secretsExample = Join-Path $here "启动-secrets.example.ps1"
if (Test-Path $secretsLocal) { Info "loading 启动-secrets.local.ps1"; . $secretsLocal }
elseif (Test-Path $secretsExample) { Warn "未找到 启动-secrets.local.ps1, 暂用 .example 默认值"; . $secretsExample }
else { Die "缺少 secrets 配置 (启动-secrets.local.ps1 / .example)" }

if (-not $env:CUA_PORT) { $env:CUA_PORT = "3900" }
if (-not $env:CUA_LOCAL_PORT) { $env:CUA_LOCAL_PORT = "4243" }

# 真机执行默认开启 (每个动作仍由 GUI 审批门控); -SafeDryRun 关闭。
$env:CUA_ALLOW_EXECUTE = if ($SafeDryRun) { "false" } else { "true" }
# 让 GUI 里的 Kun runtime 暴露 computer_use 工具并指向本地服务。
$env:SCIFORGE_CUA_SERVICE_URL = "http://127.0.0.1:$($env:CUA_PORT)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "找不到 node, 请先安装 Node.js" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Die "找不到 python, 请先安装并加入 PATH" }

# --- 2. deps (opt-in) --------------------------------------------------------
if ($Install) {
  Info "npm install (root)"; & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Die "npm install 失败" }
  Info "pip install worker requirements"; & python -m pip install -r (Join-Path $worker "requirements.txt"); if ($LASTEXITCODE -ne 0) { Die "pip install 失败" }
}

# --- 3. SSH tunnel to the GUI-Owl GPU box ------------------------------------
$tunnel = $null
function Test-Port([int]$port) {
  try { (New-Object Net.Sockets.TcpClient).Connect("127.0.0.1", $port); return $true } catch { return $false }
}
if (-not $NoTunnel) {
  $lp = [int]$env:CUA_LOCAL_PORT
  if (Test-Port $lp) { Info "本地端口 $lp 已监听, 复用现有隧道" }
  elseif ($env:CUA_SSH_HOST) {
    $sshArgs = @("-p", $env:CUA_SSH_PORT, "-N",
      "-o","ServerAliveInterval=30","-o","ExitOnForwardFailure=yes","-o","StrictHostKeyChecking=accept-new",
      "-L", "$($env:CUA_LOCAL_PORT):127.0.0.1:$($env:CUA_REMOTE_PORT)",
      "$($env:CUA_SSH_USER)@$($env:CUA_SSH_HOST)")
    Info "建立 SSH 隧道: localhost:$($env:CUA_LOCAL_PORT) -> $($env:CUA_SSH_HOST):$($env:CUA_REMOTE_PORT)"
    $tunnel = Start-Process ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Test-Port $lp); $i++) { Start-Sleep -Milliseconds 500 }
    if (Test-Port $lp) { Info "隧道就绪" } else { Warn "隧道端口未就绪 (GUI-Owl 可能未启动或仍在加载)" }
  } else { Warn "未配置 CUA_SSH_HOST, 跳过隧道" }
}

# --- 4. Computer-Use service -------------------------------------------------
$server = $null
try {
  if (-not $SkipService) {
    Info "启动 Computer-Use 服务 :$($env:CUA_PORT)  (真机执行=$($env:CUA_ALLOW_EXECUTE), 模型=$($env:CUA_MODEL) @ $($env:CUA_MODEL_BASE_URL))"
    $server = Start-Process python -ArgumentList @("-m","cua.cli","--http") -PassThru -WorkingDirectory $worker
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      try { Invoke-WebRequest "http://127.0.0.1:$($env:CUA_PORT)/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if ($ok) { Info "Computer-Use 服务就绪" } else { Warn "服务未就绪 (依赖未装? 试试 -Install)" }
  } else { Info "跳过服务启动 (-SkipService); 请确保 $($env:SCIFORGE_CUA_SERVICE_URL) 已在运行" }

  # --- 5. launch the GUI -----------------------------------------------------
  Info "启动 SciForge GUI (npm run dev)  —  在对话框里直接用中文下达桌面任务"
  Info "computer_use 工具已通过 SCIFORGE_CUA_SERVICE_URL=$($env:SCIFORGE_CUA_SERVICE_URL) 接入"
  & npm run dev
}
finally {
  if ($server -and -not $server.HasExited) { Info "停止 Computer-Use 服务"; $server | Stop-Process -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Info "关闭 SSH 隧道"; $tunnel | Stop-Process -Force -ErrorAction SilentlyContinue }
}
