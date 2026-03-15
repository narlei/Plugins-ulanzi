class SoundpadAction {
  constructor(context, actionId) {
    this.context = context;
    this.actionId = actionId || "";
    this.isActive = true;
    this.settings = {
      bridgeUrl: "http://127.0.0.1:18181",
      soundIndex: "",
      removeSoundIndex: "",
      categoryIndex: "",
      soundListFileName: ""
    };
  }

  add(jsn) {
    this.updateSettings(jsn.param || {});
    this.pingBridge();
  }

  setActive(active) {
    this.isActive = Boolean(active);
  }

  updateSettings(next) {
    this.settings = { ...this.settings, ...next };
  }

  async run() {
    if (!this.isActive) return;
    const base = (this.settings.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
    if (typeof window !== "undefined" && typeof window.ensureSoundpadBridge === "function") {
      const ok = await window.ensureSoundpadBridge(base);
      if (!ok) {
        this.setErr("OFFLINE");
        return;
      }
    }
    const id = String(this.actionId || "");

    try {
      if (id.endsWith(".play")) {
        await this.post(`${base}/play`, { index: Number(this.settings.soundIndex) });
        return this.setOk("PLAY");
      }
      if (id.endsWith(".playrandom")) {
        const categoryIndex = this.settings.categoryIndex === "" ? null : Number(this.settings.categoryIndex);
        await this.post(`${base}/play-random`, { categoryIndex });
        return this.setOk("RAND");
      }
      if (id.endsWith(".pause")) {
        await this.post(`${base}/toggle-pause`, {});
        return this.setOk("PAUSE");
      }
      if (id.endsWith(".stop")) {
        await this.post(`${base}/stop`, {});
        return this.setOk("STOP");
      }
      if (id.endsWith(".remove")) {
        await this.post(`${base}/remove`, { index: Number(this.settings.removeSoundIndex) });
        return this.setOk("REM");
      }
      if (id.endsWith(".recordptt")) {
        const res = await this.post(`${base}/toggle-recording`, {});
        return this.setOk(res.recording ? "REC" : "READY");
      }
      if (id.endsWith(".loadsoundlist")) {
        await this.post(`${base}/load-soundlist`, { path: this.settings.soundListFileName || "" });
        return this.setOk("LOAD");
      }
      this.setErr("UNKNOWN");
    } catch (_error) {
      this.setErr("OFFLINE");
    }
  }

  async pingBridge() {
    const base = (this.settings.bridgeUrl || "http://127.0.0.1:18181").replace(/\/$/, "");
    try {
      if (typeof window !== "undefined" && typeof window.ensureSoundpadBridge === "function") {
        await window.ensureSoundpadBridge(base);
      }
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error("bridge not healthy");
      this.setOk("READY");
    } catch (_error) {
      this.setErr("OFFLINE");
    }
  }

  async post(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "request failed");
    }
    return data;
  }

  setOk(text) {
    $UD.setTitle(this.context, text);
  }

  setErr(text) {
    $UD.setTitle(this.context, text);
  }

  clear() {}
}
