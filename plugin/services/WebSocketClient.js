class WebSocketClient {
  constructor(url, { reconnectDelayMs = 2000, logger = console } = {}) {
    this.url = url;
    this.reconnectDelayMs = reconnectDelayMs;
    this.logger = logger;
    this.socket = null;
    this.closedByUser = false;
    this.onMessage = () => {};
    this.onOpen = () => {};
    this.onClose = () => {};
    this.onError = () => {};
  }

  connect() {
    if (!this.url) throw new Error("WebSocket URL is required.");
    this.closedByUser = false;
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", () => {
      this.logger.log("[ws] connected:", this.url);
      this.onOpen();
    });

    this.socket.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });

    this.socket.addEventListener("close", () => {
      this.logger.warn("[ws] disconnected:", this.url);
      this.onClose();
      if (!this.closedByUser) {
        setTimeout(() => this.connect(), this.reconnectDelayMs);
      }
    });

    this.socket.addEventListener("error", (error) => {
      this.logger.error("[ws] error:", error);
      this.onError(error);
    });
  }

  sendJson(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected.");
    }
    this.socket.send(JSON.stringify(payload));
  }

  close() {
    this.closedByUser = true;
    if (this.socket) this.socket.close();
  }
}

if (typeof module !== "undefined") {
  module.exports = { WebSocketClient };
}
