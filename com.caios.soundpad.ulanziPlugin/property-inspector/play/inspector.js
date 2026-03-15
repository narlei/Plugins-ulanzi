let actionSetting = {
  bridgeUrl: "http://127.0.0.1:18181",
  categoryIndex: "",
  soundIndex: "",
  showSoundTitle: false,
  pushToPlay: false
};
let categories = [];
let sounds = [];
let form = null;
let currentContext = "";

$UD.connect("com.caios.ulanzideck.soundpad.play");

function toBool(v) {
  return v === true || v === "true" || v === "1" || v === 1;
}

function fillCategorySelect() {
  const el = document.getElementById("categoryIndex");
  el.innerHTML = "";

  (categories || []).forEach((c) => {
    const op = document.createElement("option");
    op.value = String(c.categoryIndex);
    op.textContent = String(c.categoryName);
    el.appendChild(op);
  });

  if ((!actionSetting.categoryIndex || actionSetting.categoryIndex === "") && categories.length > 0) {
    actionSetting.categoryIndex = String(categories[0].categoryIndex);
  }

  if (actionSetting.categoryIndex !== undefined && actionSetting.categoryIndex !== null) {
    el.value = String(actionSetting.categoryIndex);
  }
}

function fillSoundSelect() {
  const el = document.getElementById("soundIndex");
  el.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = "(Select sound)";
  el.appendChild(any);

  (sounds || []).forEach((s) => {
    const op = document.createElement("option");
    op.value = String(s.soundIndex);
    op.textContent = String(s.soundName);
    el.appendChild(op);
  });

  if (actionSetting.soundIndex !== undefined && actionSetting.soundIndex !== null) {
    el.value = String(actionSetting.soundIndex);
  }
}

function render() {
  fillCategorySelect();
  fillSoundSelect();
  document.getElementById("showSoundTitle").checked = toBool(actionSetting.showSoundTitle);
  document.getElementById("pushToPlay").checked = toBool(actionSetting.pushToPlay);
  document.getElementById("manualSoundIndex").value =
    actionSetting.soundIndexManual || "";
}

function sendSettings(extra) {
  const soundSelect = document.getElementById("soundIndex");
  const selectedSoundTitle =
    soundSelect && soundSelect.selectedIndex >= 0
      ? soundSelect.options[soundSelect.selectedIndex].textContent
      : "";

  const payload = {
    bridgeUrl: actionSetting.bridgeUrl || "http://127.0.0.1:18181",
    categoryIndex: document.getElementById("categoryIndex").value,
    soundIndex: document.getElementById("soundIndex").value,
    soundTitle: selectedSoundTitle || "",
    soundIndexManual: document.getElementById("manualSoundIndex").value,
    showSoundTitle: document.getElementById("showSoundTitle").checked,
    pushToPlay: document.getElementById("pushToPlay").checked
  };

  // If manual index is set, it should override dropdown choice.
  if (payload.soundIndexManual && payload.soundIndexManual.trim() !== "") {
    payload.soundIndex = payload.soundIndexManual.trim();
  }

  actionSetting = { ...actionSetting, ...payload };
  $UD.sendParamFromPlugin({ ...actionSetting, ...(extra || {}) }, currentContext || undefined);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function requestRefresh(shouldPersist = false) {
  const base = String(actionSetting.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
  try {
    // Always read the current selected category directly from UI.
    const selectedCategory = document.getElementById("categoryIndex")?.value ?? actionSetting.categoryIndex;
    if (selectedCategory !== undefined && selectedCategory !== null) {
      actionSetting.categoryIndex = String(selectedCategory);
    }

    const cat = await fetchJson(`${base}/categories`);
    categories = (cat.categories || []).map((c) => ({
      categoryName: c.Name,
      categoryIndex: c.Index,
    }));

    if ((!actionSetting.categoryIndex || actionSetting.categoryIndex === "") && categories.length > 0) {
      actionSetting.categoryIndex = String(categories[0].categoryIndex);
    }

    if (actionSetting.categoryIndex && actionSetting.categoryIndex !== "") {
      const snd = await fetchJson(`${base}/sounds?categoryIndex=${encodeURIComponent(String(actionSetting.categoryIndex))}`);
      sounds = (snd.sounds || []).map((s) => ({
        soundName: s.Title,
        soundIndex: s.Index,
      }));
    } else {
      sounds = [];
    }

    render();
    if (shouldPersist) {
      sendSettings();
    }
  } catch (_e) {
    // fallback: ask backend to refresh if direct fetch failed
    $UD.sendParamFromPlugin({ ...actionSetting, property_inspector: "refreshSounds" });
  }
}

$UD.onConnected(() => {
  form = document.querySelector("#property-inspector");
  document.querySelector(".udpi-wrapper").classList.remove("hidden");

  form.addEventListener(
    "input",
    Utils.debounce(() => {
      sendSettings();
    }, 200)
  );

  document.getElementById("categoryIndex").addEventListener("change", () => {
    actionSetting.categoryIndex = document.getElementById("categoryIndex").value;
    requestRefresh(true).catch(() => {});
  });

  document.getElementById("soundIndex").addEventListener("change", () => {
    actionSetting.soundIndex = document.getElementById("soundIndex").value;
    sendSettings();
  });

  document.getElementById("manualSoundIndex").addEventListener("input", () => {
    sendSettings();
  });

  document.getElementById("showSoundTitle").addEventListener("change", () => {
    sendSettings();
  });

  document.getElementById("pushToPlay").addEventListener("change", () => {
    sendSettings();
  });

  document.getElementById("refreshBtn").addEventListener("click", () => requestRefresh().catch(() => {}));
  requestRefresh(false).catch(() => {});
});

function mergeSettings(jsonObj) {
  if (!jsonObj || !jsonObj.param) return;
  if (jsonObj.context) {
    currentContext = jsonObj.context;
  }
  actionSetting = { ...actionSetting, ...jsonObj.param };
  categories = Array.isArray(jsonObj.param.categories) ? jsonObj.param.categories : categories;
  sounds = Array.isArray(jsonObj.param.sounds) ? jsonObj.param.sounds : sounds;
  render();
}

$UD.onAdd((jsonObj) => {
  mergeSettings(jsonObj);
  requestRefresh(false).catch(() => {});
});

$UD.onParamFromApp((jsonObj) => {
  mergeSettings(jsonObj);
});
