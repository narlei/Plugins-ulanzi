import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
import fs from "fs";

import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.soundpad";
const $UD = new UlanzideckApi();
const __origEmit = $UD.emit.bind($UD);
$UD.emit = (eventName, payload) => {
  log("EVENT", eventName, payload || {});
  return __origEmit(eventName, payload);
};

const ACTIONS = new Map();
const SLOT_TO_FULL = new Map();
const HELD_CONTEXTS = new Set();
let bridgeLaunchAttempted = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_SCRIPT = path.resolve(__dirname, "../helper/bridge.ps1");
const LOG_FILE = path.resolve(__dirname, "../soundpad-main.log");

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_e) {}
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
    if (data) req.write(data);
    req.end();
  });
}

async function ensureBridgeOnline(baseUrl) {
  try {
    const res = await httpJson("GET", `${baseUrl}/health`);
    if (res.ok) return true;
  } catch (_e) {}

  if (!bridgeLaunchAttempted) {
    bridgeLaunchAttempted = true;
    try {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", BRIDGE_SCRIPT],
        { detached: true, windowsHide: true, stdio: "ignore" }
      );
      child.unref();
      log("spawned bridge", BRIDGE_SCRIPT);
    } catch (_e) {}
  }

  await delay(1200);
  try {
    const res = await httpJson("GET", `${baseUrl}/health`);
    return res.ok;
  } catch (_e) {
    log("bridge offline", baseUrl);
    return false;
  }
}

