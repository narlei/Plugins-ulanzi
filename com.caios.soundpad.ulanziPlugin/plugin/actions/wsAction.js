class WSAction {
  constructor(context) {
    this.context = context;
    this.settings = {
      actionId: "",
      argsJson: "{}",
      wsUrl: "ws://localhost:8059"
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
    const url = this.settings.wsUrl || "ws://localhost:8059";
    if (this.socket && this.socket.url === url) return;
    this.closeSocket();

    try {
      this.socket = new WebSocket(url);
      this.socket.onopen = () => $UD.setTitle(this.context, "READY");
      this.socket.onclose = () => $UD.setTitle(this.context, "OFFLINE");
      this.socket.onerror = () => $UD.setTitle(this.context, "OFFLINE");
    } catch (_err) {
      $UD.setTitle(this.context, "OFFLINE");
    }
  }

  run() {
    if (!this.isActive) return;
    let args = {};
    try {
      args = JSON.parse(this.settings.argsJson || "{}");
    } catch (_err) {
      $UD.setTitle(this.context, "JSON ERR");
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.ensureSocket();
      $UD.setTitle(this.context, "OFFLINE");
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "run_action",
        actionId: this.settings.actionId || "",
        args
      })
    );
    $UD.setTitle(this.context, "SENT");
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
