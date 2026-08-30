import { useEffect, useState } from "react";
import type { AiDifficulty } from "@speed/shared";
import { useGameStore } from "./store/gameStore";
import { wsUrl } from "./lib/ws";
import { GameTable } from "./components/GameTable";

export function App() {
  const connect = useGameStore((s) => s.connect);
  const createLobby = useGameStore((s) => s.createLobby);
  const createSoloLobby = useGameStore((s) => s.createSoloLobby);
  const joinLobby = useGameStore((s) => s.joinLobby);
  const lobbyId = useGameStore((s) => s.lobbyId);
  const name = useGameStore((s) => s.name);
  const aiDifficulty = useGameStore((s) => s.aiDifficulty);
  const setName = useGameStore((s) => s.setName);
  const setAiDifficulty = useGameStore((s) => s.setAiDifficulty);
  const state = useGameStore((s) => s.state);
  const toast = useGameStore((s) => s.toast);
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    connect(wsUrl);
  }, [connect]);

  if (state) return <GameTable />;

  const canSubmit = name.trim().length > 0;

  return (
    <main className="table-felt grid min-h-full place-items-center px-6">
      <section className="w-full max-w-md rounded-lg border border-white/15 bg-slate-950/45 p-7 shadow-card backdrop-blur">
        <h1 className="text-4xl font-black tracking-normal text-white">Speed</h1>
        <p className="mt-2 text-sm text-emerald-50/75">Enter a name for multiplayer, or leave it blank and play solo as Player.</p>
        <div className="mt-7 grid gap-3">
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={18} placeholder="Your name (optional for solo)" className="rounded-md border border-white/15 bg-black/30 px-4 py-3 text-base font-semibold text-white outline-none focus:border-amber-300" />
          <label className="grid gap-2 text-sm font-medium text-emerald-50/80">
            <span>AI difficulty</span>
            <select value={aiDifficulty} onChange={(event) => setAiDifficulty(event.target.value as AiDifficulty)} className="rounded-md border border-white/15 bg-black/30 px-3 py-2 text-base font-semibold text-white outline-none focus:border-cyan-300">
              <option value="beginner">Beginner</option>
              <option value="easy">Easy</option>
              <option value="intermediate">Intermediate</option>
              <option value="experienced">Experienced</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={createLobby} disabled={!canSubmit} className="rounded-md bg-amber-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40">Create Lobby</button>
            <button onClick={createSoloLobby} className="rounded-md bg-cyan-200 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-100">Solo</button>
          </div>
          <div className="flex gap-2">
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={5} placeholder="CODE" className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-4 py-3 text-lg font-black tracking-[0.2em] text-white outline-none focus:border-amber-300" />
            <button onClick={() => joinLobby(joinCode)} disabled={!canSubmit || joinCode.trim().length !== 5} className="rounded-md bg-white px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/40">Join</button>
          </div>
        </div>
        {lobbyId && (
          <div className="mt-6 rounded-md border border-emerald-200/25 bg-emerald-950/50 p-4">
            <div className="text-xs uppercase tracking-widest text-emerald-50/60">Share code</div>
            <div className="mt-1 text-3xl font-black tracking-[0.2em]">{lobbyId}</div>
            <div className="mt-2 text-sm text-emerald-50/70">Waiting for opponent...</div>
          </div>
        )}
        {toast && <div className="mt-4 rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-100">{toast}</div>}
      </section>
    </main>
  );
}
