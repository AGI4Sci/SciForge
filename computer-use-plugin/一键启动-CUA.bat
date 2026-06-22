@echo off
REM One-click launcher for the SciForge Computer-Use plugin (safe / dry-run mode).
REM For real mouse/keyboard, run in PowerShell:  .\start-cua.ps1 -Execute
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cua.ps1"
echo.
echo (window stays open; close it to keep the server running, or Ctrl+C)
pause
