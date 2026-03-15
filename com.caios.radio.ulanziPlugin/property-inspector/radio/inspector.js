let actionSetting = {
  country: "BR",
  stationName: "",
  streamUrl: "",
  volume: 80,
  showStationOnKey: true,
};
let currentContext = "";
let stationList = [];
const FALLBACK_STATIONS = [
  { name: "Jovem Pan FM SP", country: "BR", bitrate: 128, url: "https://playerservices.streamtheworld.com/api/livestream-redirect/JP_SPAAC.aac" },
  { name: "Band FM SP", country: "BR", bitrate: 128, url: "https://evpp.mm.uol.com.br/band/bandfm_sp/playlist.m3u8" },
  { name: "Antena 1", country: "BR", bitrate: 128, url: "https://playerservices.streamtheworld.com/api/livestream-redirect/ANTENA1AAC.aac" },
  { name: "Kiss FM", country: "BR", bitrate: 128, url: "https://playerservices.streamtheworld.com/api/livestream-redirect/KISSFM_SPAAC.aac" },
  { name: "CBN SP", country: "BR", bitrate: 96, url: "https://playerservices.streamtheworld.com/api/livestream-redirect/CBN_SPAAC.aac" },
  { name: "BBC World Service", country: "UK", bitrate: 128, url: "https://stream.live.vc.bbcmedia.co.uk/bbc_world_service" },
  { name: "NPR Program Stream", country: "US", bitrate: 128, url: "https://npr-ice.streamguys1.com/live.mp3" },
];

$UD.connect("com.caios.ulanzideck.radio.toggle");

