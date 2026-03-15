let actionSetting = {
  bridgeUrl: "http://127.0.0.1:18181",
  categoryIndex: ""
};
let categories = [];
let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.soundpad.playrandom");

function render() {
  const el = document.getElementById("categoryIndex");
  el.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = "(Any category)";
  el.appendChild(any);

  (categories || []).forEach((c) => {
    const op = document.createElement("option");
    op.value = String(c.categoryIndex);
    op.textContent = String(c.categoryName);
    el.appendChild(op);
  });
  el.value = String(actionSetting.categoryIndex || "");
}

function sendSettings(extra) {
  actionSetting.bridgeUrl = actionSetting.bridgeUrl || "http://127.0.0.1:18181";
  actionSetting.categoryIndex = document.getElementById("categoryIndex").value;
  $UD.sendParamFromPlugin({ ...actionSetting, ...(extra || {}) }, currentContext || undefined);
}

async function requestRefresh() {
  const base = String(actionSetting.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/categories`);
    if (!res.ok) throw new Error("categories failed");
    const data = await res.json();
    categories = (data.categories || []).map((c) => ({
      categoryName: c.Name,
      categoryIndex: c.Index,
    }));
    render();
    sendSettings();
  } catch (_e) {
    $UD.sendParamFromPlugin({ ...actionSetting, property_inspector: "refreshSounds" });
  }
}

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");
  form.addEventListener("input", Utils.debounce(() => sendSettings(), 200));
  document.getElementById("refreshBtn").addEventListener("click", () => requestRefresh().catch(() => {}));
  requestRefresh().catch(() => {});
});

function mergeSettings(jsonObj) {
  if (!jsonObj || !jsonObj.param) return;
  if (jsonObj.context) {
    currentContext = jsonObj.context;
  }
  actionSetting = { ...actionSetting, ...jsonObj.param };
  categories = Array.isArray(jsonObj.param.categories) ? jsonObj.param.categories : categories;
  render();
}

$UD.onAdd((jsonObj) => {
  mergeSettings(jsonObj);
  requestRefresh().catch(() => {});
});
$UD.onParamFromApp(mergeSettings);
