const ACTION_CACHES = {};

$UD.connect("com.caios.ulanzideck.wsstarter");
$UD.onConnected(() => {});

function createInstance(actionid, context) {
  if (String(actionid || "").endsWith(".status")) {
    return new WSStatus(context);
  }
  return new WSAction(context);
}

$UD.onAdd((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!instance) {
    ACTION_CACHES[context] = createInstance(jsn.actionid, context);
  }
  ACTION_CACHES[context].add(jsn);
});

$UD.onSetActive((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (instance && typeof instance.setActive === "function") {
    instance.setActive(jsn.active);
  }
});

$UD.onRun((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!instance || typeof instance.run !== "function") return;
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

$UD.onParamFromApp((jsn) => onSetSettings(jsn));
$UD.onParamFromPlugin((jsn) => onSetSettings(jsn));

function onSetSettings(jsn, type) {
  const settings = jsn.param || {};
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (!instance || JSON.stringify(settings) === "{}") return;
  instance.updateSettings(settings, type);
}
