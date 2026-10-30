#requires -Version 5.1
<#
.SYNOPSIS
  One-click launcher: SciForge GUI wired to the sci-modality expert routing stack.

.DESCRIPTION
  Brings up everything so that scientific-file uploads in the SciForge GUI are routed to the
  GPU expert models (protein / protein_structure / molecule / single_cell) instead of being
  inlined as raw text.

    Mode "remote" (default): SSH-tunnels the already-deployed sci-modality service on the GPU
      server (port 3898) to localhost and points Model Router at it.
        local :3898  --ssh-->  GPU server 127.0.0.1:3898  (sci-modality-router service)
                                              `-> provider :8001 -> 4 GPU expert models

    Mode "local": SSH-tunnels only the GPU *provider* (port 8001) and runs THIS repo's
      @sciforge/sci-modality-router worker locally on :3898 against it. Use this to actually
      exercise the freshly merged worker code end to end.
        local worker :3898  ->  local :8001  --ssh-->  GPU server 127.0.0.1:8001 (provider)

  Why no GUI code change is needed: the GUI spawns Model Router as a child process with
  env = { ...process.env, ... } (src/main/model-router-sidecar.ts), so the child INHERITS this
  shell's environment. Exporting SCIFORGE_SCIMODALITY_SERVICE_URL and
  SCIFORGE_SCIMODALITY_SERVICE_TOKEN here is enough.

  Prerequisites:
    * Node 20+ and npm on PATH; OpenSSH client (ssh) on PATH.
    * Key-based SSH access to the GPU server (no password prompt).
    * SCIFORGE_SCIMODALITY_SERVICE_TOKEN for the sci-modality worker; in local mode,
      EXPERT_PROVIDER_API_KEY for the tunneled GPU provider.
    * The GPU server already running its expert stack (on the server:
      `cd packages/workers/sci-modality-router && bash deploy/start.sh`).
    * Model Router enabled + configured (API keys) in the SciForge GUI settings — that is what
      makes the GUI spawn the Model Router child that this script feeds.

.EXAMPLE
  ./scripts/start-sciforge-scimodality.ps1
.EXAMPLE
  ./scripts/start-sciforge-scimodality.ps1 -Mode local -Smoke
.EXAMPLE
  ./scripts/start-sciforge-scimodality.ps1 -SkipTunnel   # you manage the SSH tunnel yourself
#>
[CmdletBinding()]
param(
  [ValidateSet('remote', 'local')] [string]$Mode = 'remote',
  [string]$Server = 'root@101.126.157.149',
  [int]$SshPort = 2222,
  [int]$ServicePort = 3898,   # sci-modality service port (the one Model Router talks to)
  [int]$ProviderPort = 8001,  # GPU provider port (only tunneled in -Mode local)
  [string]$ServiceToken = $env:SCIFORGE_SCIMODALITY_SERVICE_TOKEN,
  [string]$ProviderToken = $env:EXPERT_PROVIDER_API_KEY,
  [int]$ServiceTimeoutMs = 0, # optional override for SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS
  [int]$ReadyTimeoutSec = 60,
  [switch]$Smoke,             # POST one sample protein and print the evidence before launching
  [switch]$SkipTunnel,        # assume the needed port-forward already exists
  [switch]$SkipInstall        # skip the one-time `npm install`
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $RepoRoot '.scimodality-run'
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$started = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$scopedEnvOriginals = @{}

function Info($m) { Write-Host "[start] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[start] $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "[start] $m" -ForegroundColor Red; throw $m }

function AuthHeaders([string]$token) {
  if ($token) { return @{ Authorization = "Bearer $token" } }
  return @{}
}

function Test-Health([int]$port, [string]$token = '') {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Headers (AuthHeaders $token) -Uri "http://127.0.0.1:$port/health"
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Wait-Health([int]$port, [int]$timeoutSec, [string]$what, [string]$token = '') {
  Info "waiting for $what on :$port (up to ${timeoutSec}s) ..."
  for ($i = 0; $i -lt $timeoutSec; $i++) {
    if (Test-Health $port $token) { Info "$what is READY"; return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Set-ScopedEnv([string]$name, [string]$value) {
  if (-not $scopedEnvOriginals.ContainsKey($name)) {
    $scopedEnvOriginals[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  Set-Item -Path "Env:$name" -Value $value
}

function Clear-ScopedEnvForChildIsolation([string[]]$names) {
  foreach ($name in $names) {
    Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  }
}

function Restore-ScopedEnv() {
  foreach ($entry in $scopedEnvOriginals.GetEnumerator()) {
    $name = [string]$entry.Key
    if ($null -eq $entry.Value) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$name" -Value ([string]$entry.Value)
    }
  }
}

try {
  Set-Location $RepoRoot
  $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source
  if (-not $npm) { Die 'npm not found on PATH (need Node 20+).' }
  $ssh = (Get-Command ssh -ErrorAction SilentlyContinue).Source
  if (-not $SkipTunnel -and -not $ssh) { Die 'ssh not found on PATH (install the OpenSSH client).' }
  if (-not $ServiceToken) {
    Die 'SCIFORGE_SCIMODALITY_SERVICE_TOKEN is required. Pass -ServiceToken or set the environment variable.'
  }
  if ($Mode -eq 'local' -and -not $ProviderToken) {
    Die 'EXPERT_PROVIDER_API_KEY is required in -Mode local. Pass -ProviderToken or set the environment variable.'
  }

  # 1) Dependencies (one-time; heavy because postinstall builds the local runtime).
  if (-not $SkipInstall -and -not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Info 'node_modules missing -> running "npm install" (one-time; builds the local runtime, may take several minutes) ...'
    & $npm install
    if ($LASTEXITCODE -ne 0) { Die 'npm install failed.' }
  }

  # 2) SSH tunnel (key-based; runs hidden in the background).
  if ($SkipTunnel) {
    Warn 'SkipTunnel set -> assuming the required port-forward already exists.'
  } else {
    $fwdPort = if ($Mode -eq 'remote') { $ServicePort } else { $ProviderPort }
    Info "opening SSH tunnel: localhost:$fwdPort -> ${Server} 127.0.0.1:$fwdPort (ssh -p $SshPort)"
    $sshArgs = @(
      '-p', "$SshPort", '-N',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-L', "${fwdPort}:127.0.0.1:${fwdPort}",
      "$Server"
    )
    $tunnel = Start-Process -FilePath $ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden `
      -RedirectStandardError (Join-Path $RunDir 'ssh.err.log')
    $started.Add($tunnel)
  }

  # 3) In local mode, run this repo's worker against the tunneled provider.
  if ($Mode -eq 'local') {
    if (-not $SkipTunnel) { Wait-Health $ProviderPort 30 'GPU provider (tunneled :8001)' $ProviderToken | Out-Null }
    $workerOnlyEnvNames = @(
      'EXPERT_PROVIDER_BASE_URL',
      'EXPERT_PROVIDER_API_KEY',
      'SCIMODALITY_ROUTER_HOST',
      'SCIMODALITY_ROUTER_PORT',
      'SCIMODALITY_ROUTER_RUNTIME_TOKEN'
    )
    try {
      Set-ScopedEnv 'EXPERT_PROVIDER_BASE_URL' "http://127.0.0.1:$ProviderPort/v1"
      Set-ScopedEnv 'EXPERT_PROVIDER_API_KEY' "$ProviderToken"
      Set-ScopedEnv 'SCIMODALITY_ROUTER_HOST' '127.0.0.1'
      Set-ScopedEnv 'SCIMODALITY_ROUTER_PORT' "$ServicePort"
      Set-ScopedEnv 'SCIMODALITY_ROUTER_RUNTIME_TOKEN' "$ServiceToken"
      Info "starting local @sciforge/sci-modality-router worker on :$ServicePort (provider -> :$ProviderPort)"
      $worker = Start-Process -FilePath $npm `
        -ArgumentList @('--workspace', '@sciforge/sci-modality-router', 'run', 'start') `
        -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RunDir 'worker.out.log') `
        -RedirectStandardError (Join-Path $RunDir 'worker.err.log')
      $started.Add($worker)
    } finally {
      Clear-ScopedEnvForChildIsolation $workerOnlyEnvNames
    }
  }

  # 4) Wait for the service endpoint the GUI will use, and show expert status.
  if (-not (Wait-Health $ServicePort $ReadyTimeoutSec 'sci-modality service' $ServiceToken)) {
    Warn "sci-modality service not healthy on :$ServicePort."
    if ($Mode -eq 'remote') {
      Warn 'On the GPU server, ensure it is up:  cd packages/workers/sci-modality-router && bash deploy/start.sh'
    } else {
      Warn "Check $RunDir\worker.err.log and that the provider tunnel (:$ProviderPort) is up."
    }
    Warn 'Continuing anyway (Model Router fails open to raw text). Ctrl+C to abort.'
  } else {
    try {
      $st = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 -Headers (AuthHeaders $ServiceToken) -Uri "http://127.0.0.1:$ServicePort/experts/status"
      Info ("provider reachable: {0}   device: {1}" -f $st.providerReachable, $st.device)
      foreach ($e in $st.experts) {
        Info ("  expert {0,-18} model {1,-22} online={2}" -f $e.modality, $e.model, $e.online)
      }
    } catch { Warn "couldn't read /experts/status: $($_.Exception.Message)" }
  }

  # 4b) Optional smoke test: one real translate call (no GUI needed).
  if ($Smoke) {
    Info 'smoke translate (ubiquitin, modality=protein) ...'
    $body = @{
      payload  = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG'
      modality = 'protein'
      objectId = 'smoke'
    } | ConvertTo-Json
    try {
      $r = Invoke-RestMethod -UseBasicParsing -TimeoutSec 600 -Method Post -ContentType 'application/json' `
        -Headers (AuthHeaders $ServiceToken) -Uri "http://127.0.0.1:$ServicePort/modality/translate" -Body $body
      if ($r.ok) {
        Info ("smoke OK   model={0}   modality={1}" -f $r.data.model, $r.data.modality)
        Write-Host $r.data.summary -ForegroundColor Green
      } else {
        Warn ("smoke returned error: {0} - {1}" -f $r.error.code, $r.error.message)
      }
    } catch { Warn "smoke failed: $($_.Exception.Message)" }
  }

  # 5) Point Model Router at the service. The GUI-spawned Model Router child inherits this.
  Set-ScopedEnv 'SCIFORGE_SCIMODALITY_SERVICE_URL' "http://127.0.0.1:$ServicePort"
  Set-ScopedEnv 'SCIFORGE_SCIMODALITY_SERVICE_TOKEN' "$ServiceToken"
  if ($ServiceTimeoutMs -gt 0) { Set-ScopedEnv 'SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS' "$ServiceTimeoutMs" }
  Info "SCIFORGE_SCIMODALITY_SERVICE_URL = $($env:SCIFORGE_SCIMODALITY_SERVICE_URL)"

  # 6) Launch the GUI (foreground; Ctrl+C returns here and the finally block cleans up).
  Info 'launching SciForge GUI (npm run dev) ...'
  Info 'Test routing by uploading a .fasta / .smi / .mol / .pdb / cell-marker file in a chat.'
  & $npm run dev
}
finally {
  Info 'shutting down helper processes ...'
  foreach ($p in $started) {
    try { if ($p -and -not $p.HasExited) { $p.Kill(); $p.WaitForExit(3000) | Out-Null } } catch {}
  }
  # Drop or restore the env we touched so a later plain `npm run dev` in this shell is unaffected.
  Restore-ScopedEnv
}
