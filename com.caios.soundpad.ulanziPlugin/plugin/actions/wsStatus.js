class WSStatus {
  constructor(context) {
    this.context = context;
    this.settings = {
      wsUrl: "ws://localhost:8059",
      onlineText: "ONLINE",
      offlineText: "OFFLINE"
    };
    this.socket = null;
    this.isActive = true;
  }

  add(jsn) {
    this.updateSettings(jsn.param || {});
  }

  setActive(active) {
    this.isActive = Boolean(active);
  }

  updateSettings(next) {
    this.settings = { ...this.settings, ...next };
    this.ensureSocket();
  }

  ensureSocket() {
    if (!this.isActive) return;
    const url = this.settings.wsUrl || "ws://localhost:8059";
    if (this.socket && this.socket.url === url) return;
    this.closeSocket();

    try {
      this.socket = new WebSocket(url);
      this.socket.onopen = () => this.render(true);
      this.socket.onclose = () => this.render(false);
      this.socket.onerror = () => this.render(false);
    } catch (_err) {
      this.render(false);
    }
  }

  run() {}

  render(online) {
    const text = online ? this.settings.onlineText : this.settings.offlineText;
    $UD.setTitle(this.context, text);
  }

  clear() {
    this.closeSocket();
  }

  closeSocket() {
    if (!this.socket) return;
    try {
      this.socket.close();
    } catch (_err) {}
    this.socket = null;
  }
}
