# ============================================================================
# SciForge (gui branch) + Computer-Use one-click launcher
#
#   1) SSH port-forward: GUI-Owl grounder (:18901) on the GPU box -> local,
#      auto-starting it on the box if it is down.
#   2) Start the Computer-Use plugin server (:3900) in EXECUTE mode (planner =
#      qwen3.7-plus gateway, grounder = the tunnelled GUI-Owl). This is the
#      service kun's `computer_use` tool talks to.
#   3) Seed model settings on first run (DeepSeek text + Qwen vision).
#   4) Start the Model Router (:3892) ourselves -- the app's own auto-start
#      throws `spawn EINVAL` on Windows, so we launch it directly with node+tsx.
#   5) Start the Evidence-DAG engine (:3897) -- optional, fail-open.
#   6) Launch the app: npm run dev. SCIFORGE_CUA_SERVICE_URL is exported first so
#      kun advertises the `computer_use` tool to DeepSeek (fail-closed: unset =
#      tool hidden). Every computer_use call is still gated by the in-app
#      approval prompt before any real mouse/keyboard action runs.
#
# Run:  powershell -ExecutionPolicy Bypass -File ".\启动-sciforge-computer-use.ps1"
# Stop: close the app window; this script tears down plugin + router + engine +
#       SSH forward. (The GUI-Owl process on the GPU box is left running.)
# ============================================================================

# 'Continue', not 'Stop': this launcher drives native tools (python/node/npm/ssh)
# that legitimately write to stderr. Under 'Stop', PowerShell 5.1 promotes any
# native stderr line to a terminating NativeCommandError and aborts the launcher.
# Hard-stop conditions below use explicit `throw` instead, which always terminates.
$ErrorActionPreference = 'Continue'
$Root      = $PSScriptRoot
$GuiDir    = $Root                                   # merged repo: the app lives at the root
$CuaDir    = Join-Path $Root 'computer-use-plugin'
$EngineDir = Join-Path $Root 'evidence-dag-engine'

# --- site secrets / config (NEVER commit real values) -----------------------
# Real values live in an untracked, git-ignored file or in environment vars.
# Copy 启动-secrets.example.ps1 -> 启动-secrets.local.ps1 and fill it in.
$secretsFile = Join-Path $Root '启动-secrets.local.ps1'
if (Test-Path $secretsFile) { . $secretsFile }

# GPU box that serves GUI-Owl (grounder/executor) over SSH.
if (-not $GpuHost) { $GpuHost = if ($env:CUA_GPU_HOST) { $env:CUA_GPU_HOST } else { 'root@YOUR_GPU_HOST' } }
if (-not $GpuPort) { $GpuPort = if ($env:CUA_GPU_PORT) { [int]$env:CUA_GPU_PORT } else { 2222 } }
if (-not $BoxDir)  { $BoxDir  = if ($env:CUA_BOX_DIR)  { $env:CUA_BOX_DIR }  else { '/path/to/cua' } }

# --- local ports -------------------------------------------------------------
$GroundPort = 4243    # GUI-Owl serve on the GPU box (served-model-name 'gui-owl')
$CuaPort    = 3900    # computer-use plugin server
$RtrPort    = 3892    # model router (must match modelRouter.baseUrl in settings)
$EdagPort   = 3897    # evidence-dag engine (optional)

# --- model gateway (OpenAI-compatible proxy: text + vision + CUA planner) ----
if (-not $DS_URL)            { $DS_URL   = if ($env:SCIFORGE_GATEWAY_URL) { $env:SCIFORGE_GATEWAY_URL } else { 'http://YOUR_GATEWAY:3888/v1' } }
if (-not $DS_MODEL)          { $DS_MODEL = 'bailian/deepseek-v4-flash' }
if (-not $QWEN_MODEL)        { $QWEN_MODEL = 'qwen3.7-plus' }
# CUA planner: a strong reasoner plans GUI navigation reliably.
if (-not $CUA_PLANNER_MODEL) { $CUA_PLANNER_MODEL = 'claude-opus-4-7' }
if (-not $KEY)               { $KEY = $env:SCIFORGE_GATEWAY_KEY }
if (-not $KEY) { throw "Gateway API key missing -- set `$env:SCIFORGE_GATEWAY_KEY, or define `$KEY in 启动-secrets.local.ps1 (copy from 启动-secrets.example.ps1)." }

