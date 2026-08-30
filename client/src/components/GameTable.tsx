import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Card, PileId } from "@speed/shared";
import { useGameStore } from "../store/gameStore";
import { CardView } from "./CardView";
import { DraggableCard } from "./DraggableCard";

export function GameTable() {
  const state = useGameStore((s) => s.state);
  const ready = useGameStore((s) => s.ready);
  const quitGame = useGameStore((s) => s.quitGame);
  const playCard = useGameStore((s) => s.playCard);
  const moveStockCard = useGameStore((s) => s.moveStockCard);
  const flipStockCard = useGameStore((s) => s.flipStockCard);
  const send = useGameStore((s) => s.send);
  const toast = useGameStore((s) => s.toast);
  const pendingCardId = useGameStore((s) => s.pendingCardId);
  const opponentCursor = useGameStore((s) => s.opponentCursor);
  const raf = useRef<number | null>(null);
  const queued = useRef<{ x: number; y: number; draggingCardId: string | null } | null>(null);

  const [countdown, setCountdown] = useState("3");

  useEffect(() => {
    if (!state?.startAt || (state.phase !== "countdown" && state.phase !== "paused")) return;
    const id = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((state.startAt! - Date.now()) / 1000));
      setCountdown(seconds ? String(seconds) : (state.phase === "countdown" ? "Go" : "0"));
    }, 100);
    return () => window.clearInterval(id);
  }, [state?.startAt, state?.phase]);

  if (!state) return null;

  const me = state.players.find((player) => player.id === state.playerId);
  const opponent = state.players.find((player) => player.id !== state.playerId);
  const showReadyPanel = state.phase === "waiting" || state.phase === "ready" || state.phase === "countdown";
  const showPausePanel = state.phase === "paused" && Boolean(state.pausedReason);
  const showRoundSlap = state.phase === "paused" && state.pausedReason === "Round won. Choose a middle deck to continue.";
  const pauseCountdown = state.phase === "paused" && state.startAt ? Math.max(0, Math.ceil((state.startAt - Date.now()) / 1000)) : null;

  const sendCursor = (x: number, y: number, draggingCardId: string | null) => {
    queued.current = { x: x / window.innerWidth, y: y / window.innerHeight, draggingCardId };
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (queued.current) send({ type: "cursor_move", ...queued.current });
    });
  };

  const drop = (cardId: string, target: PileId | null, stockIndex: number | null) => {
    if (target) playCard(cardId, target);
    else if (stockIndex !== null) moveStockCard(cardId, stockIndex);
  };

  const slapDeck = (deck: PileId) => {
    send({ type: "slap_middle_deck", deck });
  };

  return (
    <main className="table-felt relative grid h-full grid-rows-[auto_1fr_auto] overflow-hidden px-8 py-5">
      <header className="flex items-center justify-between text-sm text-emerald-50/80">
        <div className="rounded-full border border-white/15 bg-black/20 px-4 py-2 font-semibold tracking-wider">LOBBY {state.lobbyId}</div>
        <div className="flex items-center gap-3">
          <span>{opponent?.name ?? "Opponent"}</span>
          <span>Hand {state.opponentHandCount}</span>
          <span>Spit {state.opponentStockCount}</span>
          <button onClick={quitGame} className="rounded-md border border-red-200/30 bg-red-950/50 px-3 py-2 font-bold text-red-100 transition hover:bg-red-900/70">Quit</button>
        </div>
      </header>

      <section className="relative grid place-items-center">
        <Tableau
          className="absolute top-4"
          piles={state.opponentStockPiles}
          faceUpCards={state.opponentFaceUpCards}
          opponent
        />

        <div className="flex items-center gap-12">
          <div className="grid place-items-center gap-2"><Pile id="A" top={state.pileA_top} count={state.pileA_count} seedCount={state.centerA_count} />{showRoundSlap && <button onClick={() => slapDeck("A")} className="rounded-md bg-red-600 px-8 py-2 font-black tracking-widest text-white shadow-lg transition hover:bg-red-500">SLAP</button>}</div>
          <div className="grid place-items-center rounded-full border border-white/15 bg-black/25 px-6 py-3 text-center text-sm text-emerald-50/80">
            {state.phase === "playing" ? "LIVE" : state.phase.toUpperCase()}
          </div>
          {!state.singleCenter && <div className="grid place-items-center gap-2"><Pile id="B" top={state.pileB_top} count={state.pileB_count} seedCount={state.centerB_count} />{showRoundSlap && <button onClick={() => slapDeck("B")} className="rounded-md bg-red-600 px-8 py-2 font-black tracking-widest text-white shadow-lg transition hover:bg-red-500">SLAP</button>}</div>}
        </div>

        {showReadyPanel && (
          <div className="absolute z-20 w-full max-w-sm rounded-lg border border-white/15 bg-slate-950/85 p-5 text-white shadow-card backdrop-blur">
            <div className="mb-4 text-center text-sm font-bold uppercase tracking-widest text-emerald-100/70">Lobby status</div>
            <PlayerReadyRow name={state.players[0]?.name ?? "Player 1"} connected={state.players[0]?.connected ?? false} ready={state.players[0]?.ready ?? false} />
            <PlayerReadyRow name={state.players[1]?.name ?? "Player 2"} connected={state.players[1]?.connected ?? false} ready={state.players[1]?.ready ?? false} />
            {state.phase === "countdown" && <div className="mt-4 text-center text-4xl font-black text-amber-200">{countdown}</div>}
          </div>
        )}


        {showPausePanel && <div className="absolute top-20 z-20 grid place-items-center rounded-lg border border-amber-200/25 bg-slate-950/90 px-8 py-6 text-center text-white shadow-card"><div className="text-sm font-black uppercase tracking-widest text-amber-200">{state.pausedReason}</div>{pauseCountdown !== null && <div className="mt-3 text-5xl font-black text-amber-200">{pauseCountdown}</div>}</div>}

        {opponentCursor && (
          <motion.div animate={{ x: opponentCursor.x * window.innerWidth, y: (1 - opponentCursor.y) * window.innerHeight }} transition={{ type: "tween", duration: 0.05 }} className="pointer-events-none fixed left-0 top-0 z-40">
            <div className="h-4 w-4 rotate-45 rounded-br-full bg-cyan-300 shadow-[0_0_24px_rgba(103,232,249,.8)]" />
            <div className="mt-1 rounded bg-cyan-300 px-2 py-0.5 text-xs font-bold text-slate-950">Opponent</div>
            {opponentCursor.draggingCardId && <CardView faceDown small className="mt-2 rotate-180 opacity-70" />}
          </motion.div>
        )}
      </section>

      <footer className="flex items-end justify-between gap-5">
        <div className="grid h-32 w-24 place-items-center rounded-lg border border-white/15 bg-black/25 text-center text-sm text-emerald-50/85">
          <div>
            <div className="text-2xl font-black">{state.yourStockCount}</div>
            <div>Spit</div>
          </div>
        </div>
        <Tableau className="flex min-h-36 flex-1 items-end justify-center gap-4" piles={state.yourStockPiles} faceUpCards={state.yourFaceUpCards} onFlip={flipStockCard} onDrop={drop} onMove={sendCursor} disabled={state.phase !== "playing" || Boolean(pendingCardId)} />
        <button onClick={ready} disabled={state.phase !== "ready" || Boolean(me?.ready)} className="h-12 rounded-md bg-amber-300 px-6 font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40">
          {me?.ready ? "Ready" : "Ready"}
        </button>
      </footer>

      {toast && <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-md border border-white/15 bg-slate-950/80 px-5 py-3 text-sm font-semibold shadow-card">{toast}</div>}
    </main>
  );
}

