import type { AiDifficulty, ClientMessage, PileId, PlayerId, ServerMessage } from "@speed/shared";
import { createSpeedGame, flipStockCard, getLegalMoves, isDeadlocked, makeStateUpdate, markReady, moveStockCard, playCard, prepareNextRound, resolveDeadlock, startGame, type SpeedGameState } from "../game/speedGame.js";

export interface SocketData {
  lobbyId?: string;
  playerId?: PlayerId;
}

export interface WsLike {
  getUserData(): SocketData;
  send(message: string): number | boolean;
  close?: () => void;
}

interface RoomPlayer {
  id: PlayerId;
  name: string;
  socket: WsLike | null;
  isAi: boolean;
  reconnectTimer?: NodeJS.Timeout;
}

export interface GameRoom {
  lobbyId: string;
  phase: "waiting" | "ready" | "countdown" | "playing" | "paused" | "finished";
  players: Record<PlayerId, RoomPlayer>;
  game: SpeedGameState | null;
  roundWins: Record<PlayerId, number>;
  matchWinTarget: number;
  startAt?: number;
  pausedReason?: string;
  lastActivity: number;
  closeTimer?: NodeJS.Timeout;
  aiTimer?: NodeJS.Timeout;
  aiCursorTimer?: NodeJS.Timeout;
  deadlockTimer?: NodeJS.Timeout;
  aiDifficulty: AiDifficulty;
  solo: boolean;
  roundWinnerId?: PlayerId;
}

const RECONNECT_MS = 30_000;
const START_DELAY_MS = 3_000;
const MATCH_WIN_TARGET = 3;
const AI_PLAYER: PlayerId = "p2";
const AI_LEVELS: Record<AiDifficulty, { readyMin: number; readyMax: number; moveMin: number; moveMax: number; settleMin: number; settleMax: number }> = {
  beginner: { readyMin: 2200, readyMax: 4500, moveMin: 2200, moveMax: 5500, settleMin: 350, settleMax: 900 },
  easy: { readyMin: 1400, readyMax: 3200, moveMin: 1200, moveMax: 3200, settleMin: 220, settleMax: 520 },
  intermediate: { readyMin: 800, readyMax: 2000, moveMin: 700, moveMax: 1900, settleMin: 140, settleMax: 420 },
  experienced: { readyMin: 400, readyMax: 1100, moveMin: 350, moveMax: 1200, settleMin: 80, settleMax: 260 }
};

export const rooms = new Map<string, GameRoom>();

export function createRoom(solo = false, aiDifficulty: AiDifficulty = "easy"): GameRoom {
  const lobbyId = generateLobbyCode();
  const room: GameRoom = {
    lobbyId,
    phase: "waiting",
    players: {
      p1: { id: "p1", name: "Player 1", socket: null, isAi: false },
      p2: { id: "p2", name: solo ? "Computer" : "Player 2", socket: null, isAi: solo }
    },
    game: null,
    roundWins: { p1: 0, p2: 0 },
    matchWinTarget: MATCH_WIN_TARGET,
    lastActivity: Date.now(),
    aiDifficulty,
    solo
  };
  rooms.set(lobbyId, room);
  return room;
}

export function attachPlayer(room: GameRoom, ws: WsLike, name: string): PlayerId | null {
  const requestedName = cleanName(name);
  const existing = (["p1", "p2"] as PlayerId[]).find((id) => !room.players[id].isAi && room.players[id].socket === null && room.players[id].reconnectTimer);
  const openSeat = existing ?? (room.players.p1.socket ? (room.players.p2.socket || room.players.p2.isAi ? null : "p2") : "p1");
  if (!openSeat) return null;

  clearTimeout(room.players[openSeat].reconnectTimer);
  room.players[openSeat].reconnectTimer = undefined;
  room.players[openSeat].socket = ws;
  room.players[openSeat].name = requestedName;
  if (room.phase === "paused" && room.players.p1.socket && (room.players.p2.socket || room.players.p2.isAi)) room.phase = "playing";

  ws.getUserData().lobbyId = room.lobbyId;
  ws.getUserData().playerId = openSeat;
  room.lastActivity = Date.now();

  if (room.players.p1.socket && (room.players.p2.socket || room.players.p2.isAi) && room.phase === "waiting") {
    room.game = createSpeedGame();
    room.phase = "ready";
    if (room.solo) scheduleAiReady(room);
  }
  broadcastState(room);
  maybeResolveDeadlock(room);
  scheduleAiMove(room);
  return openSeat;
}

