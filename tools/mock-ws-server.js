const { WebSocketServer } = require("ws");

const port = Number(process.env.WS_PORT || 8059);
const wss = new WebSocketServer({ port });

console.log(`[mock-ws] listening on ws://localhost:${port}`);

wss.on("connection", (socket) => {
  console.log("[mock-ws] client connected");

  socket.on("message", (raw) => {
    const text = raw.toString();
    console.log("[mock-ws] received:", text);

    socket.send(
      JSON.stringify({
        type: "ack",
        receivedAt: new Date().toISOString(),
      })
    );
  });

  socket.on("close", () => {
    console.log("[mock-ws] client disconnected");
  });
});

process.on("SIGINT", () => {
  wss.close(() => process.exit(0));
});
