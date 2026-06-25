@echo off
REM Double-click / cmd wrapper for the SciForge + sci-modality one-click launcher.
REM Passes any extra args through, e.g.:  start-sciforge-scimodality.cmd -Mode local -Smoke
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-sciforge-scimodality.ps1" %*