export function handleMessage(ws: WsLike, message: ClientMessage): void {
  const data = ws.getUserData();
  if (message.type === "create_lobby" || message.type === "create_solo_lobby") {
    const room = createRoom(message.type === "create_solo_lobby", message.type === "create_solo_lobby" ? message.aiDifficulty ?? "easy" : "easy");
    send(ws, { type: "lobby_created", lobbyId: room.lobbyId });
    attachPlayer(room, ws, message.name);
    return;
  }

  if (message.type === "join_lobby") {
    const room = rooms.get(message.lobbyId.trim().toUpperCase());
    if (!room) return send(ws, { type: "error", code: "LOBBY_NOT_FOUND", message: "Lobby not found." });
    if (room.solo) return send(ws, { type: "error", code: "SOLO_LOBBY", message: "That lobby is a solo game." });
    if (room.phase === "finished") return send(ws, { type: "error", code: "LOBBY_CLOSED", message: "Lobby is closed." });
    if (!attachPlayer(room, ws, message.name)) return send(ws, { type: "error", code: "LOBBY_FULL", message: "Lobby is full." });
    return;
  }

  if (!data.lobbyId || !data.playerId) return send(ws, { type: "error", code: "NOT_IN_LOBBY", message: "Join a lobby first." });
  const room = rooms.get(data.lobbyId);
  if (!room) return send(ws, { type: "error", code: "LOBBY_NOT_FOUND", message: "Lobby not found." });
  room.lastActivity = Date.now();

  if (message.type === "quit_game") {
    quitRoom(room, data.playerId);
    data.lobbyId = undefined;
    data.playerId = undefined;
    return;
  }

  if (message.type === "cursor_move") {
    const opponent = data.playerId === "p1" ? "p2" : "p1";
    if (!room.players[opponent].isAi) send(room.players[opponent].socket, { type: "opponent_cursor", x: message.x, y: message.y, draggingCardId: message.draggingCardId });
    return;
  }

  if (!room.game) return send(ws, { type: "error", code: "GAME_NOT_READY", message: "Waiting for another player." });

  if (message.type === "ready") {
    if (room.phase === "paused" && room.pausedReason === "Round won. Choose a middle deck to continue.") {
      room.phase = "ready";
      room.game.players.p1.ready = false;
      room.game.players.p2.ready = false;
      room.startAt = undefined;
      broadcastState(room);
      if (room.solo) scheduleAiReady(room);
      return;
    }
    if (room.phase !== "ready") return;
    const shouldStart = markReady(room.game, data.playerId);
    if (shouldStart) beginCountdown(room);
    else broadcastState(room);
    return;
  }

  if (message.type === "slap_middle_deck") {
    if (room.phase !== "paused" || room.pausedReason !== "Round won. Choose a middle deck to continue.") return send(ws, { type: "error", code: "NOT_ROUND_END", message: "There is no round to slap." });
    if (!room.game) return send(ws, { type: "error", code: "GAME_NOT_READY", message: "Game is not ready." });
    if (message.deck !== "A" && message.deck !== "B") return send(ws, { type: "error", code: "INVALID_DECK", message: "Choose either the A or B middle deck." });
    finishRoundFromSlap(room, data.playerId, message.deck);
    return;
  }

  if (message.type === "choose_middle_deck") {
    if (room.phase !== "paused" || room.pausedReason !== "Round won. Choose a middle deck to continue.") return send(ws, { type: "error", code: "NOT_PAUSED_FOR_DECK", message: "The round is not waiting for a middle-deck choice." });
    if (!room.game) return send(ws, { type: "error", code: "GAME_NOT_READY", message: "Game is not ready." });
    const chosenPile = message.deck;
    if (chosenPile !== "A" && chosenPile !== "B") return send(ws, { type: "error", code: "INVALID_DECK", message: "Choose either the A or B middle deck." });

    if (room.roundWinnerId !== data.playerId) return send(ws, { type: "error", code: "NOT_ROUND_WINNER", message: "Only the round winner can choose the middle deck." });
    const matchWinner = prepareNextRound(room.game, data.playerId, chosenPile);
    room.roundWinnerId = undefined;
    room.pausedReason = undefined;
    room.startAt = undefined;
    if (matchWinner) {
      room.phase = "finished";
      broadcastState(room);
      broadcast(room, { type: "game_over", winnerId: matchWinner });
      closeLater(room);
      return;
    }
    room.phase = "ready";
    room.game.players.p1.ready = false;
    room.game.players.p2.ready = false;
    broadcastState(room);
    if (room.solo) scheduleAiReady(room);
    return;
  }

  if (message.type === "flip_stock_card") {
    if (room.phase !== "playing") return send(ws, { type: "error", code: "NOT_PLAYING", message: "Game is not active." });
    const result = flipStockCard(room.game, data.playerId, message.cardId);
    if (!result.ok) return send(ws, { type: "error", code: "ILLEGAL_FLIP", message: result.error });
    broadcastState(room);
    scheduleAiMove(room);
    return;
  }

  if (message.type === "move_stock_card") {
    if (room.phase !== "playing") return send(ws, { type: "error", code: "NOT_PLAYING", message: "Game is not active." });
    const result = moveStockCard(room.game, data.playerId, message.cardId, message.targetIndex);
    if (!result.ok) return send(ws, { type: "error", code: "ILLEGAL_STOCK_MOVE", message: result.error });
    broadcastState(room);
    return;
  }

  if (message.type === "play_card") {
    if (room.phase !== "playing") return send(ws, { type: "error", code: "NOT_PLAYING", message: "Game is not active." });
    const result = applyMove(room, data.playerId, message.cardId, message.targetPile);
    if (!result.ok) return send(ws, { type: "error", code: "ILLEGAL_MOVE", message: result.error });
  }
}

