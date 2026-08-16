@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON_EXE=.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
  echo 未找到项目的 Python 环境。
  echo 请先双击 run_windows.bat 完成环境安装。
  pause
  exit /b 1
)

start "音乐收藏网页服务（关闭此窗口将停止网页）" cmd /k ""%PYTHON_EXE%" -m http.server 8000 --directory docs"
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/"
