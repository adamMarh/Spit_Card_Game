import { motion } from "framer-motion";
import type { Card } from "@speed/shared";
import { rankLabel } from "@speed/shared";
import { cardColor } from "../store/gameStore";

const suitGlyph = { C: "♣", D: "♦", H: "♥", S: "♠" } as const;

interface CardViewProps {
  card?: Card | null;
  faceDown?: boolean;
  small?: boolean;
  className?: string;
}

export function CardView({ card, faceDown, small, className = "" }: CardViewProps) {
  const size = small ? "h-24 w-16" : "h-32 w-24";
  if (faceDown || !card) {
    return (
      <motion.div layout className={`${size} rounded-lg border border-emerald-200/25 bg-[#7d1830] p-2 shadow-card ${className}`}>
        <div className="h-full rounded-md border border-rose-100/30 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,.12)_0_2px,transparent_2px_7px)]" />
      </motion.div>
    );
  }
  return (
    <motion.div layout className={`${size} select-none rounded-lg border border-slate-200 bg-[#fff9ec] p-2 shadow-card ${cardColor(card)} ${className}`}>
      <div className="flex h-full flex-col justify-between rounded-md border border-slate-900/10 p-1">
        <div className="text-left font-card text-xl leading-none">{rankLabel(card.rank)}</div>
        <div className="grid place-items-center font-card text-4xl">{suitGlyph[card.suit]}</div>
        <div className="rotate-180 text-left font-card text-xl leading-none">{rankLabel(card.rank)}</div>
      </div>
    </motion.div>
  );
}
