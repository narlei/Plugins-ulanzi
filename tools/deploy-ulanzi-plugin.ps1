param(
  [Parameter(Mandatory = $true)]
  [string]$PluginName,
  [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $workspaceRoot $PluginName
$pluginsRoot = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins"
$destDir = Join-Path $pluginsRoot $PluginName

if (-not (Test-Path -LiteralPath $sourceDir)) {
  throw "Plugin source not found: $sourceDir"
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceDir "manifest.json"))) {
  throw "manifest.json not found in plugin source: $sourceDir"
}

if (-not (Test-Path -LiteralPath $pluginsRoot)) {
  throw "Ulanzi plugins folder not found: $pluginsRoot"
}

if (-not (Test-Path -LiteralPath $destDir)) {
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

if ($Clean) {
  Get-ChildItem -LiteralPath $destDir -Force | Remove-Item -Recurse -Force
}

# Copy plugin contents, never the plugin folder itself, to avoid nested-folder deploys.
Copy-Item -Path (Join-Path $sourceDir "*") -Destination $destDir -Recurse -Force

# Clean up a mistakenly nested folder if it exists from an older deploy.
$nestedDir = Join-Path $destDir $PluginName
if (Test-Path -LiteralPath $nestedDir) {
  Remove-Item -LiteralPath $nestedDir -Recurse -Force
}

$result = [ordered]@{
  ok = $true
  plugin = $PluginName
  source = $sourceDir
  destination = $destDir
  cleaned = [bool]$Clean
}

$result | ConvertTo-Json -Depth 4
