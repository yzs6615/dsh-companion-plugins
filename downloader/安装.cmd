@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 Node.js。DSH 需要 Node.js 22 以上，先装好 DSH 再双击这个文件。
  pause
  exit /b 1
)
node downloader.mjs %*
pause
