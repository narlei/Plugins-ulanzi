let actionSetting = {
  actionId: "",
  argsJson: "{}",
  wsUrl: "ws://localhost:8059"
};
let form = null;

$UD.connect("com.caios.ulanzideck.wsstarter.action");

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  const wrapper = document.querySelector(".udpi-wrapper");
  wrapper.classList.remove("hidden");

  form.addEventListener(
    "input",
    Utils.debounce(() => {
      actionSetting = Utils.getFormValue(form);
      $UD.sendParamFromPlugin(actionSetting);
    }, 250)
  );
});

$UD.onAdd((jsonObj) => {
  if (!jsonObj || !jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  Utils.setFormValue(actionSetting, form);
});

$UD.onParamFromApp((jsonObj) => {
  if (!jsonObj || !jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  Utils.setFormValue(actionSetting, form);
});
