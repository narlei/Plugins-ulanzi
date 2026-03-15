import { execFile } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.systemvitals";
const ACTION_UUID = `${APP_ID}.plugin`;
const $UD = new UlanzideckApi();
const FIXED_POLL_MS = 1000;

const ACTIONS = new Map();
const SLOT_TO_FULL = new Map();
const HISTORY = new Map();
const RECENT_ADD = new Map();
const RECENT_SETTINGS = new Map();

const MONITORS = {
  SIM_PERCENT: { label: "SIM", unit: "%", min: 0, max: 100, decimals: 0 },
  RANDOM_PERCENT: { label: "RAND", unit: "%", min: 0, max: 100, decimals: 0 },
  CPU_PERCENT: { label: "CPU", unit: "%", min: 0, max: 100, decimals: 0 },
  RAM_PERCENT: { label: "RAM", unit: "%", min: 0, max: 100, decimals: 0 },
  GPU_PERCENT: { label: "GPU", unit: "%", min: 0, max: 100, decimals: 0 },
  VRAM_PERCENT_NVIDIA: { label: "VRAM", unit: "%", min: 0, max: 100, decimals: 0 },
  BATTERY_PERCENT: { label: "BATT", unit: "%", min: 0, max: 100, decimals: 0 },
  RAM_GB: { label: "RAM", unit: "GB", min: 0, max: 64, decimals: 1 },
  GPU_WATT_NVIDIA: { label: "GPU", unit: "W", min: 0, max: 400, decimals: 0 },
  GPU_TEMP_NVIDIA: { label: "GPU", unit: "°C", min: 0, max: 120, decimals: 0 },
  CPU_TEMP_LHW: { label: "CPU", unit: "°C", min: 0, max: 120, decimals: 0 },
  GPU_TEMP_LHW: { label: "GPU", unit: "°C", min: 0, max: 120, decimals: 0 },
  AIO_TEMP_LHW: { label: "AIO", unit: "°C", min: 0, max: 90, decimals: 0 },
  CPU_WATT_LHW: { label: "CPU", unit: "W", min: 0, max: 300, decimals: 0 },
  WIFI_PERCENT: { label: "WIFI", unit: "%", min: 0, max: 100, decimals: 0 },
  HDD_C_PERCENT: { label: "SSD C", unit: "%", min: 0, max: 100, decimals: 0 },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.resolve(__dirname, "../systemvitals.log");
const POWERSHELL = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

let nvidiaCache = { at: 0, gpu: null, vram: null, watt: null, temp: null };
let libreCache = { at: 0, key: "", sensors: [] };
let libreBackoffUntil = 0;
let cpuPrevSample = null;
let cpuLastPercent = 0;
const METRIC_CACHE = new Map();
let pollInFlight = false;

function isDuplicateEvent(store, key, signature, windowMs) {
  const now = Date.now();
  const prev = store.get(key);
  if (prev && prev.signature === signature && now - prev.at <= windowMs) {
    return true;
  }
  store.set(key, { signature, at: now });
  return false;
}

function stableTopLevel(obj) {
  const src = obj && typeof obj === "object" ? obj : {};
  return Object.keys(src)
    .sort()
    .reduce((acc, k) => {
      acc[k] = src[k];
      return acc;
    }, {});
}

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_e) {}
}

log("boot");

function run(command, args, timeoutMs = 2200) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve("");
      resolve(String(stdout || "").trim());
    });
  });
}

function runPowerShell(script, timeoutMs = 2200) {
  return run(POWERSHELL, ["-NoProfile", "-Command", script], timeoutMs);
}

function httpGetText(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += String(c || "");
        });
        res.on("end", () => {
          resolve(res.statusCode >= 200 && res.statusCode < 300 ? raw : "");
        });
      });
      req.setTimeout(timeoutMs, () => req.destroy());
      req.on("error", () => resolve(""));
    } catch (_e) {
      resolve("");
    }
  });
}

function getSlotContext(context) {
  const parts = String(context || "").split("___");
  if (parts.length >= 2) return `${parts[0]}___${parts[1]}___`;
  return String(context || "");
}

function hasActionInstance(context) {
  const parts = String(context || "").split("___");
  return parts.length >= 3 && Boolean(parts[2]);
}

