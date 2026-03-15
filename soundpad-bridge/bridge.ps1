param(
  [int]$Port = 18181
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dllDir = Join-Path $root "libs"
[void][Reflection.Assembly]::LoadFrom((Join-Path $dllDir "SoundpadConnector.dll"))

$soundpad = New-Object SoundpadConnector.Soundpad
$null = $soundpad.ConnectAsync().GetAwaiter().GetResult()
$recording = $false

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()

Write-Host "[bridge] connected to Soundpad"
Write-Host "[bridge] listening on http://127.0.0.1:$Port/"

function Read-JsonBody {
  param([string]$BodyText)
  if ([string]::IsNullOrWhiteSpace($BodyText)) { return @{} }
  return $BodyText | ConvertFrom-Json -AsHashtable
}

function Build-Response {
  param([int]$StatusCode, $Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  $status = switch ($StatusCode) {
    200 { "200 OK" }
    400 { "400 Bad Request" }
    404 { "404 Not Found" }
    500 { "500 Internal Server Error" }
    default { "$StatusCode OK" }
  }
  $bodyBytes = [Text.Encoding]::UTF8.GetBytes($json)
  $header = "HTTP/1.1 $status`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  return @{ Header = $headerBytes; Body = $bodyBytes }
}

function Handle-Request {
  param([string]$Method, [string]$PathAndQuery, [string]$BodyText)

  $parts = $PathAndQuery.Split("?", 2)
  $path = $parts[0].ToLowerInvariant()
  $query = @{}
  if ($parts.Count -gt 1 -and $parts[1]) {
    foreach ($pair in $parts[1].Split("&")) {
      if (-not $pair) { continue }
      $kv = $pair.Split("=", 2)
      $k = [Uri]::UnescapeDataString($kv[0])
      $v = if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { "" }
      $query[$k] = $v
    }
  }

  if ($Method -eq "GET" -and $path -eq "/health") {
    return @{ Code = 200; Data = @{ ok = $true } }
  }

  if ($Method -eq "GET" -and $path -eq "/categories") {
    $res = $soundpad.GetCategories($true, $true).GetAwaiter().GetResult()
    if (-not $res.IsSuccessful) { return @{ Code = 500; Data = @{ ok = $false; error = $res.ErrorMessage } } }
    return @{ Code = 200; Data = @{ ok = $true; categories = $res.Value.Categories } }
  }

  if ($Method -eq "GET" -and $path -eq "/sounds") {
    $categoryRaw = $query["categoryIndex"]
    $category = 0
    if (-not [int]::TryParse("$categoryRaw", [ref]$category)) {
      return @{ Code = 400; Data = @{ ok = $false; error = "categoryIndex is required" } }
    }
    $res = $soundpad.GetCategory($category, $true, $true).GetAwaiter().GetResult()
    if (-not $res.IsSuccessful) { return @{ Code = 500; Data = @{ ok = $false; error = $res.ErrorMessage } } }
    return @{ Code = 200; Data = @{ ok = $true; sounds = $res.Value.Sounds } }
  }

  $body = Read-JsonBody -BodyText $BodyText

  if ($Method -eq "POST" -and $path -eq "/play") {
    $res = $soundpad.PlaySound([int]$body["index"]).GetAwaiter().GetResult()
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/play-random") {
    $categoryIndex = $body["categoryIndex"]
    if ($null -eq $categoryIndex -or [string]::IsNullOrWhiteSpace("$categoryIndex")) {
      $res = $soundpad.PlayRandomSound($false, $false).GetAwaiter().GetResult()
    }
    else {
      $res = $soundpad.PlayRandomSoundFromCategory([int]$categoryIndex, $false, $false).GetAwaiter().GetResult()
    }
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/toggle-pause") {
    $res = $soundpad.TogglePause().GetAwaiter().GetResult()
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/stop") {
    $res = $soundpad.StopSound().GetAwaiter().GetResult()
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/remove") {
    $index = [int]$body["index"]
    $null = $soundpad.SelectIndex($index).GetAwaiter().GetResult()
    $res = $soundpad.RemoveSelectedEntries($false).GetAwaiter().GetResult()
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/toggle-recording") {
    if ($recording) {
      $res = $soundpad.StopRecording().GetAwaiter().GetResult()
    }
    else {
      $res = $soundpad.StartRecordingMicrophone().GetAwaiter().GetResult()
    }
    if ($res.IsSuccessful) { $recording = -not $recording }
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; recording = $recording; error = $res.ErrorMessage } }
  }

  if ($Method -eq "POST" -and $path -eq "/load-soundlist") {
    $filePath = "$($body["path"])"
    if ([string]::IsNullOrWhiteSpace($filePath)) {
      return @{ Code = 400; Data = @{ ok = $false; error = "path is required" } }
    }
    $res = $soundpad.LoadSoundlist($filePath).GetAwaiter().GetResult()
    return @{ Code = $(if ($res.IsSuccessful) { 200 } else { 500 }); Data = @{ ok = $res.IsSuccessful; error = $res.ErrorMessage } }
  }

  return @{ Code = 404; Data = @{ ok = $false; error = "route not found" } }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)

    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      $reader.Dispose(); $stream.Dispose(); $client.Dispose()
      continue
    }

    $requestParts = $requestLine.Split(" ")
    $method = $requestParts[0].ToUpperInvariant()
    $pathAndQuery = $requestParts[1]
    $contentLength = 0

    while ($true) {
      $line = $reader.ReadLine()
      if ($line -eq $null -or $line -eq "") { break }
      if ($line.ToLowerInvariant().StartsWith("content-length:")) {
        [void][int]::TryParse($line.Substring(15).Trim(), [ref]$contentLength)
      }
    }

    $bodyText = ""
    if ($contentLength -gt 0) {
      $buffer = New-Object char[] $contentLength
      $readCount = 0
      while ($readCount -lt $contentLength) {
        $n = $reader.Read($buffer, $readCount, $contentLength - $readCount)
        if ($n -le 0) { break }
        $readCount += $n
      }
      $bodyText = -join $buffer[0..($readCount - 1)]
    }

    try {
      $handled = Handle-Request -Method $method -PathAndQuery $pathAndQuery -BodyText $bodyText
    }
    catch {
      $handled = @{ Code = 500; Data = @{ ok = $false; error = $_.Exception.Message } }
    }

    $resp = Build-Response -StatusCode $handled.Code -Payload $handled.Data
    $stream.Write($resp.Header, 0, $resp.Header.Length)
    $stream.Write($resp.Body, 0, $resp.Body.Length)

    $reader.Dispose()
    $stream.Dispose()
    $client.Dispose()
  }
}
finally {
  $listener.Stop()
  $soundpad.Disconnect()
}