if (-not (Test-Path $GuiDir))   { throw "Missing $GuiDir" }
if (-not (Test-Path $CuaDir))   { throw "Missing $CuaDir -- the computer-use-plugin folder must sit inside the repo." }
$bg = @()   # background processes to clean up on exit

function Wait-Url($url, $tries) {
  foreach ($i in 1..$tries) {
    try { if ((Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Milliseconds 800
  }
  return $false
}
# Like Wait-Url but treats ANY HTTP response (incl. 401/403/404) as "up" -- the
# port is bound and the server answered. The Model Router requires an auth token
# on /v1/models, so it returns 401 to an unauthenticated probe even when healthy.
function Wait-Bound($url, $tries) {
  foreach ($i in 1..$tries) {
    try { Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing | Out-Null; return $true }
    catch { if ($_.Exception.Response) { return $true } }   # got an HTTP status => bound
    Start-Sleep -Milliseconds 800
  }
  return $false
}
function Test-Port($h, $p) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect($h, $p); $c.Close(); $true } catch { $false }
}

try {
  # --- 1) SSH port-forward the grounder, auto-start GUI-Owl on the box -------
  Write-Host "[1/6] SSH port-forward 127.0.0.1:$GroundPort -> GPU grounder ..." -ForegroundColor Cyan
  # -o BatchMode/accept-new: never block on a password or first-connect host-key prompt.
  $sshOpts = "-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30"
  if (-not (Test-Port '127.0.0.1' $GroundPort)) {
    $bg += Start-Process ssh -PassThru -WindowStyle Hidden `
      -ArgumentList "-p $GpuPort -N -L ${GroundPort}:127.0.0.1:${GroundPort} $sshOpts $GpuHost"
    Start-Sleep -Seconds 4
  } else {
    Write-Host "      tunnel/port already up, skip." -ForegroundColor DarkGray
  }
  if (Wait-Url "http://127.0.0.1:$GroundPort/health" 1) {
    Write-Host "      grounder ready (:$GroundPort) -- already loaded." -ForegroundColor Green
  } else {
    # Ask the box to start GUI-Owl (idempotent: run_serve.sh no-ops if vLLM is already serving).
    # Cold-loading an 8B vLLM model takes ~2-3 min; this is one-time and only happens when the
    # box is not already serving. Subsequent launches hit the "already loaded" path above.
    Write-Host "      grounder not serving yet; asking the GPU box to start GUI-Owl ..." -ForegroundColor Yellow
    $remote = "cd $BoxDir && setsid nohup bash run_serve.sh > serve.log 2>&1 < /dev/null & echo started"
    try { & ssh -p $GpuPort -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 $GpuHost $remote | Out-Null }
    catch { Write-Warning "      remote start command failed: $_" }
    Write-Host "      waiting for the model to load (up to ~5 min, polling) " -ForegroundColor Yellow -NoNewline
    $ready = $false
    foreach ($i in 1..100) {                       # 100 x ~3s = ~5 min ceiling
      if (Wait-Url "http://127.0.0.1:$GroundPort/health" 1) { $ready = $true; break }
      Write-Host "." -ForegroundColor DarkGray -NoNewline
      Start-Sleep -Seconds 3
    }
    Write-Host ""
    if ($ready) { Write-Host "      grounder ready (:$GroundPort)." -ForegroundColor Green }
    else { Write-Warning "      grounder still not up after ~5 min -- check $BoxDir/serve.log on the GPU box. computer_use will fail until it is up." }
  }

  # --- 2) start the Computer-Use plugin server (EXECUTE mode) ---------------
  Write-Host "[2/6] Starting Computer-Use plugin on :$CuaPort (EXECUTE mode) ..." -ForegroundColor Cyan
  # NATIVE GUI-Owl-1.5 (open-source, end-to-end): one model is the whole agent --
  # it reads the screen AND decides each action. No Agent-S, no planner/grounder
  # split, no proprietary model. Points at the GUI-Owl already served on the box.
  $env:CUA_MODEL_BASE_URL = "http://127.0.0.1:$GroundPort/v1"
  $env:CUA_MODEL          = 'gui-owl'    # must match served-model-name on :4243 (NOT gui-owl-1.5-8b)
  $env:CUA_MODEL_API_KEY  = 'EMPTY'
  $env:CUA_MAX_STEPS      = '12'      # allow longer tasks to actually finish
  $env:CUA_PORT              = "$CuaPort"
  $env:CUA_ALLOW_EXECUTE     = 'true'    # real actions still need the in-app approval per call
  $env:CUA_SHOW_OVERLAY      = 'true'    # paint the mouse overlay on the real desktop
  $env:CUA_ARTIFACT_DIR      = (Join-Path $CuaDir 'cua-runs')
  # Reflector default is MODEL-AWARE: the 32B is strong but its extra per-step
  # self-check (one more model call per action) is slow, so default it OFF on 32B;
  # the 8B benefits from reflection, so default ON. Both models serve as 'gui-owl'
  # on :4243, so we ask the box which one is actually loaded. An explicit
  # CUA_REFLECT in the environment always wins.
  if (-not $env:CUA_REFLECT) {
    $served = ''
    try {
      $served = (& ssh -p $GpuPort -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 `
                   $GpuHost "pgrep -af vllm | grep -o 'GUI-Owl-1.5-[0-9]*B-Instruct' | head -1" 2>$null |
                 Select-Object -First 1)
    } catch {}
    if     ($served -match '32B') { $env:CUA_REFLECT = 'false'; Write-Host "      serving 32B -> Reflector OFF (speed)" -ForegroundColor DarkGray }
    elseif ($served -match '8B')  { $env:CUA_REFLECT = 'true';  Write-Host "      serving 8B -> Reflector ON" -ForegroundColor DarkGray }
    else                          { $env:CUA_REFLECT = 'true';  Write-Host "      model size unknown -> Reflector ON (set CUA_REFLECT=false to override)" -ForegroundColor DarkYellow }
  } else {
    Write-Host "      CUA_REFLECT override = $($env:CUA_REFLECT)" -ForegroundColor DarkGray
  }
  if (Wait-Url "http://127.0.0.1:$CuaPort/health" 1) {
    Write-Host "      something already on :$CuaPort, skip." -ForegroundColor DarkGray
  } else {
    # Pick a Python that has the plugin deps. The native GUI-Owl driver no longer
    # uses Agent-S (gui_agents); the server only needs requests/pyautogui/mss/
    # pyperclip/Pillow. numpy (eval-only) still lacks wheels on 3.13/3.14, so we
    # keep preferring 3.10-3.12. (On this box, py -3.10 has the deps.)
    $PyExe = $null; $PyInstallExe = $null
    foreach ($cand in @('py -3.10', 'py -3.11', 'py -3.12', 'python')) {
      $cp = $cand -split ' '
      $exe = (& $cp[0] @($cp[1..($cp.Length - 1)]) -c "import sys;print(sys.executable)" 2>$null | Select-Object -First 1)
      if (-not $exe) { continue }
      & $exe -c "import pyautogui,mss,pyperclip,PIL,requests" 2>$null 1>$null
      if ($LASTEXITCODE -eq 0) { $PyExe = $exe; break }
      if (-not $PyInstallExe) { $PyInstallExe = $exe }   # first usable interpreter, for install fallback
    }
    if (-not $PyExe) {
      if (-not $PyInstallExe) { throw "No usable Python found to run the computer-use plugin (need 3.10-3.12)." }
      Write-Host "      installing plugin dependencies into $PyInstallExe (one-time, ~few min) ..." -ForegroundColor Cyan
      & $PyInstallExe -m pip install -q -r (Join-Path $CuaDir 'requirements.txt')
      & $PyInstallExe -c "import pyautogui,mss,pyperclip,PIL,requests" 2>$null 1>$null
      if ($LASTEXITCODE -eq 0) { $PyExe = $PyInstallExe }
      else { Write-Warning "      dependency install failed -- use Python 3.10-3.12 (your default is 3.14). Plugin will not start." }
    }
    if ($PyExe) {
      Write-Host "      using Python: $PyExe" -ForegroundColor DarkGray
      $cuaLog = Join-Path $Root 'computer-use.local.log'
      $bg += Start-Process $PyExe -PassThru -WindowStyle Hidden -WorkingDirectory $CuaDir `
        -RedirectStandardOutput $cuaLog -RedirectStandardError ($cuaLog + '.err') `
        -ArgumentList "-m cua.server"
      if (Wait-Url "http://127.0.0.1:$CuaPort/health" 20) { Write-Host "      plugin ready (log: $cuaLog)." -ForegroundColor Green }
      else { Write-Warning "      plugin not confirmed -- see $cuaLog" }
    }
  }

  # --- 3) seed settings on first run ----------------------------------------
  $settingsFile = Join-Path $env:APPDATA 'DeepSeek GUI\deepseek-gui-settings.json'
  if (-not (Test-Path $settingsFile)) {
    Write-Host "[3/6] Seeding model settings ..." -ForegroundColor Cyan
    Push-Location $GuiDir
    try { node --import tsx (Join-Path $Root 'seed-settings.mjs') } catch { Write-Warning "      seed failed: $_" } finally { Pop-Location }
  } else {
    Write-Host "[3/6] Settings exist (delete to reset: $settingsFile)." -ForegroundColor DarkGray
  }

  # read the app's generated Model Router runtime key so kun's bearer matches
  $runtimeKey = (node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.APPDATA+'/DeepSeek GUI/deepseek-gui-settings.json','utf8')).modelRouter.runtimeApiKey)").Trim()
  if (-not $runtimeKey) { throw "Could not read modelRouter.runtimeApiKey from settings." }

  # --- 4) start the Model Router ourselves (port $RtrPort) ------------------
  Write-Host "[4/6] Starting Model Router on :$RtrPort (DeepSeek text + Qwen vision) ..." -ForegroundColor Cyan
  $env:DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY = $runtimeKey
  $env:SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS  = 'deepseek-gui-router'
  $env:SCIFORGE_TEXT_BASE_URL   = $DS_URL;   $env:SCIFORGE_TEXT_MODEL   = $DS_MODEL;   $env:SCIFORGE_TEXT_API_KEY   = $KEY
  $env:SCIFORGE_VISION_BASE_URL = $DS_URL;   $env:SCIFORGE_VISION_MODEL = $QWEN_MODEL; $env:SCIFORGE_VISION_API_KEY = $KEY
  if (Wait-Bound "http://127.0.0.1:$RtrPort/v1/models" 1) {
    Write-Host "      something already on :$RtrPort, skip." -ForegroundColor DarkGray
  } else {
    $routerLog = Join-Path $Root 'model-router.local.log'
    $bg += Start-Process node -PassThru -WindowStyle Hidden -WorkingDirectory $GuiDir `
      -RedirectStandardOutput $routerLog -RedirectStandardError ($routerLog + '.err') `
      -ArgumentList "--import tsx packages/workers/model-router/src/cli.ts --port $RtrPort --host 127.0.0.1 --workspace-root `"$($env:USERPROFILE)\.deepseekgui\default_workspace`""
    if (Wait-Bound "http://127.0.0.1:$RtrPort/v1/models" 25) { Write-Host "      Model Router ready (log: $routerLog)." -ForegroundColor Green }
    else { Write-Warning "      Model Router not confirmed -- see $routerLog" }
  }

  # --- 5) start the Evidence-DAG engine (optional, port $EdagPort) ----------
  Write-Host "[5/6] Starting Evidence-DAG engine on :$EdagPort (optional) ..." -ForegroundColor Cyan
  if (-not (Test-Path $EngineDir)) {
    Write-Host "      $EngineDir missing -- skipping (Evidence DAG button will not connect)." -ForegroundColor DarkGray
  } elseif (Wait-Url "http://127.0.0.1:$EdagPort/health" 1) {
    Write-Host "      already up, skip." -ForegroundColor DarkGray
  } else {
    $env:PYTHONPATH        = (Join-Path $EngineDir 'src')
    $env:PYTHONUTF8        = '1'
    $env:EDAG_LLM_BASE_URL = $DS_URL
    $env:EDAG_LLM_API_KEY  = $KEY
    $env:EDAG_LLM_MODEL    = $DS_MODEL
    $env:EDAG_STORAGE_DIR  = (Join-Path $EngineDir 'out\threads')
    $env:EDAG_PORT         = "$EdagPort"
    $env:EDAG_AUTO_VERIFY  = '1'
    $edagLog = Join-Path $Root 'evidence-dag.local.log'
    $bg += Start-Process python -PassThru -WindowStyle Hidden -WorkingDirectory $EngineDir `
      -RedirectStandardOutput $edagLog -RedirectStandardError ($edagLog + '.err') `
      -ArgumentList "-m evidence_dag.server"
    if (Wait-Url "http://127.0.0.1:$EdagPort/health" 20) { Write-Host "      engine ready (UI: http://127.0.0.1:$EdagPort/)." -ForegroundColor Green }
    else { Write-Warning "      engine not confirmed (python + networkx installed?) -- see $edagLog" }
  }

  # --- 6) launch the app ----------------------------------------------------
  # Export the seams BEFORE npm run dev so the app -> kun child inherits them.
  #   * SCIFORGE_CUA_SERVICE_URL    -> kun advertises the computer_use tool (fail-closed)
  #   * SCIFORGE_EVIDENCE_DAG_...   -> kun feeds the engine on turn completion (fail-open)
  $env:SCIFORGE_CUA_SERVICE_URL          = "http://127.0.0.1:$CuaPort"
  $env:SCIFORGE_EVIDENCE_DAG_SERVICE_URL = "http://127.0.0.1:$EdagPort"

  Write-Host "[6/6] Launching DeepSeek GUI (npm run dev) ... first run builds kun, please wait." -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  NOTE: the app may log 'Failed to auto-start Model Router (spawn EINVAL)' -- expected;" -ForegroundColor DarkYellow
  Write-Host "        we started the router ourselves on :$RtrPort." -ForegroundColor DarkYellow
  Write-Host "  COMPUTER USE: just ask in natural language (e.g. 'open Notepad and type hello')." -ForegroundColor Green
  Write-Host "        Each call asks for approval before touching the mouse/keyboard; a translucent" -ForegroundColor Green
  Write-Host "        overlay shows where the agent acts. Slam the mouse to a screen corner to abort." -ForegroundColor Green
  Write-Host ""
  # Ensure gui deps are installed (a stale node_modules breaks the renderer build).
  if (-not (Test-Path (Join-Path $GuiDir 'node_modules\rehype-katex'))) {
    Write-Host "      installing gui dependencies (npm install) -- one-time ..." -ForegroundColor Cyan
    Push-Location $GuiDir
    try { npm install } finally { Pop-Location }
  }
  Push-Location $GuiDir
  npm run dev
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  foreach ($p in $bg) {
    if ($p -and -not $p.HasExited) {
      Write-Host "Cleaning up pid $($p.Id) ..." -ForegroundColor DarkGray
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
