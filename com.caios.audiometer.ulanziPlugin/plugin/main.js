import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import http from "http";

import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.audiometer";
const AUDIO_ACTION = `${APP_ID}.audio`;
const MIDI_ACTION = `${APP_ID}.midi`;

const $UD = new UlanzideckApi();
const ACTIONS = new Map();
const SLOT_TO_FULL = new Map();
const DISPLAY_STATE = new Map();
let lastBridgeLaunchAt = 0;
let bridgeLaunching = false;
let lastBridgeOkAt = 0;
let inspectorPauseUntil = 0;
let bridgeProcess = null;

const POLL_INTERVAL_MS = 300;
const MIN_RENDER_DELTA = 0.25;
const FORCE_RENDER_MS = 220;
const HTTP_TIMEOUT_MS = 3500;
const BRIDGE_SPAWN_COOLDOWN_MS = 8000;
const BRIDGE_RECENT_OK_MS = 10000;
const INSPECTOR_PAUSE_MS = 5000;
let pollInFlight = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_SCRIPT = path.resolve(__dirname, "../helper/bridge.ps1");
const BRIDGE_OUT_LOG = path.resolve(__dirname, "../helper/bridge-out.log");
const BRIDGE_ERR_LOG = path.resolve(__dirname, "../helper/bridge-err.log");
const LOG_FILE = path.resolve(__dirname, "../audiometer-main.log");
const POWERSHELL_CANDIDATES = [
  "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  "powershell.exe",
];

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_e) {}
}

function appendLog(file, text) {
  try {
    fs.appendFileSync(file, text, "utf8");
  } catch (_e) {}
}

function spawnBridge() {
  const psExe = POWERSHELL_CANDIDATES.find((p) => (p.includes(":\\") ? fs.existsSync(p) : true)) || "powershell.exe";
  const child = spawn(
    psExe,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_SCRIPT],
    { detached: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  bridgeProcess = child;
  log("spawned bridge", { script: BRIDGE_SCRIPT, psExe, pid: child.pid });

  child.stdout?.on("data", (buf) => appendLog(BRIDGE_OUT_LOG, String(buf)));
  child.stderr?.on("data", (buf) => appendLog(BRIDGE_ERR_LOG, String(buf)));
  child.on("exit", (code, signal) => {
    log("bridge exited", { code, signal, pid: child.pid });
    if (bridgeProcess && bridgeProcess.pid === child.pid) {
      bridgeProcess = null;
      lastBridgeOkAt = 0;
    }
  });
  child.on("error", (err) => {
    log("bridge process error", String(err?.message || err));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(method, url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = payload ? JSON.stringify(payload) : "";
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString("utf8");
        });
        res.on("end", () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout"));
    });
    if (data) req.write(data);
    req.end();
  });
}

async function ensureBridgeOnline(baseUrl) {
  const now = Date.now();
  if (now - lastBridgeOkAt < BRIDGE_RECENT_OK_MS) {
    return true;
  }

  try {
    const res = await httpJson("GET", `${baseUrl}/health`);
    if (res.ok) {
      lastBridgeOkAt = Date.now();
      return true;
    }
  } catch (_e) {}

  if (!bridgeLaunching && now - lastBridgeLaunchAt > BRIDGE_SPAWN_COOLDOWN_MS) {
    lastBridgeLaunchAt = now;
    bridgeLaunching = true;
    try {
      if (!bridgeProcess || bridgeProcess.killed) {
        spawnBridge();
      }
    } catch (e) {
      log("spawn bridge error", String(e?.message || e));
    } finally {
      bridgeLaunching = false;
    }
  }

  await delay(900);
  try {
    const res = await httpJson("GET", `${baseUrl}/health`);
    if (res.ok) {
      lastBridgeOkAt = Date.now();
      return true;
    }
    return false;
  } catch (_e) {
    return false;
  }
}

function getSlotContext(context) {
  const raw = String(context || "");
  const parts = raw.split("___");
  if (parts.length >= 2) {
    return `${parts[0]}___${parts[1]}___`;
  }
  return raw;
}

function hasActionInstance(context) {
  const parts = String(context || "").split("___");
  return parts.length >= 3 && Boolean(parts[2]);
}

function getVisualContext(context) {
  const slotContext = getSlotContext(context);
  return SLOT_TO_FULL.get(slotContext) || context;
}

function mergeSettings(context, next) {
  const slotContext = getSlotContext(context);
  const curr = {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
  };
  const merged = { ...curr, ...next };
  ACTIONS.set(context, merged);
  const fullContext = hasActionInstance(context) ? context : SLOT_TO_FULL.get(slotContext);
  if (hasActionInstance(context)) {
    SLOT_TO_FULL.set(slotContext, context);
  }
  if (slotContext && slotContext !== context) {
    ACTIONS.set(slotContext, merged);
  }
  if (fullContext && fullContext !== context) {
    ACTIONS.set(fullContext, merged);
  }
  return merged;
}

