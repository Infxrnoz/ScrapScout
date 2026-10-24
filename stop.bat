@echo off
rem Stops a ScrapScout that is running in the background (start-background.vbs / autostart).
cd /d "%~dp0"
if not exist "data\app.pid" (
    echo ScrapScout is not running in the background.
    pause
    exit /b 0
)
set /p PID=<"data\app.pid"
rem Only kill it if that process id is still a node.exe (ids get reused after a crash or reboot).
tasklist /FI "PID eq %PID%" /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 (
    echo It had already stopped.
) else (
    taskkill /F /PID %PID% >nul 2>nul && echo Stopped.
)
del "data\app.pid" 2>nul
pause
