let actionSetting = {
  monitor: "CPU_PERCENT",
  pollingRateMs: 500,
  libreUrl: "",
  libreKey: "",
  useDynamicColor: true,
  lineColor: "#1ed760",
  fillColor: "#1ed760",
  bgColor: "#101622",
};

let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.systemvitals.plugin");

function isFullContext(ctx) {
  const parts = String(ctx || "").split("___");
  return parts.length >= 3 && !!parts[2];
}

function toNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function render() {
  document.getElementById("monitor").value = actionSetting.monitor || "CPU_PERCENT";
  document.getElementById("pollingRateMs").value = 500;
  document.getElementById("libreUrl").value = String(actionSetting.libreUrl || "");
  document.getElementById("libreKey").value = String(actionSetting.libreKey || "");
  document.getElementById("useDynamicColor").checked = actionSetting.useDynamicColor !== false && actionSetting.useDynamicColor !== "false";
  document.getElementById("lineColor").value = actionSetting.lineColor || "#1ed760";
  document.getElementById("fillColor").value = actionSetting.fillColor || "#1ed760";
  document.getElementById("bgColor").value = actionSetting.bgColor || "#101622";
}

function readForm() {
  return {
    monitor: document.getElementById("monitor").value,
    pollingRateMs: 500,
    libreUrl: document.getElementById("libreUrl").value.trim(),
    libreKey: document.getElementById("libreKey").value.trim(),
    useDynamicColor: document.getElementById("useDynamicColor").checked,
    lineColor: document.getElementById("lineColor").value,
    fillColor: document.getElementById("fillColor").value,
    bgColor: document.getElementById("bgColor").value,
  };
}

function sendSettings(extra) {
  if (!currentContext) return;
  const payload = { ...actionSetting, ...readForm(), ...(extra || {}) };
  actionSetting = { ...payload };
  $UD.sendParamFromPlugin(payload, currentContext);
}

function mergeSettings(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context) {
    if (!currentContext) {
      currentContext = jsonObj.context;
    } else if (jsonObj.context === currentContext && isFullContext(jsonObj.context)) {
      currentContext = jsonObj.context;
    }
  }
  if (jsonObj.context && currentContext && jsonObj.context !== currentContext) return;
  if (!jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  render();
}

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");
  const contextFromUrl = Utils.getUrlParameter("context");
  if (contextFromUrl) currentContext = contextFromUrl;

  form.addEventListener("input", Utils.debounce(() => sendSettings(), 180));
  form.addEventListener("change", Utils.debounce(() => sendSettings(), 80));

  document.getElementById("refreshNowBtn").addEventListener("click", () => {
    document.getElementById("statusLine").value = "Refresh requested";
    sendSettings({ nextPollAt: 0 });
  });

  render();
});

$UD.onAdd((jsonObj) => {
  mergeSettings(jsonObj);
});
$UD.onParamFromApp(mergeSettings);
$UD.onParamFromPlugin(mergeSettings);

