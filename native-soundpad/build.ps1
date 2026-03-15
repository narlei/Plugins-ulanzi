$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "bin"
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }

$dotnet = "C:\Program Files\dotnet\dotnet.exe"
& $dotnet publish "$root\UlanziSoundpadNative.csproj" -c Release -r win-x64 --self-contained false -o $outDir

Write-Host "Built native host at: $outDir"
