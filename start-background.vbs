' Starts ScrapScout with no window. Output goes to data\app.log. Stop it with stop.bat.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c node server.js >> ""data\app.log"" 2>&1", 0, False
