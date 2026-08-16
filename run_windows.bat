@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo First run: creating the local Python environment...
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 -m venv .venv || goto :error
  ) else (
    where python >nul 2>nul || goto :error
    python -m venv .venv || goto :error
  )
  .venv\Scripts\python.exe -m pip install -r requirements.txt || goto :error
)
echo.
set /p NETEASE_INPUT=NetEase playlist URL or ID (leave blank to skip):
set /p KUWO_INPUT=Kuwo playlist URL or ID (leave blank to skip):
set "ARGS="
if defined NETEASE_INPUT set ARGS=%ARGS% --netease "%NETEASE_INPUT%"
if defined KUWO_INPUT set ARGS=%ARGS% --kuwo "%KUWO_INPUT%"
if not defined ARGS (
  echo No playlist supplied.
  pause
  exit /b 2
)
.venv\Scripts\python.exe export_playlists.py %ARGS%
echo.
pause
exit /b %errorlevel%
:error
echo Setup failed. Please install Python 3.10 or newer from python.org and try again.
pause
exit /b 1
