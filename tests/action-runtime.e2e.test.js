const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");
const { ActionRuntime } = require("../plugin/actions/ActionRuntime");
const { WebSocketClient } = require("../plugin/services/WebSocketClient");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("ActionRuntime envia payload run_action via WebSocket", async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const messageWait = deferred();

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      try {
        messageWait.resolve(JSON.parse(raw.toString()));
      } catch (err) {
        messageWait.reject(err);
      }
    });
  });

  const titles = [];
  const udBridge = {
    setTitle: (_context, title) => titles.push(title),
  };

  const wsClient = new WebSocketClient(`ws://localhost:${port}`, {
    reconnectDelayMs: 20,
    logger: { log() {}, warn() {}, error() {} },
  });

  await new Promise((resolve) => {
    wsClient.onOpen = resolve;
    wsClient.connect();
  });

  const runtime = new ActionRuntime({
    context: "btn-1",
    settings: {
      actionId: "scene.switch",
      argsJson: '{"scene":"Intro"}',
    },
    wsClient,
    udBridge,
    logger: { log() {}, warn() {}, error() {} },
  });

  await runtime.handleKeyDown();

  const received = await Promise.race([
    messageWait.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout aguardando mensagem WS")), 2000)
    ),
  ]);

  assert.equal(received.type, "run_action");
  assert.equal(received.actionId, "scene.switch");
  assert.deepEqual(received.args, { scene: "Intro" });
  assert.deepEqual(titles, ["SENT"]);

  wsClient.close();
  await new Promise((resolve) => wss.close(resolve));
});

test("ActionRuntime sinaliza JSON ERR quando argsJson invalido", async () => {
  const titles = [];
  const runtime = new ActionRuntime({
    context: "btn-2",
    settings: {
      actionId: "scene.switch",
      argsJson: "{invalid-json}",
    },
    wsClient: { sendJson() {} },
    udBridge: {
      setTitle: (_context, title) => titles.push(title),
    },
    logger: { log() {}, warn() {}, error() {} },
  });

  await runtime.handleKeyDown();

  assert.deepEqual(titles, ["JSON ERR"]);
});
