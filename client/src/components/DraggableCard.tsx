import { useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Card, PileId } from "@speed/shared";
import { CardView } from "./CardView";

interface Props {
  card: Card;
  disabled: boolean;
  onMove: (x: number, y: number, draggingCardId: string | null) => void;
  onDrop: (cardId: string, target: PileId | null, stockIndex: number | null) => void;
}

export function DraggableCard({ card, disabled, onMove, onDrop }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const origin = useRef({ x: 0, y: 0, left: 0, top: 0 });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    ref.current?.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, y: event.clientY, left: pos.x, top: pos.y };
    setDragging(true);
    onMove(event.clientX, event.clientY, card.id);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = { x: origin.current.left + event.clientX - origin.current.x, y: origin.current.top + event.clientY - origin.current.y };
    setPos(next);
    onMove(event.clientX, event.clientY, card.id);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    ref.current?.releasePointerCapture(event.pointerId);
    setDragging(false);
    onMove(event.clientX, event.clientY, null);
    const target =
      document
        .elementsFromPoint(event.clientX, event.clientY)
        .filter((element) => element !== ref.current && !ref.current?.contains(element))
        .map((element) => {
          const pile = element.closest("[data-pile]")?.getAttribute("data-pile");
          if (pile === "A" || pile === "B") return { pile: pile as PileId, stockIndex: null };
          const stockIndex = element.closest("[data-stock-slot]")?.getAttribute("data-stock-slot");
          if (stockIndex !== null && stockIndex !== undefined) return { pile: null, stockIndex: Number(stockIndex) };
          return { pile: null, stockIndex: null };
        })
        .find((value) => value.pile !== null || value.stockIndex !== null) ?? { pile: null, stockIndex: null };
    onDrop(card.id, target.pile, target.stockIndex);
    setPos({ x: 0, y: 0 });
  };

  return (
    <motion.div
      ref={ref}
      animate={pos}
      transition={{ type: "spring", stiffness: 520, damping: 42 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`touch-none ${disabled ? "cursor-not-allowed opacity-60" : "cursor-grab active:cursor-grabbing"} ${dragging ? "z-50" : "z-10"}`}
      style={{ position: "relative" }}
    >
      <CardView card={card} />
    </motion.div>
  );
}
