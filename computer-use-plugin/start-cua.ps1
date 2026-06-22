# SciForge Computer-Use plugin - one-click launcher (Windows PowerShell 5.1, ASCII only)
# Opens the grounder tunnel (auto-starts GUI-Owl on the GPU box if down),
# installs deps on first run, starts the plugin server, runs a dry-run smoke test.
#   .\start-cua.ps1            -> safe mode (dry-run only; no real clicks)
#   .\start-cua.ps1 -Execute   -> ENABLE real mouse/keyboard (still needs execute+approve per call)
param([switch]$Execute)

$ErrorActionPreference = "Continue"
$PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $PluginDir

$SSH_HOST = "root@101.126.157.149"; $SSH_PORT = "2222"
$BOX_DIR  = "/fs-computility-new/upzd_share/shared/cua"

function Test-Port($h,$p){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect($h,$p); $c.Close(); $true }catch{ $false } }
function Test-Http($u){ try{ (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 $u).StatusCode -eq 200 }catch{ $false } }

Write-Host "=== SciForge Computer-Use launcher ===" -ForegroundColor Cyan

# 1) python
$py = "python"
try { & $py --version *> $null } catch { Write-Host "Python not on PATH" -ForegroundColor Red; exit 1 }

# 2) planner API key (env, else scan parent/plugin .txt files for a "key":"sk-..." entry)
if (-not $env:CUA_PLANNER_API_KEY) {
  $txts = @()
  foreach ($d in @($PluginDir, (Split-Path -Parent $PluginDir))) {
    if (Test-Path -LiteralPath $d) { $txts += Get-ChildItem -LiteralPath $d -Filter *.txt -File -ErrorAction SilentlyContinue }
  }
  foreach ($f in $txts) {
    $m = [regex]::Match((Get-Content -Raw -Encoding UTF8 -LiteralPath $f.FullName), '"key"\s*:\s*"(sk-[^"]+)"')
    if ($m.Success) { $env:CUA_PLANNER_API_KEY = $m.Groups[1].Value; break }
  }
}
if (-not $env:CUA_PLANNER_API_KEY) {
  Write-Host "WARN: CUA_PLANNER_API_KEY not set. Run:  `$env:CUA_PLANNER_API_KEY='sk-...'  then retry." -ForegroundColor Yellow
}

# 3) env defaults
if (-not $env:CUA_GROUNDER_BASE_URL) { $env:CUA_GROUNDER_BASE_URL = "http://127.0.0.1:18901/v1" }
if (-not $env:CUA_ARTIFACT_DIR)      { $env:CUA_ARTIFACT_DIR = "$PluginDir\cua-runs" }
if ($Execute) {
  $env:CUA_ALLOW_EXECUTE = "true"
  Write-Host "!! EXECUTE MODE: real mouse/keyboard enabled. Calls still need execute=true & approve=true." -ForegroundColor Red
} else {
  $env:CUA_ALLOW_EXECUTE = "false"
  Write-Host "Safe mode: dry-run only (no real actions)." -ForegroundColor Green
}

# 4) deps (first run)
& $py -c "import gui_agents,pyautogui,mss,pyperclip,PIL,requests" *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing dependencies (first run, ~few min)..." -ForegroundColor Yellow
  & $py -m pip install -q -r "$PluginDir\requirements.txt"
}

# 5) tunnel to grounder
if (-not (Test-Port "127.0.0.1" 18901)) {
  Write-Host "Opening SSH tunnel to grounder (:18901)..." -ForegroundColor Cyan
  Start-Process ssh -ArgumentList "-p",$SSH_PORT,"-N","-L","18901:127.0.0.1:18901","-o","ServerAliveInterval=30",$SSH_HOST -WindowStyle Minimized
  Start-Sleep 4
}

# 6) grounder health (auto-start on the box if down)
if (-not (Test-Http "http://127.0.0.1:18901/health")) {
  Write-Host "Grounder down; starting GUI-Owl on the GPU box (loads ~2 min)..." -ForegroundColor Yellow
  $cmd = "cd $BOX_DIR && setsid nohup bash run_serve.sh > serve.log 2>&1 < /dev/null & echo started"
  & ssh -p $SSH_PORT $SSH_HOST $cmd 2>$null
  for($i=0;$i -lt 18;$i++){ Start-Sleep 12; if(Test-Http "http://127.0.0.1:18901/health"){ break } }
}
if (Test-Http "http://127.0.0.1:18901/health") { Write-Host "Grounder: OK (:18901)" -ForegroundColor Green }
else { Write-Host "Grounder still down - check GPU box ($BOX_DIR/serve.log)." -ForegroundColor Red }

# 7) start plugin server (inherits env, incl. CUA_ALLOW_EXECUTE)
if (-not (Test-Http "http://127.0.0.1:3900/health")) {
  Write-Host "Starting plugin server (:3900)..." -ForegroundColor Cyan
  Start-Process $py -ArgumentList "-m","cua.server" -WorkingDirectory $PluginDir
  for($i=0;$i -lt 15;$i++){ Start-Sleep 1; if(Test-Http "http://127.0.0.1:3900/health"){ break } }
} else {
  Write-Host "Plugin server already running (:3900). To change execute-mode, close that window and re-run." -ForegroundColor Yellow
}
if (-not (Test-Http "http://127.0.0.1:3900/health")) { Write-Host "Server failed to start." -ForegroundColor Red; exit 1 }
Write-Host "Plugin server: OK (:3900)" -ForegroundColor Green

# 8) smoke test (dry-run on synthetic UI)
& $py "$PluginDir\eval\make_synthetic_ui.py" *> $null
$img = "$PluginDir\eval\_assets\synthetic_ui.png"
Write-Host "`nSmoke test (dry-run): 'Click the Save button' on a synthetic UI..." -ForegroundColor Cyan
try {
  $body = @{ instruction="Click the blue Save button"; imagePath=$img } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -TimeoutSec 90 -ContentType "application/json" -Body $body "http://127.0.0.1:3900/computer-use/run"
  if ($r.ok) { Write-Host ("  OK  status=" + $r.data.status + "  action=" + $r.data.steps[0].action + "  coords=" + ($r.data.steps[0].coords -join ",")) -ForegroundColor Green }
  else { Write-Host ("  error: " + $r.error.code) -ForegroundColor Red }
} catch { Write-Host ("  smoke failed: " + $_) -ForegroundColor Red }

# 9) usage
Write-Host "`n=== READY (server on http://127.0.0.1:3900) ===" -ForegroundColor Cyan
Write-Host "Batch dry-run all test cases on your LIVE screen (safe, no clicks):"
Write-Host "   python tests\live_cases.py" -ForegroundColor White
Write-Host "Single dry-run:"
Write-Host '   $b=@{instruction="Open Notepad and type hello"}|ConvertTo-Json; Invoke-RestMethod -Method Post -ContentType application/json -Body $b http://127.0.0.1:3900/computer-use/run|ConvertTo-Json -Depth 6' -ForegroundColor White
if (-not $Execute) { Write-Host "For REAL actions: re-run as  .\start-cua.ps1 -Execute  (then add execute=true,approve=true to the call)" -ForegroundColor Yellow }
Write-Host "Stop: close the 'python -m cua.server' and ssh tunnel windows." -ForegroundColor DarkGray
