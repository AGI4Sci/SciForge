@echo off
REM =============================================================================
REM  One-click launcher: SciForge GUI with the Computer-Use module integrated.
REM  Double-click to: build SSH tunnel -> start Computer-Use service ->
REM  launch the SciForge GUI (npm run dev). Drive your desktop from the GUI chat;
REM  every real action is gated by an in-app approval prompt.
REM
REM  First run (install deps):   right-click the .ps1 and run with -Install, or:
REM      powershell -ExecutionPolicy Bypass -File 启动-sciforge-computer-use.ps1 -Install
REM  Safe dry-run (no real mouse/keyboard):
REM      powershell -ExecutionPolicy Bypass -File 启动-sciforge-computer-use.ps1 -SafeDryRun
REM
REM  (ASCII-only; locates the Chinese-named .ps1 by glob so it works on any code page.)
REM =============================================================================
setlocal
for %%F in ("%~dp0*sciforge-computer-use.ps1") do set "LAUNCHER=%%F"
if not defined LAUNCHER (
  echo [cua] launcher .ps1 not found next to this .bat
  pause & exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%" %*
echo.
echo (Closing this window stops the Computer-Use service and the SSH tunnel.)
pause
endlocal
