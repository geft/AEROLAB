Dim WshShell, fso, desktopPath, currentDir, shortcut

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

desktopPath = WshShell.SpecialFolders("Desktop")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shortcut = WshShell.CreateShortcut(desktopPath & "\AEROLAB.lnk")
shortcut.TargetPath = currentDir & "\AEROLAB.exe"
shortcut.WorkingDirectory = currentDir
shortcut.IconLocation = currentDir & "\aerolab.ico"
shortcut.Description = "AEROLAB - Physiological Running Analytics"
shortcut.Save

MsgBox "Desktop shortcut created successfully on your Desktop!" & vbCrLf & vbCrLf & _
       "You can now double-click 'AEROLAB' on your desktop to launch without any terminal.", _
       vbInformation, "AEROLAB - Shortcut Created"