export function handleDisconnect(ws: WsLike): void {
  const data = ws.getUserData();
  if (!data.lobbyId || !data.playerId) return;
  const room = rooms.get(data.lobbyId);
  if (!room) return;

  if (room.solo) {
    endRoom(room);
    return;
  }

  room.players[data.playerId].socket = null;
  room.lastActivity = Date.now();
  if (room.phase === "playing" || room.phase === "countdown") {
    room.phase = "paused";
    broadcastToast(room, "Opponent disconnected, waiting to reconnect (30s)...");
    broadcastState(room);
    room.players[data.playerId].reconnectTimer = setTimeout(() => {
      if (room.phase === "finished") return;
      const winnerId: PlayerId = data.playerId === "p1" ? "p2" : "p1";
      if (room.game) room.game.winnerId = winnerId;
      room.phase = "finished";
      broadcast(room, { type: "game_over", winnerId });
      closeLater(room);
    }, RECONNECT_MS);
  } else {
    closeLater(room);
  }
}

export function cleanupRooms(maxIdleMs = 300_000): void {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const humanSockets = (["p1", "p2"] as PlayerId[]).filter((id) => !room.players[id].isAi && room.players[id].socket).length;
    if (humanSockets === 0 && now - room.lastActivity > maxIdleMs) endRoom(room);
  }
}

function beginCountdown(room: GameRoom): void {
  room.phase = "countdown";
  room.startAt = Date.now() + START_DELAY_MS;
  broadcastState(room);
  setTimeout(() => {
    if (room.phase !== "countdown" || !room.game) return;
    startGame(room.game);
    if (room.game.phase === "finished") {
      room.phase = "finished";
      broadcastState(room);
      if (room.game.winnerId) broadcast(room, { type: "game_over", winnerId: room.game.winnerId });
      closeLater(room);
      return;
    }
    room.phase = "playing";
    broadcastState(room);
    maybeResolveDeadlock(room);
    scheduleAiMove(room);
  }, START_DELAY_MS);
}

