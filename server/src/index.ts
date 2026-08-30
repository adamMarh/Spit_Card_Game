import uWS from "uWebSockets.js";
import type { ClientMessage } from "@speed/shared";
import { cleanupRooms, handleDisconnect, handleMessage, type SocketData } from "./net/room.js";

const port = Number(process.env.PORT ?? 8080);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "*";
const decoder = new TextDecoder();

// JSON is intentionally used instead of MessagePack for v1: messages are tiny,
// TCP ordering is already provided by WebSocket, and JSON keeps the protocol easy
// to inspect while the high-frequency path only relays one small cursor payload.
const app = uWS
  .App()
  .get("/health", (res) => {
    res.writeHeader("access-control-allow-origin", clientOrigin);
    res.end("ok");
  })
  .ws<SocketData>("/*", {
    idleTimeout: 120,
    maxBackpressure: 1024 * 1024,
    upgrade: (res, req, context) => {
      res.upgrade({}, req.getHeader("sec-websocket-key"), req.getHeader("sec-websocket-protocol"), req.getHeader("sec-websocket-extensions"), context);
    },
    message: (ws, arrayBuffer) => {
      try {
        const message = JSON.parse(decoder.decode(arrayBuffer)) as ClientMessage;
        handleMessage(ws, message);
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "BAD_MESSAGE", message: "Malformed message." }));
      }
    },
    close: (ws) => handleDisconnect(ws)
  });

setInterval(() => cleanupRooms(), 60_000).unref();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

app.listen(port, (token) => {
  if (!token) {
    console.error(`Failed to listen on ${port}`);
    process.exit(1);
  }
  console.log(`Speed server listening on ${port}`);
});