function Tableau({ piles, faceUpCards, opponent, className = "", onFlip, onDrop, onMove, disabled = true }: { piles: Card[][]; faceUpCards: string[]; opponent?: boolean; className?: string; onFlip?: (cardId: string) => void; onDrop?: (cardId: string, target: PileId | null, stockIndex: number | null) => void; onMove?: (x: number, y: number, draggingCardId: string | null) => void; disabled?: boolean }) {
  const faceUp = new Set(faceUpCards);
  return (
    <div className={"flex items-end justify-center gap-3 " + className + (opponent ? " rotate-180" : "")}>
      {piles.map((pile, index) => (
        <div key={(opponent ? "opponent" : "player") + "-stock-" + index} data-stock-slot={opponent ? undefined : index} className="relative h-40 w-24">
          {pile.map((card, cardIndex) => {
            const top = cardIndex === pile.length - 1;
            const visible = top && faceUp.has(card.id);
            const content = visible ? <CardView card={card} className={opponent ? "rotate-180" : ""} /> : <CardView faceDown className={opponent ? "rotate-180" : ""} />;
            return <div key={card.id} className="absolute left-0" style={{ bottom: cardIndex * 18, zIndex: cardIndex }}>
              {top && !visible && onFlip ? <button type="button" onClick={() => onFlip(card.id)} disabled={disabled} className="block" title="Flip card">{content}</button> : top && visible && onDrop ? <DraggableCard card={card} disabled={disabled} onMove={onMove ?? (() => undefined)} onDrop={onDrop} /> : content}
            </div>;
          })}
          {pile.length === 0 && <div className="grid h-32 w-24 place-items-center rounded-lg border border-dashed border-emerald-200/30 bg-black/10 text-[10px] uppercase tracking-[0.2em] text-emerald-50/50">Empty</div>}
        </div>
      ))}
    </div>
  );
}

function Pile({ id, top, count, seedCount }: { id: PileId; top: Card | null; count: number; seedCount: number }) {
  return (
    <div data-pile={id} className="grid place-items-center gap-3 rounded-xl border border-dashed border-amber-200/45 bg-black/20 p-5">
      <CardView card={top} />
      <div className="text-xs uppercase tracking-widest text-emerald-50/70">Pile {id} · {count} played · {seedCount} seed</div>
    </div>
  );
}

function PlayerReadyRow({ name, connected, ready }: { name: string; connected: boolean; ready: boolean }) {
  const label = !connected ? "Still waiting" : ready ? "Ready" : "Not ready";
  return (
    <div className="mb-2 flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3">
      <span className="min-w-0 truncate font-bold">{name}</span>
      <span className={`ml-3 shrink-0 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${ready ? "bg-emerald-300 text-slate-950" : "bg-white/15 text-white/70"}`}>{label}</span>
    </div>
  );
}
