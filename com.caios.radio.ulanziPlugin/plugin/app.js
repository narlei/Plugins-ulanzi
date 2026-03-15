const ACTION_CACHES = {};

$UD.connect("com.caios.ulanzideck.radio");
$UD.onConnected(() => {});

$UD.onAdd((jsn) => {
  const context = jsn.context;
  if (!ACTION_CACHES[context]) {
    ACTION_CACHES[context] = new RadioAction(context);
  }
  ACTION_CACHES[context].add(jsn);
});

$UD.onRun((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!instance) return;
  instance.run(jsn);
});

$UD.onClear((jsn) => {
  if (!jsn.param) return;
  for (let i = 0; i < jsn.param.length; i += 1) {
    const context = jsn.param[i].context;
    const instance = ACTION_CACHES[context];
    if (!instance) continue;
    if (typeof instance.clear === "function") instance.clear();
    delete ACTION_CACHES[context];
  }
});

function onSetSettings(jsn) {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!instance || !jsn.param) return;
  instance.updateSettings(jsn.param);
}

$UD.onParamFromApp(onSetSettings);
$UD.onParamFromPlugin(onSetSettings);
