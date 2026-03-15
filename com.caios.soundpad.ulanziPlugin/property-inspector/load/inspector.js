let setting = {
  bridgeUrl: "http://127.0.0.1:18181",
  soundListFileName: ""
};
let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.soundpad.loadsoundlist");

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");

  form.addEventListener(
    "input",
    Utils.debounce(() => {
      setting = { ...setting, ...Utils.getFormValue(form) };
      $UD.sendParamFromPlugin(setting, currentContext || undefined);
    }, 250)
  );
});

function mergeSettings(jsonObj) {
  if (!jsonObj || !jsonObj.param) return;
  if (jsonObj.context) {
    currentContext = jsonObj.context;
  }
  setting = { ...setting, ...jsonObj.param };
  Utils.setFormValue(setting, form);
}

$UD.onAdd(mergeSettings);
$UD.onParamFromApp(mergeSettings);
