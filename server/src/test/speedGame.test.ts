import { describe, expect, it } from "vitest";
import type { Card } from "@speed/shared";
import { canPlayOn, createSpeedGame, hasLegalMove, isDeadlocked, moveStockCard, playCard, refillHand, resolveDeadlock, startGame, type PlayerGameState, type SpeedGameState } from "../game/speedGame.js";
import { createRoom, handleMessage, rooms } from "../net/room.js";

const c = (id: string, rank: Card["rank"]): Card => ({ id, rank, suit: "S" });

describe("speed game rules", () => {
  it("allows Ace to wrap both ways around the King and 2", () => {
    expect(canPlayOn(c("2", 2), c("A", 1))).toBe(true);
    expect(canPlayOn(c("A", 1), c("2", 2))).toBe(true);
    expect(canPlayOn(c("K", 13), c("A", 1))).toBe(true);
    expect(canPlayOn(c("A", 1), c("K", 13))).toBe(true);
    expect(canPlayOn(c("9", 9), c("7", 7))).toBe(false);
  });

  it("reveals only the visible stockpile tops and never auto-refills from the hidden spit pile", () => {
    const player: PlayerGameState = {
      ready: false,
      hand: [c("top-1", 3)],
      stock: [c("spit-1", 5), c("spit-2", 6), c("spit-3", 7)],
      stockPiles: [[c("pile-1", 3), c("pile-2", 4)], [c("pile-a", 9)]],
      collected: []
    };
    refillHand(player);
    expect(player.hand.map((card) => card.id)).toEqual(["pile-2", "pile-a"]);
    expect(player.stock).toHaveLength(3);
  });

  it("plays a legal card, rejects an illegal card, and advances the visible stockpile tops", () => {
    const game = fixtureGame();
    const ok = playCard(game, "p1", "p1-4", "A");
    expect(ok).toEqual({ ok: true, won: false });
    expect(game.pileA.at(-1)?.id).toBe("p1-4");
    expect(game.players.p1.hand).toHaveLength(4);
    const bad = playCard(game, "p1", "p1-9", "A");
    expect(bad.ok).toBe(false);
  });

  it("detects and resolves deadlock by flipping center cards", () => {
    const game = fixtureGame();
    game.players.p1.hand = [c("p1-11", 11)];
    game.players.p2.hand = [c("p2-11", 11)];
    game.players.p1.stock = [c("ca", 6)];
    game.players.p2.stock = [c("cb", 7)];
    expect(hasLegalMove(game, "p1")).toBe(false);
    expect(isDeadlocked(game)).toBe(true);
    expect(resolveDeadlock(game)).toBe("flipped");
    expect(game.pileA.at(-1)?.id).toBe("ca");
    expect(game.pileB.at(-1)?.id).toBe("cb");
  });

  it("declares win immediately on final validated move", () => {
    const game = fixtureGame();
    game.players.p1.hand = [c("last", 4)];
    game.players.p1.stock = [];
    game.players.p1.stockPiles = [[c("last", 4)]];
    const result = playCard(game, "p1", "last", "A");
    expect(result).toEqual({ ok: true, won: true });
    expect(game.winnerId).toBeUndefined();
    expect(game.phase).toBe("playing");
  });

  it("deals all 52 cards in the full Spit setup before start", () => {
    const game = createSpeedGame(() => 0.5);
    expect(game.players.p1.hand).toHaveLength(5);
    expect(game.players.p2.hand).toHaveLength(5);
    expect(game.players.p1.stock).toHaveLength(11);
    expect(game.players.p2.stock).toHaveLength(11);
    expect(game.players.p1.stockPiles.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5]);
    expect(game.players.p2.stockPiles.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5]);
    expect(game.centerA).toHaveLength(0);
    expect(game.centerB).toHaveLength(0);
    expect(
      game.players.p1.stock.length +
      game.players.p1.stockPiles.reduce((sum, pile) => sum + pile.length, 0) +
      game.players.p2.stock.length +
      game.players.p2.stockPiles.reduce((sum, pile) => sum + pile.length, 0)
    ).toBe(52);
    startGame(game);
    expect(game.pileA).toHaveLength(1);
    expect(game.pileB).toHaveLength(1);
    expect(game.players.p1.stock).toHaveLength(10);
    expect(game.players.p2.stock).toHaveLength(10);
  });

  it("keeps the match alive across rounds and only ends on the overall match win", () => {
    const room = createRoom(true, "easy");
    const messages: string[] = [];
    const ws = {
      getUserData: () => ({ lobbyId: room.lobbyId, playerId: "p1" as const }),
      send: (message: string) => {
        messages.push(message);
        return 1;
      }
    };

    room.players.p1.socket = ws;
    room.phase = "playing";
    room.roundWins = { p1: 0, p2: 0 };
    room.game = {
      phase: "playing",
      players: {
        p1: { ready: true, hand: [c("last", 4)], stock: [c("remain", 9)], stockPiles: [[c("last", 4)]], collected: [] },
        p2: { ready: true, hand: [], stock: [], stockPiles: [], collected: [] }
      },
      centerA: [],
      centerB: [],
      pileA: [c("a", 3)],
      pileB: [c("b", 8)]
    };

    handleMessage(ws, { type: "play_card", cardId: "last", targetPile: "A" });

    expect(room.roundWins.p1).toBe(0);
    expect(room.roundWinnerId).toBe("p1");
    expect(room.phase).toBe("paused");
    expect(room.pausedReason).toBe("Round won. Choose a middle deck to continue.");
    expect(rooms.has(room.lobbyId)).toBe(true);
    expect(messages.some((message) => message.includes('"type":"game_over"'))).toBe(false);
  });

  it("lets the round winner claim the middle deck and re-deals both players", () => {
    const room = createRoom(true, "easy");
    const ws = {
      getUserData: () => ({ lobbyId: room.lobbyId, playerId: "p1" as const }),
      send: () => 1
    };

    room.players.p1.socket = ws;
    room.phase = "paused";
    room.roundWinnerId = "p1";
    room.pausedReason = "Round won. Choose a middle deck to continue.";
    room.game = {
      phase: "playing",
      players: {
        p1: { ready: true, hand: [], stock: [c("spit-1", 5), c("spit-2", 6)], stockPiles: [], collected: [] },
        p2: { ready: true, hand: [], stock: [], stockPiles: [], collected: [] }
      },
      centerA: [],
      centerB: [],
      pileA: [c("a", 3)],
      pileB: [c("b", 8)]
    };

    handleMessage(ws, { type: "choose_middle_deck", deck: "A" });

    expect(room.game.players.p1.stock).toHaveLength(0);
    expect(room.game.players.p1.stockPiles.map((pile) => pile.length)).toEqual([1, 2]);
    expect(room.phase).toBe("ready");
  });

  it("moves a visible card onto an empty stockpile slot and reveals the next hidden card", () => {
    const game = fixtureGame();
    game.players.p1.stockPiles = [[c("bottom", 2), c("top", 7)], []];
    const result = moveStockCard(game, "p1", "top", 1);

    expect(result.ok).toBe(true);
    expect(game.players.p1.stockPiles[0]).toEqual([c("bottom", 2)]);
    expect(game.players.p1.stockPiles[1]).toEqual([c("top", 7)]);
  });

  it("keeps the middle pile counts from collapsing to one card during a deadlock reshuffle", () => {
    const game = fixtureGame();
    game.players.p1.hand = [c("p1-11", 11)];
    game.players.p2.hand = [c("p2-11", 11)];
    game.pileA = [c("a1", 5), c("a2", 6), c("a3", 7)];
    game.pileB = [c("b1", 9), c("b2", 10), c("b3", 11)];
    game.centerA = [];
    game.centerB = [];
    game.players.p1.stock = [];
    game.players.p2.stock = [];

    const beforeA = game.pileA.length;
    const beforeB = game.pileB.length;
    const result = resolveDeadlock(game);

    expect(result).toBe("reshuffled");
    expect(game.pileA.length).toBeGreaterThan(1);
    expect(game.pileB.length).toBeGreaterThan(1);
    expect(game.pileA.length).toBeLessThanOrEqual(beforeA + 1);
    expect(game.pileB.length).toBeLessThanOrEqual(beforeB + 1);
  });
});

function fixtureGame(): SpeedGameState {
  return {
    phase: "playing",
    players: {
      p1: {
        ready: true,
        hand: [c("p1-4", 4), c("p1-9", 9), c("p1-10", 10), c("p1-11", 11), c("p1-12", 12)],
        stock: [c("stock", 5)],
        stockPiles: [[c("p1-4", 4)], [{ id: "p1-9", rank: 9, suit: "S" }], [{ id: "p1-10", rank: 10, suit: "S" }], [{ id: "p1-11", rank: 11, suit: "S" }], [{ id: "p1-12", rank: 12, suit: "S" }]],
        collected: []
      },
      p2: {
        ready: true,
        hand: [c("p2-9", 9)],
        stock: [],
        stockPiles: [[c("p2-9", 9)]],
        collected: []
      }
    },
    centerA: [],
    centerB: [],
    pileA: [c("a", 3)],
    pileB: [c("b", 8)]
  };
}
