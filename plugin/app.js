/* global WebSocket */

let ActionRuntimeRef = typeof ActionRuntime !== "undefined" ? ActionRuntime : null;
let StatusRuntimeRef = typeof StatusRuntime !== "undefined" ? StatusRuntime : null;
let WebSocketClientRef = typeof WebSocketClient !== "undefined" ? WebSocketClient : null;

if (typeof module !== "undefined" && module.exports) {
  ActionRuntimeRef = require("./actions/ActionRuntime").ActionRuntime;
  StatusRuntimeRef = require("./actions/StatusRuntime").StatusRuntime;
  WebSocketClientRef = require("./services/WebSocketClient").WebSocketClient;
}

class UDBridge {
  setTitle(context, title) {
    if (typeof $UD !== "undefined" && typeof $UD.setTitle === "function") {
      $UD.setTitle(context, title);
      return;
    }
    console.log("[bridge] setTitle", { context, title });
  }

  saveSettings(context, settings) {
    if (typeof $UD !== "undefined" && typeof $UD.sendParamFromPlugin === "function") {
      $UD.sendParamFromPlugin({ context, settings });
      return;
    }
    console.log("[bridge] saveSettings", { context, settings });
  }

  log(event, payload) {
    if (typeof $UD !== "undefined" && typeof $UD.log === "function") {
      $UD.log(event, payload);
      return;
    }
    console.log(`[bridge] ${event}`, payload);
  }
}

class PluginApp {
  constructor({ logger = console } = {}) {
    this.udBridge = new UDBridge();
    this.instances = new Map();
    this.logger = logger;
    this.socket = null;
    this.uuid = null;
  }

  createActionInstance(context, settings, action) {
    const wsUrl = settings.wsUrl || "ws://localhost:8059";
    const wsClient = new WebSocketClientRef(wsUrl);
    wsClient.connect();

    const runtime = new ActionRuntimeRef({
      context,
      settings,
      wsClient,
      udBridge: this.udBridge,
      action,
      logger: this.logger,
    });

    this.instances.set(context, { type: "action", action, runtime, wsClient });
    return runtime;
  }

  createStatusInstance(context, settings, action) {
    const runtime = new StatusRuntimeRef({
      context,
      settings,
      udBridge: this.udBridge,
      action,
      logger: this.logger,
    });

    this.instances.set(context, { type: "status", action, runtime, wsClient: null });
    return runtime;
  }

  onKeyDown(context) {
    const item = this.instances.get(context);
    if (!item || item.type !== "action") return;
    item.runtime.handleKeyDown();
  }

  onConnectionState(context, isOnline) {
    const item = this.instances.get(context);
    if (!item || item.type !== "status") return;
    item.runtime.setOnline(Boolean(isOnline));
  }

  updateSettings(context, settings) {
    const item = this.instances.get(context);
    if (!item) return;
    item.runtime.settings = { ...item.runtime.settings, ...settings };
  }

  ensureInstance({ context, action, settings = {} }) {
    const current = this.instances.get(context);
    if (current) {
      this.updateSettings(context, settings);
      return current;
    }

    const isStatus = String(action || "").includes(".status");
    if (isStatus) {
      this.createStatusInstance(context, settings, action);
    } else {
      this.createActionInstance(context, settings, action);
    }
    return this.instances.get(context);
  }

  handleSdkEvent(event, data) {
    const context = data.context;
    const payload = data.payload || {};
    const action = data.action || "";

    if (event === "willAppear") {
      this.ensureInstance({
        context,
        action,
        settings: payload.settings || {},
      });
      return;
    }

    if (event === "didReceiveSettings") {
      this.ensureInstance({
        context,
        action,
        settings: payload.settings || {},
      });
      return;
    }

    if (event === "keyDown") {
      this.onKeyDown(context);
      return;
    }

    if (event === "willDisappear") {
      this.destroy(context);
      return;
    }

    if (event === "sendToPlugin") {
      const state = payload.isOnline;
      if (typeof state !== "undefined") {
        this.onConnectionState(context, Boolean(state));
      }
      return;
    }
  }

  connectSocket({ port, uuid, registerEvent = "registerPlugin" }) {
    this.uuid = uuid;
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);

    this.socket.addEventListener("open", () => {
      this.socket.send(
        JSON.stringify({
          event: registerEvent,
          uuid,
        })
      );
      this.udBridge.log("plugin_registered", { registerEvent, uuid });
    });

    this.socket.addEventListener("message", (evt) => {
      try {
        const message = JSON.parse(evt.data);
        this.handleSdkEvent(message.event, message);
      } catch (error) {
        this.logger.error("[plugin] failed to parse SDK message", error);
      }
    });
  }

  destroy(context) {
    const item = this.instances.get(context);
    if (!item) return;
    if (item.wsClient) item.wsClient.close();
    this.instances.delete(context);
  }
}

if (typeof window !== "undefined") {
  const app = new PluginApp();
  window.PluginApp = PluginApp;
  window.pluginApp = app;

  // Compatibilidade com bootstrap estilo Stream Deck/Ulanzi.
  window.connectUlanziDeckSocket = function connectUlanziDeckSocket(
    port,
    uuid,
    registerEvent
  ) {
    app.connectSocket({ port, uuid, registerEvent });
  };

  window.connectElgatoStreamDeckSocket = function connectElgatoStreamDeckSocket(
    port,
    uuid,
    registerEvent
  ) {
    app.connectSocket({ port, uuid, registerEvent });
  };
}

if (typeof module !== "undefined") {
  module.exports = { PluginApp, UDBridge };
}
