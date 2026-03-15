$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Ulanzi Soundpad Bridge.lnk"
if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Autostart removed: $shortcutPath"
} else {
  Write-Host "Autostart shortcut not found."
}
