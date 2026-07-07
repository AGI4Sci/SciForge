<#
.SYNOPSIS
  一键启动「集成了 Computer-Use 模块」的 SciForge GUI。
  One-click launcher for the SciForge GUI with the Computer-Use worker wired through a grounding API.

.DESCRIPTION
  流程 / What it does:
    1. 读取 启动-secrets.local.ps1 (没有则用 .example 并告警)
    2. 校验 grounding model 本机密钥；URL/model/header 默认写在本包内
    3. 启动 Computer-Use 服务 (packages/workers/gui-owl-computer-use, HTTP :CUA_PORT)
    4. 设置 SCIFORGE_CUA_SERVICE_URL, 让所有 runtime 通过 gui_owl_computer_use MCP 使用 computer_use
    5. 启动 SciForge GUI (npm run dev)
  在 GUI 里用自然语言下达桌面任务即可; 每次真机动作都会先弹出审批, 同意后才执行。

.PARAMETER SafeDryRun
  纯演练: Computer-Use 只规划不动鼠标键盘 (任何执行返回 NEEDS_APPROVAL)。
  不加该开关时默认允许真机执行, 但每个动作仍需在 GUI 里点“同意”。
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
  [switch]$SkipService,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
# This script lives in the worker folder; the repo root is 3 levels up
# (packages/workers/gui-owl-computer-use -> repo). GUI runs from the repo root.
$worker = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $worker "..\..\..")).Path

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Info($m) { Write-Host "[cua] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[cua] $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "[cua] $m" -ForegroundColor Red; exit 1 }

# --- 1. secrets / config -----------------------------------------------------
$secretsLocal   = Join-Path $worker "启动-secrets.local.ps1"
$secretsExample = Join-Path $worker "启动-secrets.example.ps1"
if (Test-Path $secretsLocal) { Info "loading 启动-secrets.local.ps1"; . $secretsLocal }
elseif (Test-Path $secretsExample) { Warn "未找到 启动-secrets.local.ps1, 暂用 .example 默认值"; . $secretsExample }
else { Die "缺少 secrets 配置 (启动-secrets.local.ps1 / .example)" }

if (-not $env:CUA_PORT) { $env:CUA_PORT = "3900" }
if (-not $env:CUA_GROUNDING_BASE_URL) { $env:CUA_GROUNDING_BASE_URL = "http://10.140.158.130:8881/v1/chat/completions" }
if (-not $env:CUA_GROUNDING_MODEL) { $env:CUA_GROUNDING_MODEL = "gui-owl" }
if (-not $env:CUA_GROUNDING_ENDPOINT) { $env:CUA_GROUNDING_ENDPOINT = "chat_completions" }
if (-not $env:CUA_GROUNDING_EXTRA_HEADERS) { $env:CUA_GROUNDING_EXTRA_HEADERS = '{"x-original-model":"gui-owl"}' }
if (-not $env:CUA_GROUNDING_API_KEY -or $env:CUA_GROUNDING_API_KEY -eq "replace-with-grounding-api-key") {
  Die "缺少 CUA_GROUNDING_API_KEY; 请通过 启动-secrets.local.ps1 或环境变量提供 grounding API key"
}

# 真机执行默认开启 (每个动作仍由 GUI 审批门控); -SafeDryRun 关闭。
$env:CUA_ALLOW_EXECUTE = if ($SafeDryRun) { "false" } else { "true" }
# 让 GUI-managed MCP wrapper 指向本地 sidecar；Codex/Claude/Kun 统一读取这一路径。
$env:SCIFORGE_CUA_SERVICE_URL = "http://127.0.0.1:$($env:CUA_PORT)"
# 生成本次启动专用的本地 sidecar token。Computer-Use 服务和 GUI 子进程都
# 继承同一个值；没有这个 bearer token 的本机 HTTP 请求不能调用 run/cancel。
if (-not $env:CUA_SERVICE_TOKEN) {
  $tokenBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($tokenBytes) } finally { $rng.Dispose() }
  $env:CUA_SERVICE_TOKEN = [Convert]::ToBase64String($tokenBytes)
}
$env:SCIFORGE_CUA_SERVICE_TOKEN = $env:CUA_SERVICE_TOKEN

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "找不到 node, 请先安装 Node.js" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Die "找不到 python, 请先安装并加入 PATH" }

# --- 2. deps (opt-in) --------------------------------------------------------
if ($Install) {
  Info "npm install (root)"; & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Die "npm install 失败" }
  Info "pip install worker requirements"; & python -m pip install -r (Join-Path $worker "requirements.txt"); if ($LASTEXITCODE -ne 0) { Die "pip install 失败" }
}

# --- 3. Grounding endpoint config --------------------------------------------
Info "Grounding endpoint: $($env:CUA_GROUNDING_BASE_URL) (model=$($env:CUA_GROUNDING_MODEL), endpoint=$($env:CUA_GROUNDING_ENDPOINT))"

# --- 4. Computer-Use service -------------------------------------------------
$server = $null
try {
  if (-not $SkipService) {
    Info "启动 Computer-Use 服务 :$($env:CUA_PORT)  (真机执行=$($env:CUA_ALLOW_EXECUTE), grounding=$($env:CUA_GROUNDING_MODEL) @ $($env:CUA_GROUNDING_BASE_URL))"
    $server = Start-Process python -ArgumentList @("-m","cua.cli","--http") -PassThru -WorkingDirectory $worker
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
      try { Invoke-WebRequest "http://127.0.0.1:$($env:CUA_PORT)/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true; break }
      catch { Start-Sleep -Milliseconds 500 }
    }
    if ($ok) { Info "Computer-Use 服务就绪" } else { Warn "服务未就绪 (依赖未装? 试试 -Install)" }
  } else { Info "跳过服务启动 (-SkipService); 请确保 $($env:SCIFORGE_CUA_SERVICE_URL) 已在运行" }

  # --- 5. launch the GUI (from the repo root) --------------------------------
  Info "启动 SciForge GUI (npm run dev)  —  在对话框里直接用中文下达桌面任务"
  Info "computer_use 工具已通过 SCIFORGE_CUA_SERVICE_URL=$($env:SCIFORGE_CUA_SERVICE_URL) 接入"
  Set-Location $repo
  & npm run dev
}
finally {
  if ($server -and -not $server.HasExited) { Info "停止 Computer-Use 服务"; $server | Stop-Process -Force -ErrorAction SilentlyContinue }
}
