let actionSetting = {};
let currentContext = "";

$UD.connect("com.caios.ulanzideck.meetingcontrols.plugin");

function render() {
  document.getElementById("serverStatus").value = actionSetting.serverStatus || "offline";
  document.getElementById("serverPort").value = actionSetting.serverPort || "-";
  document.getElementById("isMeetingOpen").value = String(!!actionSetting.isMeetingOpen);
  document.getElementById("activeProfile").value = actionSetting.activeProfile || "";
}

function merge(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context && !currentContext) currentContext = jsonObj.context;
  if (jsonObj.context && currentContext && jsonObj.context !== currentContext) return;
  if (!jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  render();
}

$UD.onConnected(() => {
  document.querySelector(".udpi-wrapper").classList.remove("hidden");
  const contextFromUrl = Utils.getUrlParameter("context");
  if (contextFromUrl) currentContext = contextFromUrl;
  render();
});

$UD.onAdd(merge);
$UD.onParamFromApp(merge);
$UD.onParamFromPlugin(merge);
