import { create } from "zustand";
import type { AiDifficulty, Card, ClientMessage, PileId, ServerMessage, StateUpdate } from "@speed/shared";
import { sendJson } from "../lib/ws";

interface CursorState {
  x: number;
  y: number;
  draggingCardId: string | null;
}

interface GameStore {
  socket: WebSocket | null;
  url: string;
  lobbyId: string;
  name: string;
  aiDifficulty: AiDifficulty;
  state: StateUpdate | null;
  toast: string;
  opponentCursor: CursorState | null;
  pendingCardId: string | null;
  queuedMessage: ClientMessage | null;
  connect: (url: string) => void;
  send: (message: ClientMessage) => void;
  setName: (name: string) => void;
  setAiDifficulty: (difficulty: AiDifficulty) => void;
  createLobby: () => void;
  createSoloLobby: () => void;
  joinLobby: (lobbyId: string) => void;
  ready: () => void;
  quitGame: () => void;
  moveStockCard: (cardId: string, targetIndex: number) => void;
  flipStockCard: (cardId: string) => void;
  playCard: (cardId: string, targetPile: PileId) => void;
  setToast: (message: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  url: "",
  lobbyId: "",
  name: "",
  aiDifficulty: "easy",
  state: null,
  toast: "",
  opponentCursor: null,
  pendingCardId: null,
  queuedMessage: null,
  connect: (url) => {
    const existing = get().socket;
    if (existing && existing.readyState <= WebSocket.OPEN) return;
    const socket = new WebSocket(url);
    socket.onopen = () => {
      const queued = get().queuedMessage;
      if (queued) {
        sendJson(socket, queued);
        set({ queuedMessage: null });
      }
      const lobbyId = get().lobbyId;
      if (lobbyId && get().state) sendJson(socket, { type: "join_lobby", lobbyId, name: get().name });
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "lobby_created") set({ lobbyId: message.lobbyId, toast: "" });
      if (message.type === "state_update") set({ state: message, lobbyId: message.lobbyId, pendingCardId: null });
      if (message.type === "opponent_cursor") set({ opponentCursor: message });
      if (message.type === "toast") set({ toast: message.message });
      if (message.type === "game_over") set((store) => ({ toast: store.state?.playerId === message.winnerId ? "You win!" : "You lose!" }));
      if (message.type === "error") set({ toast: message.message, pendingCardId: null });
    };
    socket.onclose = () => {
      set({ socket: null, toast: "Connection closed. Reconnecting..." });
      window.setTimeout(() => get().connect(get().url), 800);
    };
    set({ socket, url });
  },
  send: (message) => {
    const socket = get().socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendJson(socket, message);
      return;
    }
    set({ queuedMessage: message });
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      get().connect(get().url);
    }
  },
  setName: (name) => set({ name }),
  setAiDifficulty: (difficulty) => set({ aiDifficulty: difficulty }),
  createLobby: () => get().send({ type: "create_lobby", name: get().name }),
  createSoloLobby: () => get().send({ type: "create_solo_lobby", name: get().name, aiDifficulty: get().aiDifficulty }),
  joinLobby: (lobbyId) => get().send({ type: "join_lobby", lobbyId: lobbyId.trim().toUpperCase(), name: get().name }),
  ready: () => get().send({ type: "ready" }),
  quitGame: () => {
    get().send({ type: "quit_game" });
    set({ lobbyId: "", state: null, toast: "", opponentCursor: null, pendingCardId: null });
  },
  flipStockCard: (cardId) => {
    set({ pendingCardId: cardId });
    get().send({ type: "flip_stock_card", cardId });
  },
  moveStockCard: (cardId, targetIndex) => {
    set({ pendingCardId: cardId });
    get().send({ type: "move_stock_card", cardId, targetIndex });
  },
  playCard: (cardId, targetPile) => {
    set({ pendingCardId: cardId });
    get().send({ type: "play_card", cardId, targetPile });
  },
  setToast: (message) => set({ toast: message })
}));

export function cardColor(card: Card): string {
  return card.suit === "H" || card.suit === "D" ? "text-red-700" : "text-slate-950";
}
