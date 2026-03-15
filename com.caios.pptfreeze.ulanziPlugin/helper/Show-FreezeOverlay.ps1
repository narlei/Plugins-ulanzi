param(
  [Parameter(Mandatory = $true)]
  [string]$StatePath,
  [Parameter(Mandatory = $true)]
  [string]$SessionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Read-State {
  if (-not (Test-Path -LiteralPath $StatePath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

$state = Read-State
if (-not $state) {
  exit 1
}

if ([string]$state.sessionId -ne $SessionId) {
  exit 1
}

if (-not (Test-Path -LiteralPath $state.imagePath)) {
  exit 1
}

$screens = [System.Windows.Forms.Screen]::AllScreens
$targetIndex = [int]$state.monitorIndex
if ($targetIndex -lt 0 -or $targetIndex -ge $screens.Count) {
  $targetIndex = 0
}

$targetScreen = $screens[$targetIndex]
$image = [System.Drawing.Image]::FromFile($state.imagePath)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = $targetScreen.Bounds
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::Black
$form.KeyPreview = $true
$form.Text = "PPT Freeze Overlay"

$picture = New-Object System.Windows.Forms.PictureBox
$picture.Dock = [System.Windows.Forms.DockStyle]::Fill
$picture.BackColor = [System.Drawing.Color]::Black
$picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::StretchImage
$picture.Image = $image
$form.Controls.Add($picture)

$timer.Add_Tick({
  $current = Read-State
  if (-not $current -or -not $current.active -or [string]$current.sessionId -ne $SessionId) {
    $form.Close()
  }
})

$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
  if ($picture.Image) {
    $picture.Image.Dispose()
  }
  $picture.Dispose()
  $form.Dispose()
})

$form.Add_Shown({
  $timer.Start()
  $form.Activate()
})

[void][System.Windows.Forms.Application]::Run($form)
