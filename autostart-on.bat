@echo off
rem Makes ScrapScout start hidden every time you log in to Windows.
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\ScrapScout.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0start-background.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo ScrapScout will now start in the background when you log in.
echo Starting it now too...
wscript "%~dp0start-background.vbs"
echo Open http://localhost:3000 any time. Run autostart-off.bat to undo, stop.bat to stop it.
pause
