import type { Card, PileId, PlayerId, StateUpdate } from "@speed/shared";
import { createDeck, shuffle } from "./deck.js";

export interface PlayerGameState {
  hand: Card[];
  stock: Card[];
  stockPiles: Card[][];
  collected: Card[];
  ready: boolean;
  faceUpCards?: Set<string>;
}

export interface SpeedGameState {
  phase: "ready" | "playing" | "finished";
  players: Record<PlayerId, PlayerGameState>;
  centerA: Card[];
  centerB: Card[];
  pileA: Card[];
  pileB: Card[];
  winnerId?: PlayerId;
  singleCenter?: boolean;
}

export function createSpeedGame(random = Math.random): SpeedGameState {
  const deck = shuffle(createDeck(), random);
  const dealPlayer = (): { hand: Card[]; stock: Card[]; stockPiles: Card[][]; collected: Card[]; faceUpCards: Set<string> } => {
    const stockPiles = [
      deck.splice(0, 1),
      deck.splice(0, 2),
      deck.splice(0, 3),
      deck.splice(0, 4),
      deck.splice(0, 5)
    ];
    const stock = deck.splice(0, 11);
    return {
      hand: topCards(stockPiles),
      stock,
      stockPiles,
      collected: [],
      faceUpCards: new Set(stockPiles.map((pile) => pile[pile.length - 1]?.id).filter((id): id is string => Boolean(id)))
    };
  };

  const p1 = dealPlayer();
  const p2 = dealPlayer();

  return {
    phase: "ready",
    players: {
      p1: { ...p1, ready: false },
      p2: { ...p2, ready: false }
    },
    centerA: [],
    centerB: [],
    pileA: [],
    pileB: []
  };
}

export function markReady(game: SpeedGameState, playerId: PlayerId): boolean {
  game.players[playerId].ready = true;
  if (game.players.p1.ready && game.players.p2.ready && game.phase === "ready") return true;
  return false;
}

export function startGame(game: SpeedGameState): void {
  if (game.phase !== "ready") return;
  const a = game.players.p1.stock.pop();
  const b = game.singleCenter ? undefined : game.players.p2.stock.pop();
  if (a) game.pileA.push(a);
  if (b) game.pileB.push(b);
  if (!a && !b) {
    const fallback = takeTableauSeed(game.players.p1) ?? takeTableauSeed(game.players.p2);
    if (fallback) game.pileA.push(fallback);
    else { game.phase = "finished"; return; }
  }
  game.phase = "playing";
}

export function canPlayOn(card: Card, top: Card | null): boolean {
  if (!top) return false;
  const wrapped = (card.rank - top.rank + 13) % 13;
  return wrapped === 1 || wrapped === 12;
}

export function getLegalMoves(game: SpeedGameState, playerId: PlayerId): Array<{ card: Card; targetPile: PileId }> {
  const pileA = topOf(game.pileA);
  const pileB = topOf(game.pileB);
  const moves: Array<{ card: Card; targetPile: PileId }> = [];
  for (const card of game.players[playerId].hand) {
    if (canPlayOn(card, pileA)) moves.push({ card, targetPile: "A" });
    if (!game.singleCenter && canPlayOn(card, pileB)) moves.push({ card, targetPile: "B" });
  }
  return moves;
}

export function hasLegalMove(game: SpeedGameState, playerId: PlayerId): boolean {
  return getLegalMoves(game, playerId).length > 0;
}

export function isDeadlocked(game: SpeedGameState): boolean {
  return game.phase === "playing" && !hasLegalMove(game, "p1") && !hasLegalMove(game, "p2");
}

export function playCard(game: SpeedGameState, playerId: PlayerId, cardId: string, targetPile: PileId): { ok: true; won: boolean } | { ok: false; error: string } {
  if (game.phase !== "playing") return { ok: false, error: "Game is not playing" };
  const player = game.players[playerId];
  const cardIndex = player.hand.findIndex((card) => card.id === cardId);
  if (cardIndex === -1) return { ok: false, error: "Card is not in your hand" };
  if (game.singleCenter && targetPile !== "A") return { ok: false, error: "Only the shared center pile is active" };
  const pile = targetPile === "A" ? game.pileA : game.pileB;
  const card = player.hand[cardIndex];
  if (!canPlayOn(card, topOf(pile))) return { ok: false, error: "Illegal rank for target pile" };

  const sourcePileIndex = player.stockPiles.findIndex((stack) => stack.length > 0 && stack[stack.length - 1].id === card.id && isFaceUp(player, card.id));
  if (sourcePileIndex === -1) return { ok: false, error: "Card is not available from a visible stockpile" };

  const sourcePile = player.stockPiles[sourcePileIndex];
  sourcePile.pop();
  player.faceUpCards?.delete(card.id);
  consolidateStockpile(player, sourcePileIndex);
  player.hand.splice(cardIndex, 1);
  pile.push(card);
  refillHand(player);
  return { ok: true, won: player.stockPiles.every((stack) => stack.length === 0) };
}

