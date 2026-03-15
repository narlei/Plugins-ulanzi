function getBridge() {
  if (typeof $UD !== "undefined" && typeof $UD.sendParamFromPlugin === "function") {
    return {
      save: (payload) => $UD.sendParamFromPlugin(payload),
    };
  }

  return {
    save: (payload) => console.log("[inspector/action] mock save", payload),
  };
}

const bridge = getBridge();
let context = "demo-context";
let settings = {
  actionId: "",
  argsJson: "{}",
  wsUrl: "ws://localhost:8059",
};

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function loadUI() {
  document.getElementById("actionId").value = settings.actionId || "";
  document.getElementById("argsJson").value = settings.argsJson || "{}";
  document.getElementById("wsUrl").value = settings.wsUrl || "ws://localhost:8059";
}

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

function hydrateFrom(raw) {
  if (!raw || typeof raw !== "object") return;
  const payload = raw.payload || raw;

  if (raw.context) context = raw.context;
  if (payload.context) context = payload.context;

  const incomingSettings =
    payload.settings ||
    payload.pluginSettings ||
    (payload.payload && payload.payload.settings) ||
    null;

  if (incomingSettings && typeof incomingSettings === "object") {
    settings = { ...settings, ...incomingSettings };
    loadUI();
  }
}

function save() {
  settings = {
    actionId: document.getElementById("actionId").value.trim(),
    argsJson: document.getElementById("argsJson").value.trim(),
    wsUrl: document.getElementById("wsUrl").value.trim(),
  };

  bridge.save({ context, settings });
  setStatus("Saved.");
}

document.getElementById("saveBtn").addEventListener("click", save);

const query = new URLSearchParams(window.location.search);
const queryContext = query.get("context");
if (queryContext) context = queryContext;
const querySettings = query.get("settings");
if (querySettings) {
  const parsed = safeParseJson(decodeURIComponent(querySettings), null);
  if (parsed) settings = { ...settings, ...parsed };
}

window.addEventListener("message", (event) => {
  const data = typeof event.data === "string" ? safeParseJson(event.data, null) : event.data;
  hydrateFrom(data);
});

if (typeof $UD !== "undefined" && typeof $UD.on === "function") {
  $UD.on("didReceiveSettings", (data) => hydrateFrom(data));
  $UD.on("sendToPropertyInspector", (data) => hydrateFrom(data));
}

loadUI();
