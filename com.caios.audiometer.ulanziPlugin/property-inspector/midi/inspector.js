let actionSetting = {
  midiDeviceIndex: 0,
  midiChannel: 1,
  midiCCNumber: 0,
  maxThreshold: 127,
  lowColor: "#00ff00",
  midColor: "#ffff00",
  peakColor: "#ff0000",
  midLevel: 75,
  peakLevel: 85,
  showLevelAsText: false,
  backgroundColor: "#000000",
  visualStyle: "0",
  responseProfile: "fast"
};

let devices = [];
let form = null;
let currentContext = "";
let hasPendingSave = false;

$UD.connect("com.caios.ulanzideck.audiometer.midi");

function isFullContext(ctx) {
  const parts = String(ctx || "").split("___");
  return parts.length >= 3 && !!parts[2];
}

function toBool(v) {
  return v === true || v === "true" || v === "1" || v === 1;
}

async function fetchDevices() {
  try {
    const res = await fetch("http://127.0.0.1:18222/midi/devices");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const incoming = Array.isArray(data?.devices) ? data.devices : [];
    if (incoming.length) {
      devices = incoming;
    }
    render();
  } catch (_e) {
    render();
  }
}

function fillDevices() {
  const sourceDevices = Array.isArray(devices) && devices.length
    ? devices
    : (Array.isArray(actionSetting.midiDevices) ? actionSetting.midiDevices : []);
  const sel = document.getElementById("midiDeviceIndex");
  sel.innerHTML = "";
  sourceDevices.forEach((d) => {
    const op = document.createElement("option");
    op.value = String(d.index ?? 0);
    op.textContent = String(d.name || `Device ${d.index}`);
    sel.appendChild(op);
  });
  if (!devices.length) {
    const op = document.createElement("option");
    op.value = "0";
    op.textContent = "No MIDI device";
    sel.appendChild(op);
  }
  sel.value = String(actionSetting.midiDeviceIndex ?? 0);
}

function render() {
  fillDevices();
  document.getElementById("midiChannel").value = actionSetting.midiChannel ?? 1;
  document.getElementById("midiCCNumber").value = actionSetting.midiCCNumber ?? 0;
  document.getElementById("maxThreshold").value = actionSetting.maxThreshold ?? 127;
  document.getElementById("lowColor").value = actionSetting.lowColor || "#00ff00";
  document.getElementById("midColor").value = actionSetting.midColor || "#ffff00";
  document.getElementById("peakColor").value = actionSetting.peakColor || "#ff0000";
  document.getElementById("midLevel").value = actionSetting.midLevel ?? 75;
  document.getElementById("peakLevel").value = actionSetting.peakLevel ?? 85;
  document.getElementById("showLevelAsText").checked = toBool(actionSetting.showLevelAsText);
  document.getElementById("backgroundColor").value = actionSetting.backgroundColor || "#000000";
  document.getElementById("visualStyle").value = String(actionSetting.visualStyle || "0");
  document.getElementById("responseProfile").value = String(actionSetting.responseProfile || "fast");
}

function readForm() {
  return {
    midiDeviceIndex: document.getElementById("midiDeviceIndex").value,
    midiChannel: document.getElementById("midiChannel").value,
    midiCCNumber: document.getElementById("midiCCNumber").value,
    maxThreshold: document.getElementById("maxThreshold").value,
    lowColor: document.getElementById("lowColor").value,
    midColor: document.getElementById("midColor").value,
    peakColor: document.getElementById("peakColor").value,
    midLevel: document.getElementById("midLevel").value,
    peakLevel: document.getElementById("peakLevel").value,
    showLevelAsText: document.getElementById("showLevelAsText").checked,
    backgroundColor: document.getElementById("backgroundColor").value,
    visualStyle: document.getElementById("visualStyle").value,
    responseProfile: document.getElementById("responseProfile").value,
  };
}

function sendSettings(extra) {
  const payload = { ...actionSetting, ...readForm(), ...(extra || {}) };
  if (!extra || !extra.property_inspector) {
    delete payload.property_inspector;
  }
  actionSetting = { ...payload };
  const targetContext = isFullContext(currentContext) ? currentContext : undefined;
  if (!targetContext) {
    hasPendingSave = true;
  } else {
    hasPendingSave = false;
  }
  $UD.sendParamFromPlugin(payload, targetContext);
}

function mergeSettings(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context) {
    // Prefer full context, but keep short context as fallback so settings persist.
    if (isFullContext(jsonObj.context) || !currentContext) {
      currentContext = jsonObj.context;
    }
  }
  if (!jsonObj.param) return;
  const next = { ...jsonObj.param };
  delete next.property_inspector;
  actionSetting = { ...actionSetting, ...next };
  if (Array.isArray(next.midiDevices) && next.midiDevices.length) {
    devices = next.midiDevices;
  }
  render();
  if (isFullContext(currentContext) && hasPendingSave) {
    sendSettings();
  }
}

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");

  form.addEventListener("input", Utils.debounce(() => sendSettings(), 200));
  form.addEventListener("change", Utils.debounce(() => sendSettings(), 80));
  document.getElementById("refreshBtn").addEventListener("click", () => {
    fetchDevices().catch(() => {});
  });

  fetchDevices().catch(() => {});
});

$UD.onAdd((jsonObj) => {
  mergeSettings(jsonObj);
  fetchDevices().catch(() => {});
});
$UD.onParamFromApp(mergeSettings);
$UD.onParamFromPlugin(mergeSettings);