function toNum(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function isFullContext(ctx) {
  const parts = String(ctx || "").split("___");
  return parts.length >= 3 && !!parts[2];
}

function render() {
  document.getElementById("country").value = actionSetting.country || "BR";
  document.getElementById("stationName").value = actionSetting.stationName || "";
  document.getElementById("streamUrl").value = actionSetting.streamUrl || "";
  document.getElementById("volume").value = toNum(actionSetting.volume, 80);
  document.getElementById("showStationOnKey").checked = actionSetting.showStationOnKey !== false && actionSetting.showStationOnKey !== "false";
}

function readForm() {
  return {
    country: String(document.getElementById("country").value || "").trim().toUpperCase().slice(0, 2),
    stationName: document.getElementById("stationName").value.trim(),
    streamUrl: document.getElementById("streamUrl").value.trim(),
    volume: Math.max(0, Math.min(100, toNum(document.getElementById("volume").value, 80))),
    showStationOnKey: document.getElementById("showStationOnKey").checked,
  };
}

function sendSettings(extra) {
  if (!currentContext) return;
  actionSetting = { ...actionSetting, ...readForm(), ...(extra || {}) };
  $UD.sendParamFromPlugin(actionSetting, currentContext);
}

function setStatus(text) {
  document.getElementById("statusLine").value = text;
}

function cacheKey() {
  return `radioStationList:${currentContext || "default"}`;
}

function saveStationCache() {
  try {
    sessionStorage.setItem(cacheKey(), JSON.stringify(stationList || []));
  } catch (_e) {}
}

function loadStationCache() {
  try {
    const raw = sessionStorage.getItem(cacheKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function populateStations(list) {
  const sel = document.getElementById("stationSelect");
  sel.innerHTML = "";

  const base = document.createElement("option");
  base.value = "";
  base.textContent = list.length ? "(Select station)" : "(No stations)";
  sel.appendChild(base);

  list.forEach((s, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const br = s.bitrate ? `${s.bitrate}kbps` : "?kbps";
    opt.textContent = `${s.name || "Unnamed"} - ${s.country || ""} - ${br}`;
    sel.appendChild(opt);
  });
}

function fallbackSearch(name, country) {
  const n = String(name || "").trim().toLowerCase();
  const c = String(country || "").trim().toUpperCase();
  return FALLBACK_STATIONS.filter((s) => {
    const byCountry = !c || String(s.country || "").toUpperCase() === c;
    const byName = !n || String(s.name || "").toLowerCase().includes(n);
    return byCountry && byName;
  });
}

function loadDefaultStations() {
  const country = String(document.getElementById("country").value || "").trim().toUpperCase().slice(0, 2);
  stationList = fallbackSearch("", country);
  populateStations(stationList);
  saveStationCache();
  setStatus(stationList.length ? `Default: ${stationList.length} station(s)` : "No default stations");
}

async function searchStations() {
  const name = document.getElementById("searchName").value.trim();
  const country = String(document.getElementById("country").value || "").trim().toUpperCase().slice(0, 2);

  const params = new URLSearchParams();
  params.set("hidebroken", "true");
  params.set("limit", "50");
  if (name) params.set("name", name);
  if (country) params.set("countrycode", country);
  const query = params.toString();
  const urls = [
    `http://all.api.radio-browser.info/json/stations/search?${query}`,
    `http://de1.api.radio-browser.info/json/stations/search?${query}`,
    `https://all.api.radio-browser.info/json/stations/search?${query}`,
    `https://de1.api.radio-browser.info/json/stations/search?${query}`,
  ];

  setStatus("Searching...");
  try {
    let data = null;
    let lastErr = null;
    for (const u of urls) {
      try {
        const res = await fetch(u, { method: "GET" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        if (Array.isArray(data)) break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!Array.isArray(data)) throw lastErr || new Error("No endpoint available");

    stationList = (Array.isArray(data) ? data : [])
      .filter((s) => s && s.url_resolved)
      .map((s) => ({
        name: s.name || "",
        country: s.country || "",
        bitrate: s.bitrate || 0,
        url: s.url_resolved || s.url || "",
      }));

    if (!stationList.length) {
      stationList = fallbackSearch(name, country);
    }

    populateStations(stationList);
    saveStationCache();
    setStatus(`Found ${stationList.length} station(s)`);
  } catch (err) {
    stationList = fallbackSearch(name, country);
    populateStations(stationList);
    saveStationCache();
    setStatus(stationList.length ? `Fallback: ${stationList.length} station(s)` : "Search failed (use URL manual)");
  }
}

function merge(jsonObj) {
  if (!jsonObj) return;
  if (jsonObj.context) {
    if (!currentContext) {
      currentContext = jsonObj.context;
    } else if (jsonObj.context === currentContext && isFullContext(jsonObj.context)) {
      currentContext = jsonObj.context;
    }
  }
  if (jsonObj.context && currentContext && jsonObj.context !== currentContext) return;
  if (!jsonObj.param) return;
  actionSetting = { ...actionSetting, ...jsonObj.param };
  render();
}

$UD.onConnected(() => {
  const wrapper = document.querySelector(".udpi-wrapper");
  wrapper.classList.remove("hidden");
  const contextFromUrl = Utils.getUrlParameter("context");
  if (contextFromUrl) currentContext = contextFromUrl;

  const form = document.querySelector("#property-inspector");
  form.addEventListener("input", Utils.debounce(() => sendSettings(), 220));
  form.addEventListener("change", Utils.debounce(() => sendSettings(), 80));

  document.getElementById("searchBtn").addEventListener("click", searchStations);

  document.getElementById("stationSelect").addEventListener("change", (ev) => {
    const idx = Number(ev.target.value);
    if (!Number.isFinite(idx) || idx < 0 || idx >= stationList.length) return;
    const st = stationList[idx];
    document.getElementById("stationName").value = st.name || "";
    document.getElementById("streamUrl").value = st.url || "";
    sendSettings();
    setStatus("Station selected");
  });

  stationList = loadStationCache();
  if (!stationList.length) {
    loadDefaultStations();
  } else {
    populateStations(stationList);
    setStatus(`Loaded ${stationList.length} cached station(s)`);
  }
  render();
});

$UD.onAdd(merge);
$UD.onParamFromApp(merge);
$UD.onParamFromPlugin(merge);