export function refillHand(player: PlayerGameState): void {
  player.hand = topCards(player.stockPiles ?? []).filter((card) => player.faceUpCards ? player.faceUpCards.has(card.id) : true);
}

export function moveStockCard(game: SpeedGameState, playerId: PlayerId, cardId: string, targetIndex: number): { ok: true } | { ok: false; error: string } {
  const player = game.players[playerId];
  if (targetIndex < 0 || targetIndex >= player.stockPiles.length) return { ok: false, error: "Target slot does not exist" };

  const fromIndex = player.stockPiles.findIndex((pile) => pile.length > 0 && pile[pile.length - 1].id === cardId && (player.faceUpCards ? player.faceUpCards.has(cardId) : true));
  if (fromIndex === -1) return { ok: false, error: "Card is not available from the top of a stockpile" };
  if (fromIndex === targetIndex) return { ok: false, error: "Cannot move a card onto the same slot" };

  const sourcePile = player.stockPiles[fromIndex];
  const targetPile = player.stockPiles[targetIndex];
  if (targetPile.length !== 0) return { ok: false, error: "Target slot is not empty" };

  const [card] = sourcePile.splice(sourcePile.length - 1, 1);
  targetPile.push(card);
  if (!player.faceUpCards) player.faceUpCards = new Set();
  player.faceUpCards.add(card.id);
  refillHand(player);
  return { ok: true };
}

export function resolveDeadlock(game: SpeedGameState, random = Math.random): "flipped" | "reshuffled" | "none" {
  if (!isDeadlocked(game)) return "none";
  const a = game.players.p1.stock.pop();
  const b = game.players.p2.stock.pop();
  if (game.singleCenter) {
    const next = a ?? b;
    if (next) game.pileA.push(next);
    return next ? "flipped" : "none";
  }
  if (a || b) {
    if (a) game.pileA.push(a);
    if (b) game.pileB.push(b);
    return "flipped";
  }

  // Rare standard Speed recovery: keep each battle pile's visible top in place,
  // reshuffle all older battle cards into small center decks, then flip one onto
  // each pile if everyone is still stuck.
  const aTop = game.pileA.pop();
  const bTop = game.pileB.pop();
  const recycled = shuffle([...game.pileA, ...game.pileB, ...game.centerA, ...game.centerB], random);

  if (aTop) game.pileA.push(aTop);
  else game.pileA = [];
  if (bTop) game.pileB.push(bTop);
  else game.pileB = [];

  game.centerA = recycled.filter((_, index) => index % 2 === 0);
  game.centerB = recycled.filter((_, index) => index % 2 === 1);

  const nextA = game.centerA.pop();
  const nextB = game.centerB.pop();
  if (nextA && nextB) {
    game.pileA.push(nextA);
    game.pileB.push(nextB);
    return "reshuffled";
  }
  return "none";
}

export function makeStateUpdate(game: SpeedGameState, lobbyId: string, playerId: PlayerId, roomPhase: StateUpdate["phase"], connected: Record<PlayerId, boolean>, names: Record<PlayerId, string>, startAt?: number, pausedReason?: string): StateUpdate {
  const opponentId = playerId === "p1" ? "p2" : "p1";
  const player = game.players[playerId];
  const opponent = game.players[opponentId];
  return {
    type: "state_update",
    lobbyId,
    playerId,
    phase: roomPhase,
    players: (["p1", "p2"] as PlayerId[]).map((id) => ({ id, name: names[id], connected: connected[id], ready: game.players[id].ready, isAi: names[id] === "Computer" || undefined })),
    yourHand: player.hand,
    yourStockPiles: player.stockPiles,
    opponentStockPiles: opponent.stockPiles,
    yourStockCount: player.stock.length,
    opponentHandCount: opponent.hand.length,
    opponentStockCount: opponent.stock.length,
    pileA_top: topOf(game.pileA),
    pileB_top: topOf(game.pileB),
    pileA_count: game.pileA.length,
    pileB_count: game.pileB.length,
    centerA_count: game.centerA.length,
    centerB_count: game.centerB.length,
    yourFaceUpCards: [...(player.faceUpCards ?? [])],
    opponentFaceUpCards: [...(opponent.faceUpCards ?? [])],
    singleCenter: game.singleCenter,
    startAt,
    winnerId: game.winnerId,
    pausedReason: roomPhase === "paused" ? pausedReason : undefined
  };
}

