$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Ulanzi Soundpad Bridge.lnk"
$target = Join-Path $root "start-bridge.cmd"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "Start Ulanzi Soundpad bridge"
$shortcut.Save()

Write-Host "Autostart installed: $shortcutPath"
