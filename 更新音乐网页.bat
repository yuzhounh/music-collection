@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 更新音乐收藏网页

if not exist ".venv\Scripts\python.exe" (
  echo 正在创建 Python 环境……
  py -3 -m venv .venv 2>nul
  if errorlevel 1 python -m venv .venv
  if errorlevel 1 goto :failed
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  if errorlevel 1 goto :failed
)

echo 正在重新抓取歌单并生成网页，请稍候……
.venv\Scripts\python.exe update_music_site.py --push
if errorlevel 1 goto :failed

echo.
echo 更新完成：https://yuzhounh.github.io/music-collection/
pause
exit /b 0

:failed
echo.
echo 更新没有完成，原网页数据不会被覆盖。
pause
exit /b 1