function getState(data) {
  const context = data.context;
  const slotContext = getSlotContext(context);
  return {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
    ...(data.param || {}),
  };
}

function toNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function colorForLevel(level, s) {
  const mid = toNum(s.midLevel, 75);
  const peak = toNum(s.peakLevel, 85);
  if (level >= peak) return String(s.peakColor || "#ff0000");
  if (level >= mid) return String(s.midColor || "#ffff00");
  return String(s.lowColor || "#00ff00");
}

function makeMeterSvg(level, s, label) {
  const bg = String(s.backgroundColor || "#000000");
  const meterColor = colorForLevel(level, s);
  const style = String(s.visualStyle || "0");
  const h = Math.round(clamp(level, 0, 100) * 1.2);
  const y = 130 - h;
  const safeLabel = String(label || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let meterRect = `<rect x="22" y="${y}" width="100" height="${h}" rx="7" fill="${meterColor}"/>`;
  if (style === "2" || style === "3") {
    const c1 = style === "2" ? meterColor : bg;
    const c2 = style === "2" ? bg : meterColor;
    meterRect = `<rect x="22" y="${y}" width="100" height="${h}" rx="7" fill="url(#g)"/>
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>`;
  }

  return `<svg width="144" height="144" viewBox="0 0 144 144" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="144" height="144" fill="${bg}"/>
<rect x="20" y="8" width="104" height="124" rx="8" fill="#1e1e1e"/>
${meterRect}
<text x="72" y="140" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#ffffff">${safeLabel}</text>
</svg>`;
}

function pushIcon(context, level, state) {
  const clamped = clamp(level, 0, 100);
  const showText = state.showLevelAsText === true || state.showLevelAsText === "true";
  const label = showText ? `${Math.round(clamped)}%` : "";
  const svg = makeMeterSvg(clamped, state, label);
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  $UD.setBaseDataIcon(context, b64, "");
}

function getResponseProfile(state) {
  const profile = String(state?.responseProfile || "fast").toLowerCase();
  if (profile === "smooth") {
    return { attack: 13, release: 6 };
  }
  if (profile === "ultra") {
    return { attack: 38, release: 15 };
  }
  return { attack: 22, release: 9 };
}

function nextDisplayLevel(context, targetLevel, state) {
  const now = Date.now();
  const target = clamp(toNum(targetLevel, 0), 0, 100);
  const prev = DISPLAY_STATE.get(context) || { level: 0, updatedAt: now, drawnAt: 0 };
  const dtMs = Math.max(1, now - prev.updatedAt);
  const profile = getResponseProfile(state);
  const rate = target >= prev.level ? profile.attack : profile.release;
  const alpha = 1 - Math.exp((-rate * dtMs) / 1000);
  const next = prev.level + (target - prev.level) * alpha;

  const changed = Math.abs(next - prev.level);
  const forceDraw = now - prev.drawnAt >= FORCE_RENDER_MS;
  const shouldDraw = changed >= MIN_RENDER_DELTA || forceDraw;

  const updated = {
    level: next,
    updatedAt: now,
    drawnAt: shouldDraw ? now : prev.drawnAt,
  };
  DISPLAY_STATE.set(context, updated);
  return shouldDraw ? next : null;
}

async function refreshInspector(context, state) {
  const base = "http://127.0.0.1:18222";
  inspectorPauseUntil = Date.now() + INSPECTOR_PAUSE_MS;
  const online = await ensureBridgeOnline(base);
  if (!online) {
    log("refreshInspector:bridge_offline", { context });
    return;
  }

  if ((state.uuid || state.actionUuid) === AUDIO_ACTION) {
    const mode = String(state.mode || "playback") === "record" ? "record" : "playback";
    const res = await httpJson("GET", `${base}/audio/devices?mode=${encodeURIComponent(mode)}`);
    const devices = res.ok && res.data?.ok ? (res.data.devices || []) : [];
    log("refreshInspector:audio", { context, mode, ok: res.ok, count: devices.length });
    const outgoing = { ...state, audioDevices: devices };
    delete outgoing.property_inspector;
    $UD.sendParamFromPlugin(outgoing, context);
    const slotContext = getSlotContext(context);
    if (slotContext && slotContext !== context) {
      $UD.sendParamFromPlugin(outgoing, slotContext);
    }
    return;
  }

  if ((state.uuid || state.actionUuid) === MIDI_ACTION) {
    const res = await httpJson("GET", `${base}/midi/devices`);
    const devices = res.ok && res.data?.ok ? (res.data.devices || []) : [];
    log("refreshInspector:midi", { context, ok: res.ok, count: devices.length });
    const outgoing = { ...state, midiDevices: devices };
    delete outgoing.property_inspector;
    $UD.sendParamFromPlugin(outgoing, context);
    const slotContext = getSlotContext(context);
    if (slotContext && slotContext !== context) {
      $UD.sendParamFromPlugin(outgoing, slotContext);
    }
  }
}

async function pollLevels() {
  if (Date.now() < inspectorPauseUntil) return;
  let hasAnyAction = false;
  for (const [context] of ACTIONS.entries()) {
    if (hasActionInstance(context)) {
      hasAnyAction = true;
      break;
    }
  }
  if (!hasAnyAction) return;

  const base = "http://127.0.0.1:18222";
  const online = await ensureBridgeOnline(base);
  if (!online) return;

  const tasks = [];
  for (const [context, state] of ACTIONS.entries()) {
    if (!hasActionInstance(context)) continue;
    const action = String(state.uuid || state.actionUuid || "");

    if (action === AUDIO_ACTION) {
      tasks.push(
        (async () => {
          const mode = String(state.mode || "playback") === "record" ? "record" : "playback";
          const dev = encodeURIComponent(String(state.audioDevice || ""));
          const levelRes = await httpJson("GET", `${base}/audio/level?mode=${mode}&device=${dev}`);
          if (levelRes.ok && levelRes.data?.ok) {
            lastBridgeOkAt = Date.now();
            const lvl = toNum(levelRes.data.level, 0);
            const next = nextDisplayLevel(context, lvl, state);
            if (next !== null) pushIcon(context, next, state);
          }
        })()
      );
    } else if (action === MIDI_ACTION) {
      tasks.push(
        (async () => {
          const idx = toNum(state.midiDeviceIndex, 0);
          const ch = clamp(toNum(state.midiChannel, 1), 1, 16);
          const cc = clamp(toNum(state.midiCCNumber, 0), 0, 127);
          await httpJson("POST", `${base}/midi/ensure`, { deviceIndex: idx });
          const levelRes = await httpJson("GET", `${base}/midi/level?deviceIndex=${idx}&channel=${ch}&cc=${cc}`);
          if (levelRes.ok && levelRes.data?.ok) {
            lastBridgeOkAt = Date.now();
            const raw = clamp(toNum(levelRes.data.level, 0), 0, 127);
            const threshold = Math.max(1, toNum(state.maxThreshold, 127));
            const pct = clamp((raw / threshold) * 100, 0, 100);
            const next = nextDisplayLevel(context, pct, state);
            if (next !== null) pushIcon(context, next, state);
          }
        })()
      );
    }
  }
  await Promise.allSettled(tasks);
}

$UD.connect(APP_ID);

$UD.onConnected(async () => {
  log("connected");
  await ensureBridgeOnline("http://127.0.0.1:18222");
  setInterval(async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await pollLevels();
    } catch (e) {
      log("poll error", String(e?.message || e));
    } finally {
      pollInFlight = false;
    }
  }, POLL_INTERVAL_MS);
});

