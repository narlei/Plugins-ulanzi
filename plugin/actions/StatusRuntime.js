class StatusRuntime {
  constructor({ context, settings, udBridge, logger = console }) {
    this.context = context;
    this.settings = settings;
    this.udBridge = udBridge;
    this.logger = logger;
  }

  setOnline(isOnline) {
    const onlineText = this.settings.onlineText || "ONLINE";
    const offlineText = this.settings.offlineText || "OFFLINE";
    const text = isOnline ? onlineText : offlineText;
    this.udBridge.setTitle(this.context, text);
  }
}

if (typeof module !== "undefined") {
  module.exports = { StatusRuntime };
}
