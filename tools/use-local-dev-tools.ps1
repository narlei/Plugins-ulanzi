$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$nodeDir = Join-Path $workspace ".local-tools\node-v24.14.0-win-x64"
$gitCmd = "C:\Program Files\Git\cmd"

if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
} else {
  Write-Error "Node local nao encontrado em $nodeDir"
}

if (Test-Path $gitCmd) {
  $env:Path = "$gitCmd;$env:Path"
}

Write-Host "node: $(node -v)"
Write-Host "npm: $(npm -v)"
Write-Host "git: $(git --version)"
Write-Host "PATH preparado para esta sessao."