function getVisualContext(context) {
  return String(context || "");
}

function mergeSettings(context, next) {
  const slot = getSlotContext(context);
  const curr = { ...(ACTIONS.get(context) || {}), ...(ACTIONS.get(slot) || {}) };
  const merged = { ...curr, ...next };
  ACTIONS.set(context, merged);
  if (!hasActionInstance(context) && slot && slot !== context) {
    ACTIONS.set(slot, merged);
  }
  return merged;
}

function pushHistory(context, value) {
  const prev = HISTORY.get(context) || [];
  const val = clamp(toNum(value, 0), 0, 100);
  const next = [...prev, val];
  if (next.length > 30) next.shift();
  HISTORY.set(context, next);
  return next;
}

function toNum(v, d) {
  const raw = String(v ?? "").trim();
  const normalized = raw
    .replace("%", "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toBool(v, d = false) {
  if (v === true || v === false) return v;
  if (v == null) return d;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return d;
}

async function readCpuPercent() {
  const cpus = os.cpus();
  if (!Array.isArray(cpus) || cpus.length === 0) return null;

  let total = 0;
  let idle = 0;
  for (const c of cpus) {
    const t = c?.times || {};
    const cpuTotal = (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0);
    total += cpuTotal;
    idle += t.idle || 0;
  }

  if (!cpuPrevSample) {
    cpuPrevSample = { total, idle };
    return cpuLastPercent;
  }

  const dtTotal = total - cpuPrevSample.total;
  const dtIdle = idle - cpuPrevSample.idle;
  cpuPrevSample = { total, idle };
  if (dtTotal <= 0) return cpuLastPercent;

  const usage = ((dtTotal - dtIdle) / dtTotal) * 100;
  cpuLastPercent = clamp(usage, 0, 100);
  return cpuLastPercent;
}

async function readRamPercent() {
  const total = os.totalmem();
  const free = os.freemem();
  if (!total || total <= 0) return null;
  const usedPct = ((total - free) / total) * 100;
  return clamp(usedPct, 0, 100);
}

async function readNvidia() {
  const now = Date.now();
  if (now - nvidiaCache.at < 2000) return nvidiaCache;

  const out = await run(
    "nvidia-smi",
    ["--query-gpu=utilization.gpu,memory.used,memory.total,power.draw,temperature.gpu", "--format=csv,noheader,nounits"],
    1800
  );
  if (!out) {
    nvidiaCache = { at: now, gpu: null, vram: null, watt: null, temp: null };
    return nvidiaCache;
  }

  const first = out.split(/\r?\n/).find(Boolean) || "";
  const parts = first.split(",").map((p) => p.trim());
  const gpu = toNum(parts[0], NaN);
  const used = toNum(parts[1], NaN);
  const total = toNum(parts[2], NaN);
  const watt = toNum(parts[3], NaN);
  const temp = toNum(parts[4], NaN);
  const vram = Number.isFinite(used) && Number.isFinite(total) && total > 0 ? (used / total) * 100 : NaN;

  nvidiaCache = {
    at: now,
    gpu: Number.isFinite(gpu) ? clamp(gpu, 0, 100) : null,
  vram: Number.isFinite(vram) ? clamp(vram, 0, 100) : null,
    watt: Number.isFinite(watt) ? clamp(watt, 0, 999) : null,
    temp: Number.isFinite(temp) ? clamp(temp, 0, 150) : null,
  };
  return nvidiaCache;
}

function parseNumber(value) {
  const s = String(value ?? "").replace(",", ".");
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return NaN;
  return Number(m[0]);
}

function flattenLibreTree(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const name = String(node.Text || node.Name || "").trim();
  const type = String(node.SensorType || node.Type || "").trim();
  const id = String(node.id || node.Identifier || "").trim();
  const valueRaw = node.Value != null ? node.Value : node.value;
  if (name || type || id || valueRaw != null) {
    out.push({
      Name: name,
      SensorType: type,
      Identifier: id,
      Value: parseNumber(valueRaw),
      ValueRaw: valueRaw,
    });
  }
  const children = Array.isArray(node.Children) ? node.Children : [];
  for (const c of children) flattenLibreTree(c, out);
  return out;
}

async function readLibreSensorsFromWeb(baseUrl) {
  const u = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!u) return null;
  const urls = [`${u}/data.json`, u];
  for (const url of urls) {
    const out = await httpGetText(url, 1200);
    if (!out) continue;
    try {
      const js = JSON.parse(out);
      const sensors = flattenLibreTree(js, []);
      if (sensors.length) return sensors;
    } catch (_e) {}
  }
  return null;
}

