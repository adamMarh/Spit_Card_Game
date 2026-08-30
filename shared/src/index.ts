export type Suit = "C" | "D" | "H" | "S";
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type PileId = "A" | "B";
export type PlayerId = "p1" | "p2";
export type AiDifficulty = "beginner" | "easy" | "intermediate" | "experienced";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type RoomPhase = "waiting" | "ready" | "countdown" | "playing" | "paused" | "finished";

export interface PublicPlayerState {
  id: PlayerId;
  name: string;
  connected: boolean;
  ready: boolean;
  isAi?: boolean;
}

export interface StateUpdate {
  type: "state_update";
  lobbyId: string;
  playerId: PlayerId;
  phase: RoomPhase;
  players: PublicPlayerState[];
  yourHand: Card[];
  yourStockPiles: Card[][];
  opponentStockPiles: Card[][];
  yourStockCount: number;
  opponentHandCount: number;
  opponentStockCount: number;
  pileA_top: Card | null;
  pileB_top: Card | null;
  pileA_count: number;
  pileB_count: number;
  centerA_count: number;
  centerB_count: number;
  yourFaceUpCards: string[];
  opponentFaceUpCards: string[];
  singleCenter?: boolean;
  startAt?: number;
  winnerId?: PlayerId;
  pausedReason?: string;
}

export type ClientMessage =
  | { type: "create_lobby"; name: string }
  | { type: "create_solo_lobby"; name: string; aiDifficulty?: AiDifficulty }
  | { type: "join_lobby"; lobbyId: string; name: string }
  | { type: "ready" }
  | { type: "quit_game" }
  | { type: "choose_middle_deck"; deck: PileId }
  | { type: "slap_middle_deck"; deck: PileId }
  | { type: "move_stock_card"; cardId: string; targetIndex: number }
  | { type: "flip_stock_card"; cardId: string }
  | { type: "play_card"; cardId: string; targetPile: PileId }
  | { type: "cursor_move"; x: number; y: number; draggingCardId: string | null };

export type ServerMessage =
  | { type: "lobby_created"; lobbyId: string }
  | StateUpdate
  | { type: "game_over"; winnerId: PlayerId }
  | { type: "opponent_cursor"; x: number; y: number; draggingCardId: string | null }
  | { type: "toast"; message: string }
  | { type: "error"; code: string; message: string };

export const rankLabel = (rank: Rank): string => {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
};