$UD.onAdd((data) => {
  const seed = { ...(data.param || {}) };
  delete seed.property_inspector;
  mergeSettings(data.context, {
    mode: "playback",
    maxThreshold: 100,
    lowColor: "#00ff00",
    midColor: "#ffff00",
    peakColor: "#ff0000",
    midLevel: 75,
    peakLevel: 85,
    backgroundColor: "#000000",
    visualStyle: "0",
    responseProfile: "fast",
    showLevelAsText: false,
    midiChannel: 1,
    midiCCNumber: 0,
    midiDeviceIndex: 0,
    ...seed,
    actionid: data.actionid,
    actionUuid: data.uuid,
    uuid: data.uuid,
  });
});

$UD.onRun((data) => {
  const state = getState(data);
  const context = data.context;
  if ((state.uuid || state.actionUuid) === AUDIO_ACTION) {
    const next = !(state.showLevelAsText === true || state.showLevelAsText === "true");
    mergeSettings(context, { showLevelAsText: next });
    $UD.sendParamFromPlugin({ ...state, showLevelAsText: next }, context);
  }
});

$UD.onClear((data) => {
  (data.param || []).forEach((p) => {
    if (!p?.context) return;
    ACTIONS.delete(p.context);
    const slotContext = getSlotContext(p.context);
    ACTIONS.delete(slotContext);
    SLOT_TO_FULL.delete(slotContext);
    DISPLAY_STATE.delete(p.context);
    DISPLAY_STATE.delete(slotContext);
  });
});

function onSettings(data) {
  const cmd = data?.param?.property_inspector;
  const cleaned = { ...(data.param || {}) };
  delete cleaned.property_inspector;
  const prev = getState(data);
  // Guard against inspector refresh races that occasionally send empty device ids.
  if (data?.cmd === "paramfromplugin" && cleaned.audioDevice === "" && prev.audioDevice) {
    delete cleaned.audioDevice;
  }
  const merged = mergeSettings(data.context, cleaned);
  log("onSettings", { context: data.context, property_inspector: cmd });
  if (cmd === "refreshDevices") {
    refreshInspector(data.context, merged).catch(() => {});
  }
}

$UD.onParamFromApp(onSettings);
$UD.onParamFromPlugin(onSettings);
