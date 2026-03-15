let actionSetting = { reaction: "thumbsup" };
let currentContext = "";

$UD.connect("com.caios.ulanzideck.meetingcontrols.plugin");

function render() {
  document.getElementById("reaction").value = actionSetting.reaction || "thumbsup";
  document.getElementById("serverStatus").value = actionSetting.serverStatus || "offline";
  document.getElementById("serverPort").value = actionSetting.serverPort || "-";
}

function send() {
  if (!currentContext) return;
  actionSetting.reaction = document.getElementById("reaction").value;
  $UD.sendParamFromPlugin({ ...actionSetting }, currentContext);
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

  document.getElementById("reaction").addEventListener("change", send);
  render();
});

$UD.onAdd(merge);
$UD.onParamFromApp(merge);
$UD.onParamFromPlugin(merge);
