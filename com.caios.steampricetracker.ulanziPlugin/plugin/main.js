import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.steampricetracker";
const ACTION_UUID = `${APP_ID}.tracker`;
const $UD = new UlanzideckApi();

const ACTIONS = new Map();
const SLOT_TO_FULL = new Map();
let APP_LIST_CACHE = [];
let APP_LIST_UPDATED_AT = 0;

let sharpLoader = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.resolve(__dirname, "../steam-tracker.log");

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_e) {}
}

async function getSharp() {
  if (!sharpLoader) {
    sharpLoader = import("sharp")
      .then((m) => m.default || m)
      .catch((e) => {
        log("sharp_load_error", String(e?.message || e));
        return null;
      });
  }
  return sharpLoader;
}

function getSlotContext(context) {
  const raw = String(context || "");
  const parts = raw.split("___");
  if (parts.length >= 2) {
    return `${parts[0]}___${parts[1]}___`;
  }
  return raw;
}

function hasActionInstance(context) {
  const parts = String(context || "").split("___");
  return parts.length >= 3 && Boolean(parts[2]);
}

function getVisualContext(context) {
  const slotContext = getSlotContext(context);
  return SLOT_TO_FULL.get(slotContext) || context;
}

function mergeSettings(context, next) {
  const slotContext = getSlotContext(context);
  const curr = {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
  };
  const merged = { ...curr, ...next };
  ACTIONS.set(context, merged);
  if (hasActionInstance(context)) {
    SLOT_TO_FULL.set(slotContext, context);
  }
  if (slotContext && slotContext !== context) {
    ACTIONS.set(slotContext, merged);
  }
  return merged;
}

function getState(data) {
  const context = data.context;
  const slotContext = getSlotContext(context);
  return {
    ...(ACTIONS.get(slotContext) || {}),
    ...(ACTIONS.get(context) || {}),
    ...(data.param || {}),
  };
}

function normalizeCountryCode(cc) {
  const value = String(cc || "auto").trim();
  if (!value || value.toLowerCase() === "auto") return "";
  return value.toUpperCase();
}

function hideCurrencyText(text) {
  if (!text) return "";
  const m = String(text).match(/[\d.,]+/);
  return m ? m[0] : String(text);
}

