"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Copy, GripVertical, Settings2 } from "lucide-react";

import { addRound, deleteRound, duplicateRound, reorderRounds, updateRound } from "@/app/actions/admin";
import { ActionForm } from "./action-form";

type Row = Record<string, unknown>;

const ROUND_KINDS = ["team", "solo", "house_secret", "event", "nomination", "elimination", "finale"] as const;

const WALLET_MODES: [string, string][] = [
  ["personal", "Personal"],
  ["temporary_team", "Temporary team pot"],
  ["pooled_personal", "Pooled balances"],
];

export function RoundSchedule({
  locale,
  gameId,
  rounds,
  currentRoundId,
}: {
  locale: string;
  gameId: string;
  rounds: Row[];
  currentRoundId: string | null;
}) {
  const hasFinale = rounds.some((r) => String(r.kind) === "finale");

  // Display order: by position, with any finale forced last.
  const propIds = useMemo(() => {
    const finaleId = rounds.find((r) => String(r.kind) === "finale")?.id;
    return [...rounds]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((r) => String(r.id))
      .filter((id) => id !== String(finaleId))
      .concat(finaleId ? [String(finaleId)] : []);
  }, [rounds]);
  const propKey = propIds.join(",");

  // Mirror the server's order, but re-sync whenever it actually changes
  // (React's "adjust state during render" pattern — no effect needed).
  const [order, setOrder] = useState<string[]>(propIds);
  const [seenKey, setSeenKey] = useState(propKey);
  if (seenKey !== propKey) {
    setSeenKey(propKey);
    setOrder(propIds);
  }

  const [openRound, setOpenRound] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const byId = useMemo(() => new Map(rounds.map((r) => [String(r.id), r])), [rounds]);
  const currentPos = currentRoundId
    ? Number(byId.get(currentRoundId)?.position ?? -1)
    : -1;
  const nextId = [...rounds]
    .filter((r) => String(r.status) === "scheduled" && Number(r.position) > currentPos)
    .sort((a, b) => Number(a.position) - Number(b.position))[0]?.id;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    let next = arrayMove(order, oldIndex, newIndex);
    const finaleId = rounds.find((r) => String(r.kind) === "finale")?.id;
    if (finaleId) next = [...next.filter((id) => id !== String(finaleId)), String(finaleId)];
    setOrder(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      fd.set("gameId", gameId);
      fd.set("roundIds", JSON.stringify(next));
      await reorderRounds(fd);
    });
  };

  return (
    <div className="space-y-4">
      <ActionForm action={addRound} success="Round added" className="bubble-card grid gap-3 p-5">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="gameId" value={gameId} />
        <div>
          <h3 className="display text-lg font-black">Add a round</h3>
          <p className="text-xs text-[var(--muted)]">
            Rounds run in the order shown below — drag the handle to rearrange. Length is in minutes.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_11rem_9rem_auto] sm:items-end">
          <label className="text-xs font-bold">
            Title
            <input className="field mt-1" name="title" placeholder="Round title" required />
          </label>
          <label className="text-xs font-bold">
            Type
            <select className="field mt-1" name="kind" defaultValue="solo">
              {ROUND_KINDS.filter((kind) => kind !== "finale" || !hasFinale).map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Wallet mode
            <select className="field mt-1" name="walletMode" defaultValue="personal">
              {WALLET_MODES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Length (minutes)
            <div className="mt-1 flex items-center gap-2">
              <input className="field" name="durationMinutes" type="number" min="1" defaultValue="45" required />
              <span className="text-xs text-[var(--muted)]">min</span>
            </div>
          </label>
          <button className="pill pill-primary h-10">Add round</button>
        </div>
      </ActionForm>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="bubble-card divide-y divide-pink-100 overflow-hidden">
            {order.map((rid, index) => {
              const round = byId.get(rid);
              if (!round) return null;
              return (
                <RoundRow
                  key={rid}
                  round={round}
                  index={index}
                  locale={locale}
                  gameId={gameId}
                  currentRoundId={currentRoundId}
                  currentPos={currentPos}
                  isNext={rid === String(nextId)}
                  editing={openRound === rid}
                  onToggleEdit={() => setOpenRound(openRound === rid ? null : rid)}
                />
              );
            })}
            {!order.length ? (
              <p className="p-6 text-[var(--muted)]">Add rounds to your custom schedule.</p>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function RoundRow({
  round,
  index,
  locale,
  gameId,
  currentRoundId,
  currentPos,
  isNext,
  editing,
  onToggleEdit,
}: {
  round: Row;
  index: number;
  locale: string;
  gameId: string;
  currentRoundId: string | null;
  currentPos: number;
  isNext: boolean;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const rid = String(round.id);
  const status = String(round.status);
  const kind = String(round.kind);
  const isFinale = kind === "finale";
  const isCurrent = rid === String(currentRoundId) || status === "live" || status === "paused";
  const isFuture = status === "scheduled" && Number(round.position) > currentPos;
  const cfg = (round.config ?? {}) as Row;

  const stage = status === "completed"
    ? "finished"
    : status === "cancelled"
      ? "cancelled"
      : isCurrent
        ? "current"
        : isNext
          ? "next"
          : null;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rid,
    disabled: !isFuture || isFinale,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  const canDrag = isFuture && !isFinale;

  return (
    <div ref={setNodeRef} style={style} className={`group bg-white ${isDragging ? "shadow-lg" : ""}`}>
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={!canDrag}
          className={`grid size-8 shrink-0 place-items-center rounded-full text-[var(--muted)] ${
            canDrag ? "cursor-grab bg-pink-50 hover:bg-pink-100 active:cursor-grabbing" : "cursor-default opacity-30"
          }`}
        >
          <GripVertical size={15} />
        </button>
        <span className="display grid size-9 shrink-0 place-items-center rounded-full bg-pink-100 font-black text-pink-700">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-black">{String(round.title)}</h2>
          <p className="text-xs text-[var(--muted)]">
            {kind.replaceAll("_", " ")} · {Number(cfg.durationMinutes ?? 0)} min
          </p>
        </div>
        {stage ? (
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${
              stage === "current"
                ? "bg-emerald-100 text-emerald-800"
                : stage === "next"
                  ? "bg-pink-100 text-pink-800"
                  : stage === "finished"
                    ? "bg-[var(--muted-bg,#eee)] text-[var(--muted)]"
                    : "bg-red-100 text-red-800"
            }`}
          >
            {stage}
          </span>
        ) : null}
        {isFinale ? (
          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-1 text-xs font-black text-violet-800">final</span>
        ) : null}
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {!isFinale ? (
            <ActionForm action={duplicateRound} success="Round duplicated">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="gameId" value={gameId} />
              <input type="hidden" name="roundId" value={rid} />
              <button className="grid size-8 place-items-center rounded-full bg-pink-50 hover:bg-pink-100" aria-label="Duplicate round" title="Duplicate round">
                <Copy size={14} />
              </button>
            </ActionForm>
          ) : null}
          <button
            type="button"
            onClick={onToggleEdit}
            className="grid size-8 place-items-center rounded-full bg-pink-50 hover:bg-pink-100"
            aria-label="Edit round settings"
            aria-expanded={editing}
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {editing ? (
        <ActionForm action={updateRound} success="Round saved" className="grid gap-3 border-t border-pink-100 bg-pink-50/30 p-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="roundId" value={rid} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold sm:col-span-2">
              Title
              <input className="field mt-1" name="title" defaultValue={String(round.title)} required />
            </label>
            <label className="text-xs font-bold">
              Length (minutes)
              <div className="mt-1 flex items-center gap-2">
                <input
                  className="field"
                  name="durationMinutes"
                  type="number"
                  min="1"
                  defaultValue={Number(cfg.durationMinutes ?? 45)}
                  required
                />
                <span className="text-xs text-[var(--muted)]">min</span>
              </div>
            </label>
            <label className="text-xs font-bold">
              Wallet mode
              <select className="field mt-1" name="walletMode" defaultValue={String(cfg.walletMode ?? "personal")}>
                {WALLET_MODES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <details className="rounded-xl border border-pink-100 bg-white/60 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-bold text-[var(--muted)]">Advanced economy &amp; buzz</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="font-bold">
                Accusation buzz cost
                <input
                  className="field mt-1"
                  name="accusationStake"
                  type="number"
                  min="0"
                  defaultValue={Math.round(Number(cfg.accusationStake ?? 0) / 100)}
                  required
                />
              </label>
              <label className="font-bold">
                Hint cost
                <input
                  className="field mt-1"
                  name="hintPrice"
                  type="number"
                  min="0"
                  defaultValue={Math.round(Number(cfg.hintPrice ?? 0) / 100)}
                  required
                />
              </label>
              <label className="font-bold">
                Correct-buzz transfer %
                <input
                  className="field mt-1"
                  name="correctTransferPercent"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={Number(cfg.correctTransferPercent ?? 50)}
                  required
                />
              </label>
              <label className="font-bold">
                Hint visibility
                <select className="field mt-1" name="hintVisibility" defaultValue={String(cfg.hintVisibility ?? "private")}>
                  <option value="private">Private</option>
                  <option value="team">Team</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <label className="font-bold">
                Completes on
                <select className="field mt-1" name="completion" defaultValue={String(cfg.completion ?? "manual")}>
                  <option value="manual">Manual</option>
                  <option value="timer">Timer</option>
                  <option value="all_submitted">All submitted</option>
                </select>
              </label>
              <label className="flex items-center gap-2 font-bold">
                <input type="checkbox" name="accusationBuzzEnabled" defaultChecked={cfg.accusationBuzzEnabled !== false} />
                Accusation buzz enabled
              </label>
              <label className="flex items-center gap-2 font-bold">
                <input type="checkbox" name="hintBuzzEnabled" defaultChecked={cfg.hintBuzzEnabled !== false} />
                Hint buzz enabled
              </label>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-3">
            <button className="pill pill-primary h-9 text-xs">Save round</button>
            {!isFuture ? <span className="text-xs text-[var(--muted)]">Only future rounds can be deleted.</span> : null}
          </div>
        </ActionForm>
      ) : null}

      {editing && isFuture ? (
        <ActionForm
          action={deleteRound}
          success="Round deleted"
          confirm="Delete this round?"
          className="border-t border-pink-100 bg-pink-50/30 px-4 pb-4 pt-3"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="roundId" value={rid} />
          <button className="pill h-9 bg-red-500 text-xs text-white">Delete round</button>
        </ActionForm>
      ) : null}
    </div>
  );
}
