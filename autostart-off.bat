@echo off
rem Undoes autostart-on.bat (does not stop a copy that is already running - use stop.bat for that).
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ScrapScout.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Rust On Top.lnk" 2>nul
echo Autostart removed.
pause