function httpGet(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "close",
        },
      },
      (res) => {
        const status = Number(res.statusCode || 0);
        const location = res.headers?.location;

        if (location && status >= 300 && status < 400 && redirectDepth < 5) {
          res.resume();
          const nextUrl = new URL(location, url).toString();
          httpGet(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          let errBody = "";
          res.on("data", (chunk) => {
            errBody += chunk.toString("utf8");
          });
          res.on("end", () => {
            reject(new Error(`HTTP ${status} ${url} ${errBody.slice(0, 200)}`));
          });
          return;
        }

        const chunks = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(12000, () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

async function getJson(url) {
  const raw = await httpGet(url);
  return JSON.parse(raw.toString("utf8") || "{}");
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildVisualFields(state, details) {
  const title = String(details?.name || state.appName || "Steam Game");

  let price = "TBA";
  if (details?.is_free) {
    price = "FREE";
  } else if (details?.price_overview?.final_formatted) {
    price = String(details.price_overview.final_formatted);
  }

  if (state.hideCurrency === true || state.hideCurrency === "true") {
    price = hideCurrencyText(price);
  }

  let badge = "";
  const discount = Number(details?.price_overview?.discount_percent || 0);
  if (Number.isFinite(discount) && discount > 0) {
    badge = `-${discount}%`;
  } else if (details?.release_date?.coming_soon) {
    badge = "COMING";
  }

  return { title, price, badge };
}

async function renderCardPng(details, state, capsuleBytes) {
  const sharp = await getSharp();
  if (!sharp) return null;

  const { title, price, badge } = buildVisualFields(state, details);
  const safeTitle = xmlEscape(title).slice(0, 24);
  const safePrice = xmlEscape(price);
  const safeBadge = xmlEscape(badge);

  let header = null;
  if (capsuleBytes) {
    try {
      header = await sharp(capsuleBytes).resize(144, 86, { fit: "cover" }).png().toBuffer();
    } catch (e) {
      log("renderCardPng:header_error", String(e?.message || e));
    }
  }

  const overlays = [];
  if (header) {
    overlays.push({ input: header, top: 16, left: 0 });
  }

  const badgeSvg = safeBadge
    ? `<svg width="68" height="26" xmlns="http://www.w3.org/2000/svg">
         <rect x="0" y="0" width="68" height="26" rx="5" fill="#4c6b22"/>
         <text x="34" y="18" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#beee11">${safeBadge}</text>
       </svg>`
    : "";

  if (badgeSvg) {
    overlays.push({ input: Buffer.from(badgeSvg, "utf8"), top: 4, left: 4 });
  }

  const bottomSvg = `<svg width="144" height="48" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="144" height="48" fill="#0f1724"/>
      <text x="72" y="16" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#ffffff">${safeTitle}</text>
      <text x="72" y="38" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="#beee11">${safePrice}</text>
    </svg>`;

  overlays.push({ input: Buffer.from(bottomSvg, "utf8"), top: 96, left: 0 });

  return sharp({
    create: {
      width: 144,
      height: 144,
      channels: 4,
      background: { r: 28, g: 40, b: 56, alpha: 1 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
}

function buildTitle(state, details) {
  const fields = buildVisualFields(state, details);
  return [fields.title.slice(0, 12), fields.price, fields.badge].filter(Boolean).join("\n");
}

async function setVisualCard(context, state, details) {
  const capsuleUrl = details?.capsule_image || details?.header_image || "";
  let capsuleBytes = null;

  if (capsuleUrl) {
    try {
      capsuleBytes = await httpGet(capsuleUrl);
    } catch (e) {
      log("setVisualCard:capsule_error", String(e?.message || e));
    }
  }

  try {
    const png = await renderCardPng(details, state, capsuleBytes);
    if (png) {
      $UD.setBaseDataIcon(context, png.toString("base64"), "");
      return;
    }
  } catch (e) {
    log("setVisualCard:render_error", String(e?.message || e));
  }

  const text = buildTitle(state, details);
  $UD.setStateIcon(context, 0, text);
}

async function fetchStoreDetails(appId, cc) {
  const country = normalizeCountryCode(cc);
  const ccPart = country ? `&cc=${encodeURIComponent(country)}` : "";
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(String(appId))}&filters=basic,price_overview,release_date${ccPart}`;
  const json = await getJson(url);
  const result = json?.[String(appId)];
  if (!result?.success || !result?.data) return null;
  return result.data;
}

async function fetchAppListCache() {
  const now = Date.now();
  if (APP_LIST_CACHE.length > 0 && now - APP_LIST_UPDATED_AT < 15 * 60 * 1000) {
    return APP_LIST_CACHE;
  }

  const url = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
  const json = await getJson(url);
  const apps = Array.isArray(json?.applist?.apps) ? json.applist.apps : [];
  APP_LIST_CACHE = apps.filter((a) => a?.name && a?.appid);
  APP_LIST_UPDATED_AT = now;
  return APP_LIST_CACHE;
}

async function resolveApp(query, cc) {
  const q = String(query || "").trim();
  if (!q) return null;

  if (/^\d+$/.test(q)) {
    const details = await fetchStoreDetails(q, cc);
    if (!details) return null;
    return { appId: String(details.steam_appid), appName: String(details.name || q) };
  }

  try {
    const country = normalizeCountryCode(cc);
    const ccPart = country ? `&cc=${encodeURIComponent(country)}` : "";
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=en${ccPart}`;
    const json = await getJson(url);
    const first = Array.isArray(json?.items) ? json.items[0] : null;
    if (first?.id) {
      return {
        appId: String(first.id),
        appName: String(first.name || q),
      };
    }
  } catch (e) {
    log("resolveApp:storesearch_error", String(e?.message || e));
  }

  const list = await fetchAppListCache();
  const queryNorm = q.toLowerCase();
  const exact = list.find((a) => String(a.name).toLowerCase() === queryNorm);
  if (exact) {
    return { appId: String(exact.appid), appName: String(exact.name) };
  }
  const partial = list.find((a) => String(a.name).toLowerCase().includes(queryNorm));
  if (partial) {
    return { appId: String(partial.appid), appName: String(partial.name) };
  }
  return null;
}

async function updateActionContext(context, stateOverride) {
  const state = stateOverride || ACTIONS.get(context) || {};
  const appId = String(state.appId || "").trim();
  const visualContext = getVisualContext(context);

  if (!hasActionInstance(visualContext)) {
    return;
  }

  if (!appId) {
    $UD.setStateIcon(visualContext, 0, "SET APP");
    return;
  }

  try {
    const details = await fetchStoreDetails(appId, state.countryCode);
    if (!details) {
      $UD.setStateIcon(visualContext, 0, "NOT FOUND");
      return;
    }

    const merged = mergeSettings(visualContext, {
      appId: String(details.steam_appid || appId),
      appName: String(details.name || state.appName || ""),
      lastUpdatedAt: Date.now(),
    });

    await setVisualCard(visualContext, merged, details);
  } catch (err) {
    log("updateActionContext:error", String(err?.message || err));
    $UD.setStateIcon(visualContext, 0, "ERROR");
  }
}

async function refreshAll() {
  for (const [ctx, state] of ACTIONS.entries()) {
    if (!hasActionInstance(ctx)) continue;
    if (String(state.uuid || state.actionUuid || "") !== ACTION_UUID) continue;
    await updateActionContext(ctx, state);
  }
}

$UD.connect(APP_ID);

$UD.onConnected(() => {
  log("connected");
  setInterval(() => {
    refreshAll().catch(() => {});
  }, 60 * 60 * 1000);
});

$UD.onAdd((data) => {
  const merged = mergeSettings(data.context, {
    ...(data.param || {}),
    actionid: data.actionid,
    actionUuid: data.uuid,
    uuid: data.uuid,
  });
  if (data.uuid === ACTION_UUID) {
    updateActionContext(data.context, merged).catch(() => {});
  }
});

$UD.onRun((data) => {
  const state = getState(data);
  const appId = String(state.appId || "").trim();
  if (appId) {
    $UD.openUrl(`https://store.steampowered.com/app/${encodeURIComponent(appId)}`);
  }
  updateActionContext(data.context, state).catch(() => {});
});

$UD.onClear((data) => {
  (data.param || []).forEach((p) => {
    if (!p?.context) return;
    ACTIONS.delete(p.context);
    const slotContext = getSlotContext(p.context);
    ACTIONS.delete(slotContext);
    SLOT_TO_FULL.delete(slotContext);
  });
});

async function onSettings(data) {
  const merged = mergeSettings(data.context, data.param || {});
  log("onSettings", { context: data.context, property_inspector: merged.property_inspector, searchQuery: merged.searchQuery, appId: merged.appId });

  if (merged.property_inspector === "resolveApp") {
    const query = merged.searchQuery || merged.appId || merged.appName || "";
    try {
      const resolved = await resolveApp(query, merged.countryCode);
      if (!resolved) {
        const outgoing = {
          ...merged,
          resolveStatus: "Nao encontrado",
        };
        delete outgoing.property_inspector;
        $UD.sendParamFromPlugin(outgoing, data.context);
        return;
      }

      const outgoing = {
        ...merged,
        appId: resolved.appId,
        appName: resolved.appName,
        searchQuery: resolved.appName,
        resolveStatus: "OK",
      };
      delete outgoing.property_inspector;

      const updated = mergeSettings(data.context, outgoing);
      $UD.sendParamFromPlugin(updated, data.context);
      await updateActionContext(data.context, updated);
      return;
    } catch (_e) {
      const outgoing = {
        ...merged,
        resolveStatus: "Erro ao buscar",
      };
      delete outgoing.property_inspector;
      $UD.sendParamFromPlugin(outgoing, data.context);
      return;
    }
  }

  if (String(merged.uuid || merged.actionUuid || data.uuid || "") === ACTION_UUID) {
    await updateActionContext(data.context, merged);
  }
}

$UD.onParamFromApp((data) => {
  onSettings(data).catch(() => {});
});

$UD.onParamFromPlugin((data) => {
  onSettings(data).catch(() => {});
});