async function readLibreSensorsFromWmi() {
  const script =
    "$ErrorActionPreference='SilentlyContinue'; " +
    "$namespaces=@('root\\LibreHardwareMonitor','root\\OpenHardwareMonitor'); " +
    "$all=@(); " +
    "foreach($ns in $namespaces){ " +
    "  $x = Get-CimInstance -Namespace $ns -ClassName Sensor | Select-Object Name,SensorType,Value,Identifier; " +
    "  if($x){ $all += $x } " +
    "} " +
    "if(-not $all){ " +
    "  foreach($ns in $namespaces){ " +
    "    $x = Get-WmiObject -Namespace $ns -Class Sensor | Select-Object Name,SensorType,Value,Identifier; " +
    "    if($x){ $all += $x } " +
    "  } " +
    "} " +
    "if($all){$all|ConvertTo-Json -Compress}else{'[]'}";

  const out = await runPowerShell(script, 2600);
  if (!out) return [];
  try {
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((s) => ({
        Name: String(s?.Name || ""),
        SensorType: String(s?.SensorType || ""),
        Identifier: String(s?.Identifier || ""),
        Value: toNum(s?.Value, NaN),
        ValueRaw: s?.Value,
      }))
      .filter((s) => Number.isFinite(s.Value));
  } catch (_e) {
    return [];
  }
}

async function readLibreSensors(state) {
  const now = Date.now();
  const preferred = String(state?.libreUrl || "").trim();
  const cacheKey = preferred.toLowerCase();
  if (now < libreBackoffUntil && libreCache.key === cacheKey) return libreCache.sensors;
  if (now - libreCache.at < 5000 && libreCache.key === cacheKey) return libreCache.sensors;

  const candidates = preferred
    ? [preferred]
    : ["http://127.0.0.1:8085", "http://localhost:8085", "http://127.0.0.1:8086", "http://localhost:8086"];

  for (const c of candidates) {
    const sensors = await readLibreSensorsFromWeb(c);
    if (Array.isArray(sensors) && sensors.length > 0) {
      libreCache = { at: now, key: cacheKey, sensors };
      return sensors;
    }
  }

  const sensors = await readLibreSensorsFromWmi();
  libreCache = { at: now, key: cacheKey, sensors };
  if (!Array.isArray(sensors) || sensors.length === 0) {
    libreBackoffUntil = now + 15000;
  } else {
    libreBackoffUntil = 0;
  }
  return sensors;
}

function pickLibreSensorValue(sensors, sensorType, patterns) {
  const needleType = String(sensorType || "").toLowerCase();
  const pats = (patterns || []).map((p) => String(p).toLowerCase());
  for (const s of sensors || []) {
    const type = String(s?.SensorType || "").toLowerCase();
    if (type !== needleType) continue;
    const name = String(s?.Name || "").toLowerCase();
    const id = String(s?.Identifier || "").toLowerCase();
    const hay = `${name} ${id}`;
    if (pats.length > 0 && !pats.some((p) => hay.includes(p))) continue;
    const val = toNum(s?.Value, NaN);
    if (Number.isFinite(val)) return val;
  }
  return null;
}

async function readBatteryPercent() {
  const out = await runPowerShell("(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining)");
  const val = toNum(out, NaN);
  return Number.isFinite(val) ? clamp(val, 0, 100) : null;
}

async function readWifiPercent() {
  const out = await runPowerShell("(netsh wlan show interfaces | Select-String 'Signal').Line");
  const match = String(out || "").match(/(\d+)\s*%/);
  const val = match ? toNum(match[1], NaN) : NaN;
  return Number.isFinite(val) ? clamp(val, 0, 100) : null;
}

