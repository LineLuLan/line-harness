' Line Hub launcher: start the dashboard server hidden (no console window) and open the browser.
' If the server already runs, server.js --open only opens the page and exits.
' The server stops by itself after 30 minutes without a viewer.
Option Explicit
Dim sh, fso, hubDir, serverJs
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hubDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
serverJs = fso.BuildPath(fso.BuildPath(hubDir, "server"), "server.js")
If Not fso.FileExists(serverJs) Then
  MsgBox "Line Hub server not found:" & vbCrLf & serverJs, vbExclamation, "Line Hub"
  WScript.Quit 1
End If
' 0 = hidden window, False = do not wait.
sh.Run "node """ & serverJs & """ --open", 0, False
