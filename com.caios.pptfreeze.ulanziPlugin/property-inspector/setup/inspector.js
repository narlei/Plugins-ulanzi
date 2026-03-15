let actionSetting = {
  monitorIndex: -1,
  labelWhenOff: "LIVE",
  labelWhenOn: "FREEZE",
  isFrozen: false,
  helperStatus: "unknown",
  resolvedMonitorIndex: "",
  monitorsText: "",
  lastError: "",
};

let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.pptfreeze.toggle");

function isFullContext(ctx) {
  const parts = String(ctx || "").split("___");
  return parts.length >= 3 && !!parts[2];
}

function render() {
  document.getElementById("monitorIndex").value = String(actionSetting.monitorIndex ?? -1);
  document.getElementById("labelWhenOff").value = actionSetting.labelWhenOff || "LIVE";
  document.getElementById("labelWhenOn").value = actionSetting.labelWhenOn || "FREEZE";
  document.getElementById("isFrozen").value = String(!!actionSetting.isFrozen);
  document.getElementById("helperStatus").value = actionSetting.helperStatus || "unknown";
  document.getElementById("resolvedMonitorIndex").value =
    actionSetting.resolvedMonitorIndex === "" || actionSetting.resolvedMonitorIndex == null
      ? "-"
      : String(actionSetting.resolvedMonitorIndex);
  document.getElementById("monitorsText").value = actionSetting.monitorsText || "";
  document.getElementById("lastError").value = actionSetting.lastError || "";
}

function readForm() {
  return {
    monitorIndex: Number(document.getElementById("monitorIndex").value || -1),
    labelWhenOff: document.getElementById("labelWhenOff").value.trim() || "LIVE",
    labelWhenOn: document.getElementById("labelWhenOn").value.trim() || "FREEZE",
  };
}

function sendSettings() {
  if (!currentContext) return;
  const payload = { ...actionSetting, ...readForm() };
  actionSetting = { ...payload };
  $UD.sendParamFromPlugin(payload, currentContext);
}

function mergeSettings(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context) {
    if (!currentContext || isFullContext(jsonObj.context)) {
      currentContext = jsonObj.context;
    }
  }
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

  render();
});

$UD.onAdd(mergeSettings);
$UD.onParamFromApp(mergeSettings);
$UD.onParamFromPlugin(mergeSettings);