async function readDrivePercent(letter = "C") {
  const dl = String(letter || "C").replace(/[^A-Za-z]/g, "").toUpperCase() || "C";
  const out = await runPowerShell(
    `$d=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${dl}:'"; if($d -and $d.Size -gt 0){ ((($d.Size-$d.FreeSpace)/$d.Size)*100) }`
  );
  const val = toNum(out, NaN);
  return Number.isFinite(val) ? clamp(val, 0, 100) : null;
}

async function readMetricValue(monitor, state) {
  switch (monitor) {
    case "SIM_PERCENT":
      return 35;
    case "RANDOM_PERCENT":
      return Math.random() * 100;
    case "CPU_PERCENT":
      return await readCpuPercent();
    case "RAM_PERCENT":
      return await readRamPercent();
    case "GPU_PERCENT": {
      const nv = await readNvidia();
      return nv.gpu;
    }
    case "VRAM_PERCENT_NVIDIA": {
      const nv = await readNvidia();
      return nv.vram;
    }
    case "BATTERY_PERCENT":
      return await readBatteryPercent();
    case "RAM_GB": {
      const total = os.totalmem();
      const free = os.freemem();
      if (!total || total <= 0) return null;
      const usedGb = (total - free) / (1024 * 1024 * 1024);
      return clamp(usedGb, 0, 4096);
    }
    case "GPU_WATT_NVIDIA": {
      const nv = await readNvidia();
      return nv.watt;
    }
    case "GPU_TEMP_NVIDIA": {
      const nv = await readNvidia();
      return nv.temp;
    }
    case "CPU_TEMP_LHW": {
      const sensors = await readLibreSensors(state);
      const custom = String(state?.libreKey || "").trim().toLowerCase();
      const patterns = custom ? [custom] : ["cpu package", "package", "tctl", "tdie", "core max", "ccd", "cpu"];
      return pickLibreSensorValue(sensors, "Temperature", patterns);
    }
    case "GPU_TEMP_LHW": {
      const sensors = await readLibreSensors(state);
      return pickLibreSensorValue(sensors, "Temperature", ["gpu", "hot spot", "edge"]);
    }
    case "AIO_TEMP_LHW": {
      const sensors = await readLibreSensors(state);
      return pickLibreSensorValue(sensors, "Temperature", ["liquid", "aio", "coolant", "water"]);
    }
    case "CPU_WATT_LHW": {
      const sensors = await readLibreSensors(state);
      const custom = String(state?.libreKey || "").trim().toLowerCase();
      const patterns = custom ? [custom] : ["cpu package", "package", "cpu total", "package power", "ppt", "cpu"];
      return pickLibreSensorValue(sensors, "Power", patterns);
    }
    case "WIFI_PERCENT":
      return await readWifiPercent();
    case "HDD_C_PERCENT":
      return await readDrivePercent("C");
    default:
      if (/^HDD_[A-Z]_PERCENT$/.test(String(monitor || ""))) {
        return await readDrivePercent(String(monitor).split("_")[1]);
      }
      return null;
  }
}

function metricCacheKey(monitor, state) {
  const url = String(state?.libreUrl || "").trim().toLowerCase();
  const key = String(state?.libreKey || "").trim().toLowerCase();
  return `${monitor}|${url}|${key}`;
}

async function readMetricValueCached(monitor, state, ttlMs = 800) {
  const now = Date.now();
  const cacheKey = metricCacheKey(monitor, state);
  const prev = METRIC_CACHE.get(cacheKey);
  if (prev && now - prev.at < ttlMs) {
    return prev.value;
  }
  const value = await readMetricValue(monitor, state);
  METRIC_CACHE.set(cacheKey, { at: now, value });
  return value;
}

function normalizeMonitorInfo(monitor) {
  if (MONITORS[monitor]) return MONITORS[monitor];
  if (/^HDD_[A-Z]_PERCENT$/.test(String(monitor || ""))) {
    const letter = String(monitor).split("_")[1];
    return { label: `SSD ${letter}`, unit: "%", min: 0, max: 100, decimals: 0 };
  }
  return { label: "VITAL", unit: "", min: 0, max: 100, decimals: 0 };
}

