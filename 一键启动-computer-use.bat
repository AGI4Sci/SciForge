@echo off
chcp 65001 >nul
REM SciForge + Computer-Use 一键启动 - 双击运行此文件
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动-sciforge-computer-use.ps1"
pause