function applyMove(room: GameRoom, playerId: PlayerId, cardId: string, targetPile: PileId): { ok: true } | { ok: false; error: string } {
  if (!room.game) return { ok: false, error: "Game is not ready" };
  const result = playCard(room.game, playerId, cardId, targetPile);
  if (!result.ok) {
    maybeResolveDeadlock(room);
    broadcastState(room);
    if (room.solo && playerId === AI_PLAYER && room.phase === "playing") {
      setTimeout(() => scheduleAiMove(room), 50);
    }
    return { ok: false, error: result.error };
  }
  if (result.won) {
    const player = room.game.players[playerId];
    const oneMiddleDeckRemaining = room.game.singleCenter || ((room.game.pileA.length > 0) !== (room.game.pileB.length > 0));
    if (oneMiddleDeckRemaining && player.stock.length === 0 && player.stockPiles.every((pile) => pile.length === 0)) {
      room.phase = "finished";
      room.game.phase = "finished";
      room.game.winnerId = playerId;
      clearAiTimers(room);
      broadcastState(room);
      broadcast(room, { type: "game_over", winnerId: playerId });
      closeLater(room);
      return { ok: true };
    }
    room.phase = "paused";
    room.roundWinnerId = playerId;

    room.pausedReason = "Round won. Choose a middle deck to continue.";
    room.startAt = undefined;
    clearAiTimers(room);
    broadcastToast(room, `Round won by ${room.players[playerId].name}. Choose a middle deck to continue.`);
    broadcastState(room);
    if (room.solo && playerId === AI_PLAYER) scheduleAiRoundChoice(room);
    return { ok: true };
  }
  broadcastState(room);
  maybeResolveDeadlock(room);
  scheduleAiMove(room);
  return { ok: true };
}

function finishRoundFromSlap(room: GameRoom, playerId: PlayerId, deck: PileId): void {
  if (!room.game) return;
  const winner = prepareNextRound(room.game, playerId, deck);
  room.roundWinnerId = undefined;
  room.pausedReason = undefined;
  room.startAt = undefined;
  if (winner) {
    room.phase = "finished";
    broadcastState(room);
    broadcast(room, { type: "game_over", winnerId: winner });
    closeLater(room);
    return;
  }
  room.phase = "ready";
  room.game.players.p1.ready = false;
  room.game.players.p2.ready = false;
  broadcastState(room);
  if (room.solo) scheduleAiReady(room);
}

function scheduleAiRoundChoice(room: GameRoom): void {
  setTimeout(() => {
    if (!room.game || room.phase !== "paused" || room.roundWinnerId !== AI_PLAYER) return;
    const winner = prepareNextRound(room.game, AI_PLAYER, Math.random() < 0.5 ? "A" : "B");
    room.roundWinnerId = undefined; room.pausedReason = undefined; room.startAt = undefined;
    if (winner) { room.phase = "finished"; broadcastState(room); broadcast(room, { type: "game_over", winnerId: winner }); closeLater(room); return; }
    room.phase = "ready"; room.game.players.p1.ready = false; room.game.players.p2.ready = false;
    broadcastState(room); scheduleAiReady(room);
  }, 500);
}

function scheduleAiReady(room: GameRoom): void {
  if (!room.solo || !room.game) return;
  const config = AI_LEVELS[room.aiDifficulty ?? "easy"];
  const delay = randomInt(config.readyMin, config.readyMax);
  room.aiTimer = setTimeout(() => {
    room.aiTimer = undefined;
    if (room.phase !== "ready" || !room.game) return;
    const shouldStart = markReady(room.game, AI_PLAYER);
    if (shouldStart) beginCountdown(room);
    else broadcastState(room);
  }, delay);
}