function colorFor(level) {
  if (level >= 85) return "#ff4d4f";
  if (level >= 65) return "#f5c542";
  return "#1ed760";
}

function makeSparkPoints(values) {
  if (!values.length) return [];
  const x0 = 12;
  const y0 = 104;
  const w = 120;
  const h = 38;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = x0 + i * step;
    const y = y0 - (clamp(v, 0, 100) / 100) * h;
    return [x, y];
  });
}

function makeSmoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const cx = ((px + x) / 2).toFixed(1);
    const cy = ((py + y) / 2).toFixed(1);
    d += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${cx} ${cy}`;
  }
  const [lx, ly] = points[points.length - 1];
  d += ` T ${lx.toFixed(1)} ${ly.toFixed(1)}`;
  return d;
}

function makeAreaPath(points, baselineY) {
  if (!points.length) return "";
  const line = makeSmoothPath(points);
  const [fx] = points[0];
  const [lx] = points[points.length - 1];
  return `${line} L ${lx.toFixed(1)} ${baselineY} L ${fx.toFixed(1)} ${baselineY} Z`;
}

function makeSvg(label, unit, displayValue, displayDecimals, unavailable, historyValues, levelPct, state) {
  const pct = clamp(Math.round(toNum(levelPct, 0)), 0, 100);
  const dynamic = toBool(state?.useDynamicColor, true);
  const accent = dynamic ? colorFor(pct) : String(state?.lineColor || "#1ed760");
  const fill = dynamic ? accent : String(state?.fillColor || accent);
  const panel = String(state?.bgColor || "#101622");
  const shown = Number(toNum(displayValue, 0)).toFixed(Math.max(0, toNum(displayDecimals, 0)));
  const text = unavailable ? "N/A" : `${shown}${unit || ""}`;
  const points = makeSparkPoints(historyValues || []);
  const spark = makeSmoothPath(points);
  const area = makeAreaPath(points, 104);

  return `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"144\" height=\"144\" viewBox=\"0 0 144 144\">
<defs>
  <linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">
    <stop offset=\"0%\" stop-color=\"${fill}\" stop-opacity=\"0.45\"/>
    <stop offset=\"100%\" stop-color=\"${fill}\" stop-opacity=\"0.08\"/>
  </linearGradient>
