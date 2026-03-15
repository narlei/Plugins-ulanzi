param(
  [int]$Port = 18222
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dllDir = Join-Path $root "libs"

Add-Type -Path (Join-Path $dllDir "NAudio.Core.dll")
Add-Type -Path (Join-Path $dllDir "NAudio.Wasapi.dll")
Add-Type -Path (Join-Path $dllDir "NAudio.Midi.dll")

Add-Type -ReferencedAssemblies @(
  "netstandard",
  (Join-Path $dllDir "NAudio.Core.dll"),
  (Join-Path $dllDir "NAudio.Wasapi.dll"),
  (Join-Path $dllDir "NAudio.Midi.dll")
) -TypeDefinition @"
using System;
using System.Collections.Generic;
using NAudio.CoreAudioApi;
using NAudio.Midi;

public static class MeterBridge
{
    private static readonly MMDeviceEnumerator Enumerator = new MMDeviceEnumerator();
    private static readonly Dictionary<int, MidiIn> MidiInputs = new Dictionary<int, MidiIn>();
    private static readonly Dictionary<string, int> MidiValues = new Dictionary<string, int>();

    public static List<object> ListAudioDevices(bool capture)
    {
        var flow = capture ? DataFlow.Capture : DataFlow.Render;
        var devices = Enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
        var list = new List<object>();
        foreach (var d in devices)
        {
            list.Add(new { id = d.ID, name = d.FriendlyName });
        }
        return list;
    }

    public static double GetAudioLevel(string deviceIdOrName, bool capture)
    {
        MMDevice device = null;
        var flow = capture ? DataFlow.Capture : DataFlow.Render;

        if (String.IsNullOrWhiteSpace(deviceIdOrName))
        {
            device = Enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia);
        }
        else
        {
            try
            {
                device = Enumerator.GetDevice(deviceIdOrName);
            }
            catch
            {
                var devices = Enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active);
                foreach (var d in devices)
                {
                    if (String.Equals(d.FriendlyName, deviceIdOrName, StringComparison.OrdinalIgnoreCase))
                    {
                        device = d;
                        break;
                    }
                }
            }
        }

        if (device == null) return 0;
        return Math.Round(device.AudioMeterInformation.MasterPeakValue * 100.0, 1);
    }

    public static List<object> ListMidiDevices()
    {
        var list = new List<object>();
        for (int i = 0; i < MidiIn.NumberOfDevices; i++)
        {
            var info = MidiIn.DeviceInfo(i);
            list.Add(new { index = i, name = info.ProductName });
        }
        return list;
    }

    public static void EnsureMidiListener(int deviceIndex)
    {
        if (deviceIndex < 0 || deviceIndex >= MidiIn.NumberOfDevices)
            return;

        if (MidiInputs.ContainsKey(deviceIndex))
            return;

        var midiIn = new MidiIn(deviceIndex);
        midiIn.MessageReceived += (s, e) =>
        {
            var me = e.MidiEvent as ControlChangeEvent;
            if (me == null)
                return;

            int channel = me.Channel + 1;
            int cc = (int)me.Controller;
            int val = me.ControllerValue;
            string key = deviceIndex + "|" + channel + "|" + cc;
            lock (MidiValues)
            {
                MidiValues[key] = val;
            }
        };
        midiIn.ErrorReceived += (s, e) => { };
        midiIn.Start();
        MidiInputs[deviceIndex] = midiIn;
    }

    public static int GetMidiValue(int deviceIndex, int channel, int cc)
    {
        EnsureMidiListener(deviceIndex);
        string key = deviceIndex + "|" + channel + "|" + cc;
        lock (MidiValues)
        {
            if (MidiValues.ContainsKey(key))
                return MidiValues[key];
        }
        return 0;
    }

    public static void Cleanup()
    {
        foreach (var kvp in MidiInputs)
        {
            try { kvp.Value.Stop(); } catch { }
            try { kvp.Value.Dispose(); } catch { }
        }
        MidiInputs.Clear();
    }
}
"@

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse("127.0.0.1"), $Port)
$listener.Start()

function Read-JsonBody {
  param([string]$BodyText)
  if ([string]::IsNullOrWhiteSpace($BodyText)) { return @{} }
  return $BodyText | ConvertFrom-Json
}

function Get-JsonField {
  param($Obj, [string]$Name)
  if ($null -eq $Obj) { return $null }
  if ($Obj -is [System.Collections.IDictionary]) {
    return $Obj[$Name]
  }
  $prop = $Obj.PSObject.Properties[$Name]
  if ($null -ne $prop) { return $prop.Value }
  return $null
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
  $header = "HTTP/1.1 $status`r`nContent-Type: application/json; charset=utf-8`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n`r`n"
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

  if ($Method -eq "OPTIONS") {
    return @{ Code = 200; Data = @{ ok = $true } }
  }

  if ($Method -eq "GET" -and $path -eq "/health") {
    return @{ Code = 200; Data = @{ ok = $true } }
  }

  if ($Method -eq "GET" -and $path -eq "/audio/devices") {
    $mode = "$($query["mode"])"
    $capture = $mode -eq "record"
    $devices = [MeterBridge]::ListAudioDevices($capture)
    return @{ Code = 200; Data = @{ ok = $true; devices = $devices } }
  }

  if ($Method -eq "GET" -and $path -eq "/audio/level") {
    $mode = "$($query["mode"])"
    $capture = $mode -eq "record"
    $device = "$($query["device"])"
    $lvl = [MeterBridge]::GetAudioLevel($device, $capture)
    return @{ Code = 200; Data = @{ ok = $true; level = $lvl } }
  }

  if ($Method -eq "GET" -and $path -eq "/midi/devices") {
    $devices = [MeterBridge]::ListMidiDevices()
    return @{ Code = 200; Data = @{ ok = $true; devices = $devices } }
  }

  if ($Method -eq "GET" -and $path -eq "/midi/level") {
    $idx = 0
    $ch = 1
    $cc = 0
    [void][int]::TryParse("$($query["deviceIndex"])", [ref]$idx)
    [void][int]::TryParse("$($query["channel"])", [ref]$ch)
    [void][int]::TryParse("$($query["cc"])", [ref]$cc)
    $val = [MeterBridge]::GetMidiValue($idx, $ch, $cc)
    return @{ Code = 200; Data = @{ ok = $true; level = $val } }
  }

  $body = Read-JsonBody -BodyText $BodyText

  if ($Method -eq "POST" -and $path -eq "/midi/ensure") {
    $idx = [int](Get-JsonField -Obj $body -Name "deviceIndex")
    [MeterBridge]::EnsureMidiListener($idx)
    return @{ Code = 200; Data = @{ ok = $true } }
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
      $reader.Dispose(); $stream.Dispose(); $client.Dispose(); continue
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
      if ($readCount -gt 0) {
        $bodyText = -join $buffer[0..($readCount - 1)]
      }
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
  [MeterBridge]::Cleanup()
}