function scheduleAiMove(room: GameRoom): void {
  if (!room.solo || !room.game || room.phase !== "playing" || room.aiTimer) return;
  const ai = room.game.players[AI_PLAYER];
  const emptyIndex = ai.stockPiles.findIndex((pile) => pile.length === 0 && ai.stockPiles.some((candidate) => candidate.length > 1 && (ai.faceUpCards?.has(candidate[candidate.length - 1].id) ?? true)));
  if (emptyIndex >= 0) {
    const donor = ai.stockPiles.find((pile, index) => index !== emptyIndex && pile.length > 1 && (ai.faceUpCards?.has(pile[pile.length - 1].id) ?? true));
    if (donor) {
      moveStockCard(room.game, AI_PLAYER, donor[donor.length - 1].id, emptyIndex);
      broadcastState(room);
      scheduleAiMove(room);
      return;
    }
  }
  const moves = getLegalMoves(room.game, AI_PLAYER);
  if (moves.length === 0) {
    const hidden = ai.stockPiles.find((pile) => pile.length > 0 && !(ai.faceUpCards?.has(pile[pile.length - 1].id) ?? true));
    if (hidden) {
      flipStockCard(room.game, AI_PLAYER, hidden[hidden.length - 1].id);
      broadcastState(room);
      scheduleAiMove(room);
    } else maybeResolveDeadlock(room);
    return;
  }

  const config = AI_LEVELS[room.aiDifficulty ?? "easy"];
  const selected = moves[Math.floor(Math.random() * moves.length)];
  const reactionMs = randomInt(config.moveMin, config.moveMax) + Math.min(900, Math.max(0, 5 - moves.length) * 150);
  const settleMs = randomInt(config.settleMin, config.settleMax);
  sendAiCursor(room, selected.card.id, selected.targetPile, reactionMs);
  room.aiTimer = setTimeout(() => {
    room.aiTimer = undefined;
    if (room.phase !== "playing" || !room.game) return;
    applyMove(room, AI_PLAYER, selected.card.id, selected.targetPile);
  }, reactionMs + settleMs);
}

function sendAiCursor(room: GameRoom, cardId: string, targetPile: PileId, durationMs: number): void {
  clearTimeout(room.aiCursorTimer);
  const socket = room.players.p1.socket;
  if (!socket) return;
  const start = { x: randomFloat(0.28, 0.72), y: randomFloat(0.80, 0.90) };
  const end = { x: targetPile === "A" ? 0.38 : 0.62, y: 0.52 };
  const steps = Math.max(4, Math.floor(durationMs / 140));
  let step = 0;
  const tick = () => {
    if (room.phase !== "playing" || !room.players.p1.socket) return;
    const t = Math.min(1, step / steps);
    const wobble = Math.sin(t * Math.PI * 3) * 0.025;
    send(room.players.p1.socket, {
      type: "opponent_cursor",
      x: start.x + (end.x - start.x) * t + wobble,
      y: start.y + (end.y - start.y) * t,
      draggingCardId: cardId
    });
    step += 1;
    if (step <= steps) room.aiCursorTimer = setTimeout(tick, 120);
    else send(room.players.p1.socket, { type: "opponent_cursor", x: end.x, y: end.y, draggingCardId: null });
  };
  tick();
}

function quitRoom(room: GameRoom, quitterId: PlayerId): void {
  const quitter = room.players[quitterId];
  const opponentId: PlayerId = quitterId === "p1" ? "p2" : "p1";

  if (room.solo) {
    endRoom(room);
    return;
  }

  quitter.socket = null;
  clearTimeout(quitter.reconnectTimer);
  quitter.reconnectTimer = undefined;

  if (room.phase === "playing" || room.phase === "paused") {
    const winnerId = opponentId;
    if (room.game) room.game.winnerId = winnerId;
    room.phase = "finished";
    broadcastToast(room, `${quitter.name} quit the game.`);
    broadcastState(room);
    broadcast(room, { type: "game_over", winnerId });
    closeLater(room);
    return;
  }

  if (room.phase === "waiting") {
    endRoom(room);
    return;
  }

  const quitterName = quitter.name;
  room.phase = "waiting";
  room.startAt = undefined;
  if (room.game) {
    room.game.players.p1.ready = false;
    room.game.players.p2.ready = false;
  }
  room.players[quitterId].name = quitterId === "p1" ? "Player 1" : "Player 2";
  broadcastToast(room, `${quitterName} left the lobby.`);
  broadcastState(room);
}