function getBase(settings) {
  return String(settings.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
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

function toBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function getStateFromData(data) {
  const context = data.context;
  const slotContext = getSlotContext(context);
  return {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
    ...(data.param || {}),
  };
}

function getActionType(data, state) {
  return String(data.uuid || state.uuid || state.actionUuid || state.actionid || data.actionid || "");
}

function getVisualContext(context) {
  const slotContext = getSlotContext(context);
  if (SLOT_TO_FULL.has(slotContext)) {
    return SLOT_TO_FULL.get(slotContext);
  }
  return context;
}

function updatePlayButtonVisual(context, state) {
  const actionType = String(state.uuid || state.actionUuid || "");
  if (!actionType.endsWith(".play")) return;
  const title = toBool(state.showSoundTitle) ? String(state.soundTitle || "") : "";
  const visualContext = getVisualContext(context);
  if (!hasActionInstance(visualContext)) return;
  try {
    $UD.setStateIcon(visualContext, 0, title);
  } catch (_e) {}
}

function mergeSettings(context, next) {
  const slotContext = getSlotContext(context);
  const curr = {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
  };
  const merged = { ...curr, ...next };
  ACTIONS.set(context, merged);
  if (hasActionInstance(context)) {
    SLOT_TO_FULL.set(slotContext, context);
  }
  if (slotContext && slotContext !== context) {
    ACTIONS.set(slotContext, merged);
  }
  updatePlayButtonVisual(context, merged);
  return merged;
}

function normalizeCategories(categories) {
  return (categories || []).map((c) => ({
    categoryName: c.Name,
    categoryIndex: c.Index,
  }));
}

function normalizeSounds(sounds) {
  return (sounds || []).map((s) => ({
    soundName: s.Title,
    soundIndex: s.Index,
  }));
}

async function refreshInspector(context, state) {
  log("refreshInspector:start", { context, actionid: state.actionid, categoryIndex: state.categoryIndex });
  const base = getBase(state);
  const online = await ensureBridgeOnline(base);
  if (!online) {
    log("refreshInspector:offline");
    return;
  }

  let categories = [];
  let sounds = [];

  const cat = await httpJson("GET", `${base}/categories`);
  log("refreshInspector:categories", { ok: cat.ok, status: cat.status, count: cat.data?.categories?.length || 0 });
  if (cat.ok && cat.data?.ok) {
    categories = normalizeCategories(cat.data.categories);
  }

  if (String(state.uuid || state.actionUuid || "").endsWith(".play") && state.categoryIndex !== "" && state.categoryIndex !== undefined) {
    const snd = await httpJson("GET", `${base}/sounds?categoryIndex=${encodeURIComponent(String(state.categoryIndex))}`);
    log("refreshInspector:sounds", { ok: snd.ok, status: snd.status, count: snd.data?.sounds?.length || 0, categoryIndex: state.categoryIndex });
    if (snd.ok && snd.data?.ok) {
      sounds = normalizeSounds(snd.data.sounds);
    }
  }

  const outgoing = { ...state, categories, sounds };
  delete outgoing.property_inspector;
  $UD.sendParamFromPlugin(outgoing, context);
}

async function handleRun(data) {
  const context = data.context;
  const state = getStateFromData(data);
  log("run:start", { context, actionid: data.actionid, state });
  const base = getBase(state);
  const online = await ensureBridgeOnline(base);
  if (!online) {
    log("run:offline");
    return;
  }

  const actionType = getActionType(data, state);

  if (actionType.endsWith(".play")) {
    if (toBool(state.pushToPlay)) {
      return;
    }
    const index = Number(state.soundIndex);
    if (!Number.isFinite(index)) {
      log("run:play invalid index", { soundIndex: state.soundIndex, soundTitle: state.soundTitle });
      return;
    }
    const r = await httpJson("POST", `${base}/play`, { index });
    log("run:play result", r);
    return;
  }
  if (actionType.endsWith(".playrandom")) {
    const categoryIndex = state.categoryIndex === "" ? null : Number(state.categoryIndex);
    await httpJson("POST", `${base}/play-random`, { categoryIndex });
    return;
  }
  if (actionType.endsWith(".pause")) {
    await httpJson("POST", `${base}/toggle-pause`, {});
    return;
  }
  if (actionType.endsWith(".stop")) {
    await httpJson("POST", `${base}/stop`, {});
    return;
  }
  if (actionType.endsWith(".remove")) {
    const index = Number(state.removeSoundIndex);
    if (!Number.isFinite(index)) return;
    await httpJson("POST", `${base}/remove`, { index });
    return;
  }
  if (actionType.endsWith(".recordptt")) {
    await httpJson("POST", `${base}/toggle-recording`, {});
    return;
  }
  if (actionType.endsWith(".loadsoundlist")) {
    const p = String(state.soundListFileName || "");
    if (!p) return;
    await httpJson("POST", `${base}/load-soundlist`, { path: p });
  }
}

async function handleKeyDown(data) {
  const context = data.context;
  const state = getStateFromData(data);
  const actionType = getActionType(data, state);
  const base = getBase(state);

  if (actionType.endsWith(".play") && toBool(state.pushToPlay)) {
    if (HELD_CONTEXTS.has(context)) return;
    const index = Number(state.soundIndex);
    if (!Number.isFinite(index)) {
      log("keydown:play invalid index", { soundIndex: state.soundIndex, soundTitle: state.soundTitle });
      return;
    }
    const online = await ensureBridgeOnline(base);
    if (!online) return;
    HELD_CONTEXTS.add(context);
    const r = await httpJson("POST", `${base}/play`, { index });
    log("keydown:play result", r);
    return;
  }

  if (actionType.endsWith(".recordptt")) {
    const online = await ensureBridgeOnline(base);
    if (!online) return;
    HELD_CONTEXTS.add(context);
    const r = await httpJson("POST", `${base}/record-start`, {});
    log("keydown:record result", r);
  }
}

async function handleKeyUp(data) {
  const context = data.context;
  const state = getStateFromData(data);
  const actionType = getActionType(data, state);
  const base = getBase(state);

  if (!HELD_CONTEXTS.has(context)) return;
  HELD_CONTEXTS.delete(context);

  if (actionType.endsWith(".play") && toBool(state.pushToPlay)) {
    const online = await ensureBridgeOnline(base);
    if (!online) return;
    const r = await httpJson("POST", `${base}/stop`, {});
    log("keyup:play stop result", r);
    return;
  }

  if (actionType.endsWith(".recordptt")) {
    const online = await ensureBridgeOnline(base);
    if (!online) return;
    const r = await httpJson("POST", `${base}/record-stop`, {});
    log("keyup:record stop result", r);
  }
}

$UD.connect(APP_ID);

$UD.onConnected(async () => {
  log("connected");
  await ensureBridgeOnline("http://127.0.0.1:18181");
});

$UD.onAdd(async (data) => {
  log("onAdd", data);
  mergeSettings(data.context, {
    ...(data.param || {}),
    actionid: data.actionid,
    actionUuid: data.uuid,
    uuid: data.uuid,
  });
});

$UD.onSetActive((data) => {
  mergeSettings(data.context, { active: data.active });
});

$UD.onRun((data) => {
  handleRun(data).catch(() => {});
});

$UD.on("keydown", (data) => {
  handleKeyDown(data).catch(() => {});
});

$UD.on("keyup", (data) => {
  handleKeyUp(data).catch(() => {});
});

$UD.onClear((data) => {
  (data.param || []).forEach((p) => {
    if (p?.context) {
      ACTIONS.delete(p.context);
      const slotContext = getSlotContext(p.context);
      ACTIONS.delete(slotContext);
      SLOT_TO_FULL.delete(slotContext);
      HELD_CONTEXTS.delete(p.context);
    }
  });
});

function onSettings(data) {
  log("onSettings", data);
  const merged = mergeSettings(data.context, data.param || {});
  if (merged.property_inspector === "refreshSounds") {
    refreshInspector(data.context, merged).catch(() => {});
  }
}

$UD.onParamFromApp(onSettings);
$UD.onParamFromPlugin(onSettings);
