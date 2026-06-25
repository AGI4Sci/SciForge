<#
.SYNOPSIS
  一键启动 GUI-Owl computer-use worker，方便在本地跑真机任务验收。
  One-click launcher for the GUI-Owl computer-use worker (local real-machine acceptance).

.DESCRIPTION
  流程 / What it does:
    1. 读取 启动-secrets.local.ps1 (没有则用 .example 并告警)
    2. 自动建立到 GPU 服务器的 SSH 隧道, 把远端 GUI-Owl vLLM 端口转发到本地
    3. 健康检查模型端点
    4. 启动 worker:
         - 默认 HTTP sidecar (可被 Kun 的 computer_use 工具 / curl 调用)
         - -Stdio 改为 MCP stdio server
    5. -Accept: 启动后自动跑几个示例真机任务 (accept.py) 并打印 trace

.PARAMETER Execute
  打开真机执行 (CUA_ALLOW_EXECUTE=true)。不加则为安全的 dry-run (只规划不动鼠标键盘)。
.PARAMETER Accept
  服务起来后自动运行 accept.py 的示例任务做验收。
.PARAMETER Stdio
  以 MCP stdio 方式启动 (供 agent runtime 托管), 而不是 HTTP。
.PARAMETER NoTunnel
  跳过 SSH 隧道 (当 CUA_MODEL_BASE_URL 已直连可用时)。
.PARAMETER Install
  启动前 pip 安装 requirements.txt。

.EXAMPLE
  .\启动-sciforge-computer-use.ps1                 # 安全 dry-run, HTTP, 不动真机
  .\启动-sciforge-computer-use.ps1 -Execute -Accept # 真机执行 + 自动跑验收任务
#>
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$Accept,
  [switch]$Stdio,
  [switch]$NoTunnel,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Set-Location $here

# 让控制台与 Python 都用 UTF-8, 否则中文输出在 GBK 控制台会乱码。
# Force UTF-8 for the console + Python so Chinese output isn't mojibake on a GBK console.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Info($m)  { Write-Host "[cua] $m" -ForegroundColor Cyan }
function Warn($m)  { Write-Host "[cua] $m" -ForegroundColor Yellow }
function Die($m)   { Write-Host "[cua] $m" -ForegroundColor Red; exit 1 }

# --- 1. secrets / config -----------------------------------------------------
$secretsLocal   = Join-Path $here "启动-secrets.local.ps1"
$secretsExample = Join-Path $here "启动-secrets.example.ps1"
if (Test-Path $secretsLocal) {
  Info "loading 启动-secrets.local.ps1"
  . $secretsLocal
} elseif (Test-Path $secretsExample) {
  Warn "未找到 启动-secrets.local.ps1, 暂用 .example 默认值 (建议复制一份填真实值)"
  . $secretsExample
} else {
  Die "缺少 secrets 配置文件 (启动-secrets.local.ps1 / .example)"
}

# real-desktop execution is opt-in
$env:CUA_ALLOW_EXECUTE = if ($Execute) { "true" } else { "false" }
if (-not $env:CUA_PORT) { $env:CUA_PORT = "3900" }
if (-not $env:CUA_LOCAL_PORT) { $env:CUA_LOCAL_PORT = "4243" }

$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { Die "找不到 python, 请先安装并加入 PATH" }

# --- 2. deps -----------------------------------------------------------------
if ($Install) {
  Info "pip install -r requirements.txt"
  & python -m pip install -r (Join-Path $here "requirements.txt")
  if ($LASTEXITCODE -ne 0) { Die "pip install 失败" }
}

# --- 3. SSH tunnel to the GUI-Owl GPU box ------------------------------------
$tunnel = $null
function Test-Port([int]$port) {
  try { (New-Object Net.Sockets.TcpClient).Connect("127.0.0.1", $port); return $true }
  catch { return $false }
}
if (-not $NoTunnel) {
  $lp = [int]$env:CUA_LOCAL_PORT
  if (Test-Port $lp) {
    Info "本地端口 $lp 已在监听, 复用现有隧道"
  } elseif ($env:CUA_SSH_HOST) {
    $sshArgs = @(
      "-p", $env:CUA_SSH_PORT, "-N",
      "-o", "ServerAliveInterval=30", "-o", "ExitOnForwardFailure=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-L", "$($env:CUA_LOCAL_PORT):127.0.0.1:$($env:CUA_REMOTE_PORT)",
      "$($env:CUA_SSH_USER)@$($env:CUA_SSH_HOST)"
    )
    Info "建立 SSH 隧道: localhost:$($env:CUA_LOCAL_PORT) -> $($env:CUA_SSH_HOST):$($env:CUA_REMOTE_PORT)"
    $tunnel = Start-Process ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Test-Port $lp); $i++) { Start-Sleep -Milliseconds 500 }
    if (Test-Port $lp) { Info "隧道就绪" } else { Warn "隧道端口未就绪 (模型可能仍在加载); 继续, dry-run 仍可测路径" }
  } else {
    Warn "未配置 CUA_SSH_HOST, 跳过隧道"
  }
}

# --- 4/5. start worker (+ optional acceptance) -------------------------------
$server = $null
try {
  if ($Stdio) {
    Info "启动 MCP stdio server (Ctrl+C 退出)"
    & python -m cua.cli --stdio
    return
  }

  Info "启动 HTTP sidecar :$($env:CUA_PORT)  (CUA_ALLOW_EXECUTE=$($env:CUA_ALLOW_EXECUTE))"
  if ($Accept) {
    # 后台起服务 -> 健康检查 -> 跑验收任务 -> 保持运行
    $server = Start-Process python -ArgumentList @("-m","cua.cli","--http") -PassThru -WorkingDirectory $here
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      try { Invoke-WebRequest "http://127.0.0.1:$($env:CUA_PORT)/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ok) { Die "HTTP 服务未就绪" }
    Info "服务就绪, 运行验收任务 accept.py"
    $acceptArgs = @((Join-Path $here "accept.py"), "--url", "http://127.0.0.1:$($env:CUA_PORT)")
    if ($Execute) { $acceptArgs += "--execute" }
    & python @acceptArgs
    Info "验收任务结束。服务仍在运行 (Ctrl+C 关闭)。"
    while ($server -and -not $server.HasExited) { Start-Sleep -Seconds 1 }
  } else {
    # 前台运行, Ctrl+C 直接停
    & python -m cua.cli --http
  }
}
finally {
  if ($server -and -not $server.HasExited) { Info "停止 HTTP 服务"; $server | Stop-Process -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Info "关闭 SSH 隧道"; $tunnel | Stop-Process -Force -ErrorAction SilentlyContinue }
}
