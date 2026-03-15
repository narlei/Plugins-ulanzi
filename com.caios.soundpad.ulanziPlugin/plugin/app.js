const ACTION_CACHES = {};
let BRIDGE_LAUNCH_ATTEMPTED = false;

$UD.connect("com.caios.ulanzideck.soundpad");
$UD.onConnected(() => {});

function createInstance(actionid, context) {
  return new SoundpadAction(context, actionid);
}

$UD.onAdd((jsn) => {
  const context = jsn.context;
  if (!ACTION_CACHES[context]) {
    ACTION_CACHES[context] = createInstance(jsn.actionid, context);
  }
  ACTION_CACHES[context].add(jsn);
});

$UD.onSetActive((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (instance) instance.setActive(jsn.active);
});

$UD.onRun((jsn) => {
  const context = jsn.context;
  const instance = ACTION_CACHES[context];
  if (instance) instance.run(jsn);
});

$UD.onClear((jsn) => {
  if (!jsn.param) return;
  for (let i = 0; i < jsn.param.length; i += 1) {
    const context = jsn.param[i].context;
    const instance = ACTION_CACHES[context];
    if (!instance) continue;
    instance.clear();
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

  if (settings.property_inspector === "refreshSounds") {
    refreshInspectorData(context, instance).catch(() => {});
  }
}

async function ensureBridgeOnline(bridgeBase) {
  try {
    const health = await fetch(`${bridgeBase}/health`);
    if (health.ok) return true;
  } catch (_e) {}

  if (!BRIDGE_LAUNCH_ATTEMPTED) {
    BRIDGE_LAUNCH_ATTEMPTED = true;
    try {
      if (typeof $UD !== "undefined" && typeof $UD.openUrl === "function") {
        $UD.openUrl("../helper/start-bridge.cmd", true);
      }
    } catch (_e) {}
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  try {
    const health = await fetch(`${bridgeBase}/health`);
    return health.ok;
  } catch (_e) {
    return false;
  }
}

async function refreshInspectorData(context, instance) {
  const current = instance.settings || {};
  const bridgeBase = (current.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
  const online = await ensureBridgeOnline(bridgeBase);
  if (!online) return;

  let categories = [];
  let sounds = [];

  const catRes = await fetch(`${bridgeBase}/categories`);
  if (catRes.ok) {
    const catJson = await catRes.json();
    categories = (catJson.categories || []).map((c) => ({
      categoryName: c.Name,
      categoryIndex: c.Index,
    }));
  }

  const actionId = String(instance.actionId || "");
  const categoryIndex = current.categoryIndex;
  if (actionId.endsWith(".play") && categoryIndex !== "" && categoryIndex !== undefined && categoryIndex !== null) {
    const sndRes = await fetch(
      `${bridgeBase}/sounds?categoryIndex=${encodeURIComponent(String(categoryIndex))}`
    );
    if (sndRes.ok) {
      const sndJson = await sndRes.json();
      sounds = (sndJson.sounds || []).map((s) => ({
        soundName: s.Title,
        soundIndex: s.Index,
      }));
    }
  }

  const payload = {
    ...current,
    categories,
    sounds,
  };
  delete payload.property_inspector;
  $UD.sendParamFromPlugin(payload, context);
}

if (typeof window !== "undefined") {
  window.ensureSoundpadBridge = ensureBridgeOnline;
}