function maybeResolveDeadlock(room: GameRoom): void {
  if (!room.game || room.phase !== "playing") return;
  if (!isDeadlocked(room.game)) return;
  if ((["p1", "p2"] as PlayerId[]).some((id) => room.game!.players[id].stockPiles.some((pile) => pile.length > 0 && !(room.game!.players[id].faceUpCards?.has(pile[pile.length - 1].id) ?? true)))) return;
  if (room.deadlockTimer) return;

  room.phase = "paused";
  room.pausedReason = "No more legal moves available. It is time to spit!";
  room.startAt = Date.now() + 5000;
  broadcastState(room);
  room.deadlockTimer = setTimeout(() => {
    room.deadlockTimer = undefined;
    if (!room.game || room.phase !== "paused") return;
    const result = resolveDeadlock(room.game);
    if (result === "none") {
      room.phase = "finished";
      const p1Cards = room.game.players.p1.stock.length + room.game.players.p1.stockPiles.flat().length;
      const p2Cards = room.game.players.p2.stock.length + room.game.players.p2.stockPiles.flat().length;
      const winnerId: PlayerId = p1Cards <= p2Cards ? "p1" : "p2";
      room.game.winnerId = winnerId;
      broadcastState(room);
      broadcast(room, { type: "game_over", winnerId });
      closeLater(room);
      return;
    }
    room.phase = "playing";
    room.pausedReason = undefined;
    room.startAt = undefined;
    if (result === "flipped") broadcastToast(room, "New spit cards flipped.");
    if (result === "reshuffled") broadcastToast(room, "Battle discards reshuffled.");
    broadcastState(room);
    scheduleAiMove(room);
  }, 5000);
}

function broadcastState(room: GameRoom): void {
  if (!room.game) return;
  const connected = {
    p1: Boolean(room.players.p1.socket) || room.players.p1.isAi,
    p2: Boolean(room.players.p2.socket) || room.players.p2.isAi
  };
  const names = { p1: room.players.p1.name, p2: room.players.p2.name };
  for (const id of ["p1", "p2"] as PlayerId[]) {
    if (!room.players[id].isAi) send(room.players[id].socket, makeStateUpdate(room.game, room.lobbyId, id, room.phase, connected, names, room.startAt, room.pausedReason));
  }
}

function broadcastToast(room: GameRoom, message: string): void {
  broadcast(room, { type: "toast", message });
}

function broadcast(room: GameRoom, message: ServerMessage): void {
  if (!room.players.p1.isAi) send(room.players.p1.socket, message);
  if (!room.players.p2.isAi) send(room.players.p2.socket, message);
}

function send(ws: WsLike | null, message: ServerMessage): void {
  if (ws) ws.send(JSON.stringify(message));
}

function closeLater(room: GameRoom): void {
  clearTimeout(room.closeTimer);
  clearAiTimers(room);
  room.closeTimer = setTimeout(() => endRoom(room), 60_000);
}

function endRoom(room: GameRoom): void {
  clearTimeout(room.closeTimer);
  clearAiTimers(room);
  rooms.delete(room.lobbyId);
}

function clearAiTimers(room: GameRoom): void {
  clearTimeout(room.aiTimer);
  clearTimeout(room.aiCursorTimer);
  clearTimeout(room.deadlockTimer);
  room.aiTimer = undefined;
  room.aiCursorTimer = undefined;
  room.deadlockTimer = undefined;
}

function cleanName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 18);
  return cleaned || "Player";
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function generateLobbyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms.has(code)) return code;
  }
}
