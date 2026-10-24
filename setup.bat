@echo off
title ScrapScout - setup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed.
    echo Install the LTS version from https://nodejs.org ^(opening it now^), then run setup.bat again.
    start "" https://nodejs.org
    pause
    exit /b 1
)

echo Installing ScrapScout...
call npm install --omit=dev --no-fund --no-audit
if errorlevel 1 (
    echo.
    echo Install failed. Scroll up for the error.
    pause
    exit /b 1
)

echo.
echo Linking your Steam account with Rust+.
echo A browser window will open - sign in with Steam there.
echo.
call npm run register
echo.
echo If it says Done, double-click start.bat to open the app.
pause
