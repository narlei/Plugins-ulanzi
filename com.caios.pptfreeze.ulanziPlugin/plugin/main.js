import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.pptfreeze";
const ACTION_UUID = `${APP_ID}.toggle`;
const POWERSHELL = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const $UD = new UlanzideckApi();

const ACTIONS = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT_DIR, "pptfreeze.log");
const SCRIPT_PATH = path.join(ROOT_DIR, "helper", "Toggle-Freeze.ps1");

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_error) {}
}

function defaultSettings() {
  return {
    monitorIndex: -1,
    labelWhenOff: "LIVE",
    labelWhenOn: "FREEZE",
  };
}

function isFullContext(context) {
  const parts = String(context || "").split("___");
  return parts.length >= 3 && Boolean(parts[2]);
}

function mergeSettings(context, next) {
  const current = ACTIONS.get(context) || defaultSettings();
  const merged = { ...current, ...(next || {}) };
  ACTIONS.set(context, merged);
  return merged;
}

function getAction(context) {
  return ACTIONS.get(context) || defaultSettings();
}

function setVisualState(context, isFrozen) {
  const action = getAction(context);
  const title = isFrozen ? action.labelWhenOn || "FREEZE" : action.labelWhenOff || "LIVE";
  try {
    $UD.setStateIcon(context, isFrozen ? 1 : 0, title);
  } catch (_error) {}
}

function sendInspectorState(context, extra = {}) {
  const action = getAction(context);
  $UD.sendParamFromPlugin(
    {
      ...action,
      ...extra,
    },
    context
  );
}

async function loadMonitorSummary(context) {
  const result = await runFreezeCommand("monitors", context, 5000);
  if (!result.ok) {
    return {
      monitorsText: "",
      monitors: [],
      resolvedMonitorIndex: getAction(context).resolvedMonitorIndex,
    };
  }

  const monitors = Array.isArray(result.monitors) ? result.monitors : [];
  const monitorsText = monitors
    .map((monitor) => {
      const idx = Number(monitor.index ?? 0) + 1;
      const name = String(monitor.deviceName || "").trim();
      const primary = monitor.primary ? " primary" : "";
      return `${idx}. ${monitor.width}x${monitor.height}${primary}${name ? ` (${name})` : ""}`;
    })
    .join("\n");

  return {
    monitors,
    monitorsText,
    resolvedMonitorIndex:
      typeof result.resolvedMonitorIndex === "number"
        ? result.resolvedMonitorIndex
        : getAction(context).resolvedMonitorIndex,
  };
}

function runFreezeCommand(command, context, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const action = getAction(context);
    const monitorIndex = Number(action.monitorIndex ?? -1);
    log("helper call", { command, context, monitorIndex });

    execFile(
      POWERSHELL,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SCRIPT_PATH,
        "-Action",
        command,
        "-MonitorIndex",
        String(monitorIndex),
        "-OutputJson",
      ],
      { windowsHide: true, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          log("helper error", { command, context, stderr: String(stderr || ""), message: String(error.message || error) });
          resolve({
            ok: false,
            command,
            state: "error",
            isFrozen: false,
            error: String(stderr || error.message || error),
          });
          return;
        }

        const raw = String(stdout || "").trim();
        try {
          const parsed = JSON.parse(raw || "{}");
          log("helper response", { command, context, parsed });
          resolve({
            ok: parsed.ok !== false,
            command,
            state: parsed.state || "unknown",
            isFrozen: !!parsed.isFrozen,
            monitorIndex: parsed.monitorIndex,
            resolvedMonitorIndex: parsed.resolvedMonitorIndex,
            monitors: parsed.monitors,
            error: parsed.error || "",
          });
        } catch (parseError) {
          log("helper parse error", { command, context, raw });
          resolve({
            ok: false,
            command,
            state: "error",
            isFrozen: false,
            error: `Invalid helper response: ${raw || parseError.message}`,
          });
        }
      }
    );
  });
}

async function refreshStatus(context) {
  const [result, monitorInfo] = await Promise.all([
    runFreezeCommand("status", context, 5000),
    loadMonitorSummary(context),
  ]);
  const isFrozen = result.ok && result.state === "frozen";
  const merged = mergeSettings(context, {
    isFrozen,
    helperStatus: result.state || "unknown",
    lastError: result.error || "",
    resolvedMonitorIndex:
      typeof result.resolvedMonitorIndex === "number"
        ? result.resolvedMonitorIndex
        : monitorInfo.resolvedMonitorIndex,
    monitors: monitorInfo.monitors,
    monitorsText: monitorInfo.monitorsText,
  });

  setVisualState(context, merged.isFrozen);
  sendInspectorState(context, {
    isFrozen: merged.isFrozen,
    helperStatus: merged.helperStatus,
    lastError: merged.lastError,
    resolvedMonitorIndex: merged.resolvedMonitorIndex,
    monitors: merged.monitors,
    monitorsText: merged.monitorsText,
  });
}

async function toggleFreeze(context) {
  const action = getAction(context);
  const result = await runFreezeCommand("toggle", context);
  const isFrozen = result.ok && result.state === "frozen";
  const merged = mergeSettings(context, {
    isFrozen,
    helperStatus: result.state || "unknown",
    lastError: result.error || "",
    resolvedMonitorIndex:
      typeof result.resolvedMonitorIndex === "number"
        ? result.resolvedMonitorIndex
        : action.resolvedMonitorIndex,
  });

  const monitorInfo = await loadMonitorSummary(context);
  merged.monitors = monitorInfo.monitors;
  merged.monitorsText = monitorInfo.monitorsText;
  if (typeof monitorInfo.resolvedMonitorIndex === "number") {
    merged.resolvedMonitorIndex = monitorInfo.resolvedMonitorIndex;
  }

  setVisualState(context, merged.isFrozen);
  sendInspectorState(context, {
    isFrozen: merged.isFrozen,
    helperStatus: merged.helperStatus,
    lastError: merged.lastError,
    resolvedMonitorIndex: merged.resolvedMonitorIndex,
    monitors: merged.monitors,
    monitorsText: merged.monitorsText,
  });

  if (!result.ok && result.error) {
    try {
      $UD.toast(`PPT Freeze error: ${result.error}`);
    } catch (_error) {}
  }
}

$UD.connect(APP_ID);

$UD.onConnected(() => {
  log("connected");
});

$UD.onAdd((data) => {
  if (data.uuid !== ACTION_UUID) return;
  const merged = mergeSettings(data.context, {
    ...defaultSettings(),
    ...(data.param || {}),
  });
  setVisualState(data.context, !!merged.isFrozen);
  sendInspectorState(data.context, merged);
  refreshStatus(data.context).catch((error) => log("refresh-status add error", String(error?.message || error)));
});

$UD.onParamFromApp((data) => {
  if (!data?.context) return;
  const context = data.context;
  if (!ACTIONS.has(context) && !isFullContext(context)) return;

  const merged = mergeSettings(context, data.param || {});
  setVisualState(context, !!merged.isFrozen);
  sendInspectorState(context, merged);
  refreshStatus(context).catch((error) => log("refresh-status inspector error", String(error?.message || error)));
});

$UD.onRun((data) => {
  if (!data?.context) return;
  toggleFreeze(data.context).catch((error) => {
    log("toggle error", String(error?.message || error));
    try {
      $UD.toast(`PPT Freeze error: ${String(error?.message || error)}`);
    } catch (_toastError) {}
  });
});
