@echo off
cd /d "%~dp0"
py -3 server.py --host 0.0.0.0 --port 8080
if errorlevel 1 (
  echo.
  echo Server failed. See the message above.
  pause
)
