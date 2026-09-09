"use client";

import Image from "next/image";
import { UserRound } from "lucide-react";
import { useState } from "react";

// Shared player avatar. Pass `userId` to load from the authenticated route
// (`/api/assets/avatar/:userId`) or an explicit `src` for the public TV board
// (`/api/assets/avatar/public/:code/:playerId`). Falls back to an initial /
// glyph circle when there is no photo or the fetch fails.
export function Avatar({
  userId,
  src,
  name,
  size,
  className = "",
}: {
  userId?: string | null;
  src?: string | null;
  name?: string | null;
  size: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dimension = { width: `${size}px`, height: `${size}px` };
  const url = src ?? (userId ? `/api/assets/avatar/${userId}` : null);

  if (!url || failed) {
    const letter = name?.trim()?.slice(0, 1)?.toUpperCase();
    return (
      <span
        style={dimension}
        className={`grid shrink-0 place-items-center rounded-full bg-pink-100 font-black text-pink-500 ${className}`}
      >
        {letter || <UserRound size={Math.round(size * 0.55)} />}
      </span>
    );
  }

  return (
    <span
      style={dimension}
      className={`relative block shrink-0 overflow-hidden rounded-full bg-pink-100 ${className}`}
    >
      <Image
        src={url}
        alt={name ?? ""}
        fill
        sizes={`${size}px`}
        unoptimized
        className="object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
