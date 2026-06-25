@echo off
REM =============================================================================
REM  One-click launcher for the GUI-Owl computer-use worker (safe DRY-RUN).
REM  Double-click: build SSH tunnel -> start HTTP service -> run sample
REM  acceptance tasks. DRY-RUN by default (does NOT touch the real mouse/keyboard).
REM
REM  For REAL execution (actually moves mouse/keyboard), run in PowerShell:
REM      .\启动-sciforge-computer-use.ps1 -Execute -Accept
REM
REM  (This .bat is intentionally ASCII-only and locates the Chinese-named .ps1 by
REM   glob, so it works regardless of the console code page.)
REM =============================================================================
setlocal
set "PS=powershell -NoProfile -ExecutionPolicy Bypass"
for %%F in ("%~dp0*sciforge-computer-use.ps1") do set "LAUNCHER=%%F"
if not defined LAUNCHER (
  echo [cua] launcher .ps1 not found next to this .bat
  pause
  exit /b 1
)
%PS% -File "%LAUNCHER%" -Accept %*
echo.
echo (Window stays open; closing it stops the service and tunnel.)
pause
endlocal
