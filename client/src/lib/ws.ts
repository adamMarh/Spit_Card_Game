import type { ClientMessage } from "@speed/shared";

export function sendJson(socket: WebSocket | null, message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export const wsUrl = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";