function topCards(stockPiles: Card[][]): Card[] {
  return stockPiles.filter((pile) => pile.length > 0).map((pile) => pile[pile.length - 1]);
}

export function flipStockCard(game: SpeedGameState, playerId: PlayerId, cardId: string): { ok: true } | { ok: false; error: string } {
  if (game.phase !== "playing") return { ok: false, error: "Game is not playing" };
  const player = game.players[playerId];
  if (!player.stockPiles.some((pile) => pile.at(-1)?.id === cardId)) return { ok: false, error: "Card is not the top of a stockpile" };
  if (player.faceUpCards?.has(cardId)) return { ok: false, error: "Card is already face up" };
  if (!player.faceUpCards) player.faceUpCards = new Set();
  player.faceUpCards.add(cardId);
  refillHand(player);
  return { ok: true };
}

export function prepareNextRound(game: SpeedGameState, roundWinnerId: PlayerId, chosenPile: PileId): PlayerId | null {
  const otherId: PlayerId = roundWinnerId === "p1" ? "p2" : "p1";
  const winner = game.players[roundWinnerId];
  const other = game.players[otherId];
  game.pileA.push(...game.centerA.splice(0));
  game.pileB.push(...game.centerB.splice(0));
  const chosen = chosenPile === "A" ? game.pileA.splice(0) : game.pileB.splice(0);
  const remaining = chosenPile === "A" ? game.pileB.splice(0) : game.pileA.splice(0);
  winner.stock.push(...chosen, ...winner.stockPiles.flat());
  other.stock.push(...remaining, ...other.stockPiles.flat());
  winner.stockPiles = []; other.stockPiles = []; winner.hand = []; other.hand = [];
  winner.faceUpCards = new Set(); other.faceUpCards = new Set();
  game.pileA = []; game.pileB = []; game.centerA = []; game.centerB = [];
  if (winner.stock.length === 0) { game.phase = "finished"; game.winnerId = roundWinnerId; return roundWinnerId; }
  const deal = (player: PlayerGameState) => {
    let remainingCards = player.stock.length;
    player.stockPiles = [1, 2, 3, 4, 5].map((size) => { const take = Math.min(size, remainingCards); remainingCards -= take; return player.stock.splice(0, take); }).filter((pile) => pile.length > 0);
    player.faceUpCards = new Set(player.stockPiles.map((pile) => pile.at(-1)?.id).filter((id): id is string => Boolean(id)));
    refillHand(player);
  };
  game.singleCenter = winner.stock.length <= 15 || other.stock.length <= 15;
  deal(winner); deal(other); game.phase = "ready"; return null;
}

function takeTableauSeed(player: PlayerGameState): Card | null {
  const pile = player.stockPiles.find((stack) => stack.length > 0);
  const card = pile?.pop() ?? null;
  if (card) { player.faceUpCards?.delete(card.id); refillHand(player); }
  return card;
}

function consolidateStockpile(player: PlayerGameState, emptyIndex: number): void {
  if (player.stockPiles[emptyIndex].length !== 0) return;
  const donorIndex = player.stockPiles.findIndex((pile, index) => index !== emptyIndex && pile.length > 0);
  if (donorIndex === -1) return;
  const moved = player.stockPiles[donorIndex].pop();
  if (moved) player.stockPiles[emptyIndex].push(moved);
}

function isFaceUp(player: PlayerGameState, cardId: string): boolean {
  return player.faceUpCards ? player.faceUpCards.has(cardId) : true;
}

function topOf(cards: Card[]): Card | null {
  return cards.length ? cards[cards.length - 1] : null;
}
