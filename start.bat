@echo off
title ScrapScout
cd /d "%~dp0"

if not exist node_modules (
    echo Run setup.bat first.
    pause
    exit /b 1
)

rem Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
echo ScrapScout is running at http://localhost:3000 - keep this window open. Close it to stop.
call npm start
pause
