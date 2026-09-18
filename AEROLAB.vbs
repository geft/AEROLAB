Dim WshShell, fso, currentDir, nodeCmd, scriptPath, returnCode

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = currentDir

' Prefer local bundled node.exe if available in bin/, otherwise use system node
If fso.FileExists(currentDir & "\bin\node.exe") Then
    nodeCmd = """" & currentDir & "\bin\node.exe" & """"
Else
    nodeCmd = "node"
End If

scriptPath = """" & currentDir & "\scripts\launch-chrome-app.js" & """"

' Test if node is available
On Error Resume Next
Set execTest = WshShell.Exec(nodeCmd & " -v")
If Err.Number <> 0 Then
    MsgBox "AEROLAB engine could not be started." & vbCrLf & vbCrLf & _
           "Please ensure AEROLAB is properly installed or rerun AEROLAB-Setup.exe.", _
           vbCritical, "AEROLAB - Error"
    WScript.Quit 1
End If
On Error GoTo 0

' Launch AEROLAB silently (0 = hidden window, False = don't block)
' Absolutely NO terminal or command prompt window will appear!
WshShell.Run nodeCmd & " " & scriptPath, 0, False
