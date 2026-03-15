const RADIO_BUS = {
  audio: null,
  currentContext: "",
  isPlaying: false,
};

function shortName(name) {
  const raw = String(name || "RADIO").trim();
  if (!raw) return "RADIO";
  return raw.length > 8 ? raw.slice(0, 8).toUpperCase() : raw.toUpperCase();
}

function safeNumber(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeUrl(url) {
  return String(url || "").trim();
}

function safeSetTitle(context, text) {
  try {
    $UD.setTitle(context, text || "");
  } catch (_e) {}
}

class RadioAction {
  constructor(context) {
    this.context = context;
    this.settings = {
      stationName: "",
      streamUrl: "",
      volume: 80,
      showStationOnKey: true,
    };
  }

  add(jsn) {
    this.updateSettings(jsn.param || {});
    this.renderIdle();
  }

  updateSettings(next) {
    this.settings = {
      ...this.settings,
      ...next,
      streamUrl: normalizeUrl(next.streamUrl ?? this.settings.streamUrl),
      stationName: String(next.stationName ?? this.settings.stationName ?? ""),
      volume: Math.max(0, Math.min(100, safeNumber(next.volume ?? this.settings.volume, 80))),
      showStationOnKey: next.showStationOnKey !== undefined ? !!next.showStationOnKey : !!this.settings.showStationOnKey,
    };

    if (RADIO_BUS.currentContext === this.context && RADIO_BUS.audio) {
      RADIO_BUS.audio.volume = this.settings.volume / 100;
    }

    this.pushSettings();
    this.renderIdle();
  }

  pushSettings(extra) {
    $UD.sendParamFromPlugin(
      {
        ...this.settings,
        ...(extra || {}),
        playingContext: RADIO_BUS.currentContext,
        isPlaying: !!RADIO_BUS.isPlaying,
      },
      this.context
    );
  }

  renderIdle() {
    const active = RADIO_BUS.currentContext === this.context && RADIO_BUS.isPlaying;
    const station = this.settings.stationName || "RADIO";
    const label = this.settings.showStationOnKey ? shortName(station) : "RADIO";
    safeSetTitle(this.context, active ? `ON ${label}` : `OFF ${label}`);
  }

  stopCurrent() {
    if (!RADIO_BUS.audio) return;
    try {
      RADIO_BUS.audio.pause();
      RADIO_BUS.audio.src = "";
    } catch (_e) {}
    RADIO_BUS.audio = null;
    RADIO_BUS.isPlaying = false;
    RADIO_BUS.currentContext = "";
  }

  async run() {
    safeSetTitle(this.context, "TRY");
    const url = normalizeUrl(this.settings.streamUrl);
    if (!url) {
      safeSetTitle(this.context, "NO URL");
      return;
    }

    const sameContext = RADIO_BUS.currentContext === this.context;
    if (sameContext && RADIO_BUS.isPlaying) {
      this.stopCurrent();
      this.renderIdle();
      return;
    }

    this.stopCurrent();

    if (typeof Audio === "undefined") {
      safeSetTitle(this.context, "NO AUDIO");
      this.pushSettings({ status: "no-audio-runtime" });
      return;
    }

    const audio = new Audio();
    audio.src = url;
    audio.preload = "none";
    audio.volume = this.settings.volume / 100;

    audio.onplaying = () => {
      RADIO_BUS.audio = audio;
      RADIO_BUS.currentContext = this.context;
      RADIO_BUS.isPlaying = true;
      this.renderIdle();
      this.pushSettings({ status: "playing" });
    };

    audio.onpause = () => {
      if (RADIO_BUS.currentContext === this.context) {
        RADIO_BUS.isPlaying = false;
      }
      this.renderIdle();
    };

    audio.onerror = () => {
      RADIO_BUS.isPlaying = false;
      RADIO_BUS.currentContext = "";
      RADIO_BUS.audio = null;
      safeSetTitle(this.context, "ERROR");
      this.pushSettings({ status: "error" });
    };

    try {
      await audio.play();
    } catch (_e) {
      safeSetTitle(this.context, "BLOCKED");
      this.pushSettings({ status: "blocked" });
    }
  }

  clear() {
    if (RADIO_BUS.currentContext === this.context) {
      this.stopCurrent();
    }
  }
}
