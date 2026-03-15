class ActionRuntime {
  constructor({ context, settings, wsClient, udBridge, logger = console }) {
    this.context = context;
    this.settings = settings;
    this.wsClient = wsClient;
    this.udBridge = udBridge;
    this.logger = logger;
  }

  async handleKeyDown() {
    const actionId = this.settings.actionId || "";
    const argsJson = this.settings.argsJson || "{}";

    let args = {};
    try {
      args = JSON.parse(argsJson);
    } catch (error) {
      this.logger.error("[action] invalid argsJson:", error);
      this.udBridge.setTitle(this.context, "JSON ERR");
      return;
    }

    try {
      this.wsClient.sendJson({
        type: "run_action",
        actionId,
        args,
      });
      this.udBridge.setTitle(this.context, "SENT");
    } catch (error) {
      this.logger.error("[action] send failed:", error);
      this.udBridge.setTitle(this.context, "OFFLINE");
    }
  }
}

if (typeof module !== "undefined") {
  module.exports = { ActionRuntime };
}
