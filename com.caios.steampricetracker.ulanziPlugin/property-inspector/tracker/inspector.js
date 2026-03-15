let actionSetting = {
  searchQuery: "",
  appId: "",
  appName: "",
  countryCode: "auto",
  hideCurrency: false,
  resolveStatus: ""
};

let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.steampricetracker.tracker");

function toBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

function render() {
  if (!form) return;
  document.getElementById("searchQuery").value = actionSetting.searchQuery || "";
  document.getElementById("countryCode").value = actionSetting.countryCode || "auto";
  document.getElementById("hideCurrency").checked = toBool(actionSetting.hideCurrency);
  document.getElementById("appName").value = actionSetting.appName || "";
  document.getElementById("appId").value = actionSetting.appId || "";
  document.getElementById("resolveStatus").value = actionSetting.resolveStatus || "";
}

function readForm() {
  return {
    searchQuery: document.getElementById("searchQuery").value.trim(),
    countryCode: document.getElementById("countryCode").value.trim() || "auto",
    hideCurrency: document.getElementById("hideCurrency").checked,
    appId: document.getElementById("appId").value.trim(),
    appName: document.getElementById("appName").value.trim(),
    resolveStatus: document.getElementById("resolveStatus").value
  };
}

function sendSettings(extra) {
  actionSetting = { ...actionSetting, ...readForm(), ...(extra || {}) };
  $UD.sendParamFromPlugin(actionSetting, currentContext || undefined);
}

function mergeSettings(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context) currentContext = jsonObj.context;
  if (!jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  if (!actionSetting.countryCode) {
    actionSetting.countryCode = "auto";
  }
  render();
}

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");

  form.addEventListener("input", Utils.debounce(() => {
    sendSettings();
  }, 250));

  document.getElementById("resolveBtn").addEventListener("click", () => {
    sendSettings({ resolveStatus: "Buscando...", property_inspector: "resolveApp" });
  });

  render();
});

$UD.onAdd((jsonObj) => {
  mergeSettings(jsonObj);
});

$UD.onParamFromApp((jsonObj) => {
  mergeSettings(jsonObj);
});