</defs>
<rect width=\"144\" height=\"144\" rx=\"16\" fill=\"#0b0f17\"/>
<rect x=\"6\" y=\"6\" width=\"132\" height=\"132\" rx=\"14\" fill=\"${panel}\" stroke=\"#1c2434\" stroke-width=\"2\"/>
<text x=\"72\" y=\"32\" text-anchor=\"middle\" fill=\"#e7edf8\" font-family=\"Arial\" font-size=\"16\" font-weight=\"700\">${label}</text>
<text x=\"72\" y=\"62\" text-anchor=\"middle\" fill=\"#ffffff\" font-family=\"Arial\" font-size=\"34\" font-weight=\"800\">${text}</text>
<line x1=\"12\" y1=\"104\" x2=\"132\" y2=\"104\" stroke=\"#233047\" stroke-width=\"2\"/>
<path d=\"${area}\" fill=\"url(#g)\"/>
<path d=\"${spark}\" fill=\"none\" stroke=\"${accent}\" stroke-width=\"3\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>
</svg>`;
}

function renderState(context, monitor, value) {
  const info = normalizeMonitorInfo(monitor);
  const unavailable = value == null || !Number.isFinite(value);
  const min = toNum(info.min, 0);
  let max = Math.max(min + 1, toNum(info.max, 100));
  if (monitor === "RAM_GB") {
    const totalGb = os.totalmem() / (1024 * 1024 * 1024);
    max = Math.max(min + 1, Math.ceil(toNum(totalGb, max)));
  }
  const raw = unavailable ? min : toNum(value, min);
  const visualValue = clamp(raw, min, max);
  const pct = ((visualValue - min) / (max - min)) * 100;
  const history = pushHistory(context, pct);
  const state = ACTIONS.get(context) || {};
  const svg = makeSvg(info.label, info.unit, visualValue, info.decimals, unavailable, history, pct, state);
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  $UD.setBaseDataIcon(context, b64, "");
}

async function tickAction(context, state) {
  const monitor = String(state.monitor || "CPU_PERCENT");
  const pollMs = FIXED_POLL_MS;
  const now = Date.now();
  const nextAt = toNum(state.nextPollAt, 0);
  if (now < nextAt) return;

  // Reuse a shared metric snapshot so multiple buttons show coherent values.
  const ttlMs = Math.min(Math.max(Math.floor(pollMs * 0.75), 500), 1200);
  const value = await readMetricValueCached(monitor, state, ttlMs);
  const visual = getVisualContext(context);
  if (hasActionInstance(visual)) renderState(visual, monitor, value);
  const lastDebugAt = toNum(state.lastDebugAt, 0);
  if (now - lastDebugAt > 30000) {
    log("metric", { context, monitor, value });
  }
  mergeSettings(context, { nextPollAt: now + pollMs, lastDebugAt: now });
}

async function pollAll() {
  const jobs = [];
  for (const [ctx, state] of ACTIONS.entries()) {
    if (!hasActionInstance(ctx)) continue;
    jobs.push(tickAction(ctx, state));
  }
  await Promise.allSettled(jobs);
}

$UD.connect(APP_ID);

$UD.onConnected(() => {
  log("connected");
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await pollAll();
    } catch (e) {
      log("poll error", String(e?.message || e));
    } finally {
      pollInFlight = false;
    }
  }, 1000);
});

$UD.onAdd((data) => {
  const addSignature = JSON.stringify({
    uuid: String(data?.uuid || ""),
    context: String(data?.context || ""),
    param: stableTopLevel(data?.param || {}),
  });
  if (isDuplicateEvent(RECENT_ADD, String(data?.context || ""), addSignature, 1200)) {
    return;
  }

  log("add", { context: data.context, uuid: data.uuid });
  const merged = mergeSettings(data.context, {
    monitor: "CPU_PERCENT",
    pollingRateMs: FIXED_POLL_MS,
    useDynamicColor: true,
    lineColor: "#1ed760",
    fillColor: "#1ed760",
    bgColor: "#101622",
    libreUrl: "",
    libreKey: "",
    ...(data.param || {}),
    nextPollAt: 0,
    actionid: data.actionid,
    actionUuid: data.uuid,
    uuid: data.uuid,
  });

  if (String(data.uuid || "") === ACTION_UUID) {
    tickAction(data.context, merged).catch((e) => log("tick-on-add error", String(e?.message || e)));
  }
});

$UD.onRun((data) => {
  const curr = ACTIONS.get(data.context) || {};
  mergeSettings(data.context, { ...(curr || {}), pollingRateMs: FIXED_POLL_MS, nextPollAt: 0 });
});

$UD.onClear((data) => {
  (data.param || []).forEach((p) => {
    if (!p?.context) return;
    ACTIONS.delete(p.context);
    const slot = getSlotContext(p.context);
    ACTIONS.delete(slot);
    SLOT_TO_FULL.delete(slot);
    RECENT_ADD.delete(p.context);
    RECENT_SETTINGS.delete(p.context);
    HISTORY.delete(p.context);
  });
});

function onSettings(data) {
  const settingsSignature = JSON.stringify({
    context: String(data?.context || ""),
    param: stableTopLevel(data?.param || {}),
  });
  if (isDuplicateEvent(RECENT_SETTINGS, String(data?.context || ""), settingsSignature, 250)) {
    return;
  }

  const prev = ACTIONS.get(data.context) || {};
  const next = data.param || {};
  const monitorChanged = next.monitor && next.monitor !== prev.monitor;
  const merged = mergeSettings(data.context, {
    ...next,
    pollingRateMs: FIXED_POLL_MS,
    nextPollAt: 0,
  });
  if (monitorChanged) {
    log("settings", { context: data.context, monitorChanged: true, monitor: next.monitor });
  }
  if (monitorChanged) {
    HISTORY.delete(data.context);
    const slot = getSlotContext(data.context);
    HISTORY.delete(slot);
  }
  tickAction(data.context, merged).catch((e) => log("tick-on-settings error", String(e?.message || e)));
}

$UD.onParamFromApp(onSettings);
$UD.onParamFromPlugin(onSettings);
