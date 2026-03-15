param(
  [ValidateSet("toggle", "freeze", "unfreeze", "status", "monitors")]
  [string]$Action = "toggle",
  [int]$MonitorIndex = -1,
  [switch]$OutputJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$stateDir = Join-Path $env:APPDATA "UlanziDeck\PptFreeze"
$statePath = Join-Path $stateDir "state.json"
$imagePath = Join-Path $stateDir "freeze.png"
$overlayScript = Join-Path $PSScriptRoot "Show-FreezeOverlay.ps1"
$powerShellExe = Join-Path $PSHOME "powershell.exe"

function Ensure-StateDir {
  if (-not (Test-Path -LiteralPath $stateDir)) {
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  }
}

function Read-State {
  if (-not (Test-Path -LiteralPath $statePath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-State([hashtable]$State) {
  Ensure-StateDir
  $State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Get-ResolvedScreen([int]$RequestedIndex) {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  if (-not $screens -or $screens.Count -lt 1) {
    throw "No displays detected."
  }

  if ($RequestedIndex -ge 0 -and $RequestedIndex -lt $screens.Count) {
    return @{
      Screen = $screens[$RequestedIndex]
      Index = $RequestedIndex
    }
  }

  for ($i = 0; $i -lt $screens.Count; $i++) {
    if (-not $screens[$i].Primary) {
      return @{
        Screen = $screens[$i]
        Index = $i
      }
    }
  }

  return @{
    Screen = $screens[0]
    Index = 0
  }
}

function Get-MonitorSummary {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $items = @()

  for ($i = 0; $i -lt $screens.Count; $i++) {
    $screen = $screens[$i]
    $bounds = $screen.Bounds
    $items += @{
      index = $i
      primary = [bool]$screen.Primary
      deviceName = [string]$screen.DeviceName
      width = [int]$bounds.Width
      height = [int]$bounds.Height
      x = [int]$bounds.X
      y = [int]$bounds.Y
      label = "Monitor $($i + 1): $($bounds.Width)x$($bounds.Height)" + $(if ($screen.Primary) { " [primary]" } else { "" })
    }
  }

  $resolved = Get-ResolvedScreen -RequestedIndex $MonitorIndex

  return @{
    ok = $true
    state = "monitors"
    isFrozen = $false
    monitorIndex = $MonitorIndex
    resolvedMonitorIndex = $resolved.Index
    monitors = $items
  }
}

function Capture-Screen([System.Windows.Forms.Screen]$Screen) {
  Ensure-StateDir
  $bounds = $Screen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($imagePath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-RunningProcess($State) {
  if (-not $State) {
    return $null
  }

  $pidValue = 0
  try {
    $pidValue = [int]$State.pid
  } catch {
    $pidValue = 0
  }

  if ($pidValue -le 0) {
    return $null
  }

  try {
    return Get-Process -Id $pidValue -ErrorAction Stop
  } catch {
    return $null
  }
}

function Stop-Freeze {
  $state = Read-State
  $process = Get-RunningProcess $state

  if ($state) {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }

  if ($process) {
    Start-Sleep -Milliseconds 400
    if (-not $process.HasExited) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
      } catch {}
    }
  }

  return @{
    ok = $true
    state = "live"
    isFrozen = $false
    monitorIndex = if ($state) { $state.monitorIndex } else { $MonitorIndex }
    resolvedMonitorIndex = if ($state) { $state.monitorIndex } else { $null }
  }
}

function Start-Freeze {
  $resolved = Get-ResolvedScreen -RequestedIndex $MonitorIndex
  Capture-Screen -Screen $resolved.Screen

  $sessionId = [guid]::NewGuid().ToString()
  $state = @{
    active = $true
    sessionId = $sessionId
    monitorIndex = $resolved.Index
    imagePath = $imagePath
    pid = 0
    createdAt = [DateTime]::UtcNow.ToString("o")
  }

  Write-State $state

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-STA",
    "-File", $overlayScript,
    "-StatePath", $statePath,
    "-SessionId", $sessionId
  )

  $process = Start-Process -FilePath $powerShellExe -ArgumentList $args -WindowStyle Hidden -PassThru
  $state.pid = $process.Id
  Write-State $state

  return @{
    ok = $true
    state = "frozen"
    isFrozen = $true
    monitorIndex = $MonitorIndex
    resolvedMonitorIndex = $resolved.Index
  }
}

function Get-Status {
  $state = Read-State
  $process = Get-RunningProcess $state

  if ($state -and $process -and (Test-Path -LiteralPath $state.imagePath)) {
    return @{
      ok = $true
      state = "frozen"
      isFrozen = $true
      monitorIndex = $MonitorIndex
      resolvedMonitorIndex = $state.monitorIndex
    }
  }

  return @{
    ok = $true
    state = "live"
    isFrozen = $false
    monitorIndex = $MonitorIndex
    resolvedMonitorIndex = $null
  }
}

try {
  $currentStatus = Get-Status

  switch ($Action) {
    "status" {
      $result = $currentStatus
    }
    "monitors" {
      $result = Get-MonitorSummary
    }
    "unfreeze" {
      $result = Stop-Freeze
    }
    "freeze" {
      if ($currentStatus.isFrozen) {
        $result = $currentStatus
      } else {
        $result = Start-Freeze
      }
    }
    default {
      if ($currentStatus.isFrozen) {
        $result = Stop-Freeze
      } else {
        $result = Start-Freeze
      }
    }
  }
} catch {
  $result = @{
    ok = $false
    state = "error"
    isFrozen = $false
    monitorIndex = $MonitorIndex
    resolvedMonitorIndex = $null
    error = $_.Exception.Message
  }
}

if ($OutputJson) {
  $result | ConvertTo-Json -Depth 5 -Compress
} else {
  $result
}
