"use client";

import {
  Banknote,
  Book,
  Briefcase,
  Calendar,
  Cat,
  Dice5,
  Dog,
  FileText,
  Fingerprint,
  FolderOpen,
  Gift,
  GitBranch,
  GitMerge,
  GraduationCap,
  HandCoins,
  Heart,
  HeartCrack,
  HeartHandshake,
  HelpCircle,
  Lock,
  Mailbox,
  MessageCircle,
  PenLine,
  Phone,
  Plane,
  Scroll,
  Users,
  UsersRound,
  Utensils,
  type LucideIcon,
} from "lucide-react";

// Secret-bank image hints are referenced as "lucide:<kebab-name>". Only the
// names the seeded decks actually use are registered here, so the lucide set
// stays tree-shaken. Add new entries as new packs land.
const REGISTRY: Record<string, LucideIcon> = {
  "banknote": Banknote,
  "book": Book,
  "briefcase": Briefcase,
  "calendar": Calendar,
  "cat": Cat,
  "dice-5": Dice5,
  "dog": Dog,
  "file-text": FileText,
  "fingerprint": Fingerprint,
  "folder-open": FolderOpen,
  "gift": Gift,
  "git-branch": GitBranch,
  "git-merge": GitMerge,
  "graduation-cap": GraduationCap,
  "hand-coins": HandCoins,
  "heart": Heart,
  "heart-crack": HeartCrack,
  "heart-handshake": HeartHandshake,
  "lock": Lock,
  "mailbox": Mailbox,
  "message-circle": MessageCircle,
  "pen-line": PenLine,
  "phone": Phone,
  "plane": Plane,
  "scroll": Scroll,
  "users": Users,
  "users-round": UsersRound,
  "utensils": Utensils,
};

/** Normalises a hint image_ref ("lucide:gift" | "gift") to a registered name, or null. */
export function hintIconName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const name = ref.startsWith("lucide:") ? ref.slice(7) : ref;
  return name in REGISTRY ? name : null;
}

/** True when this hint should render as a bundled icon rather than a stored image. */
export function isIconHint(hint: { image_ref?: string | null; asset_path?: string | null } | null | undefined): boolean {
  return !!hint && !!hint.image_ref && !hint.asset_path && hintIconName(hint.image_ref) != null;
}

export function HintIcon({ refValue, className }: { refValue: string | null | undefined; className?: string }) {
  const name = hintIconName(refValue);
  const Icon = name ? REGISTRY[name] : HelpCircle;
  return (
    <div className={className ?? "flex items-center justify-center rounded-xl bg-white/60 py-8"}>
      <Icon className="h-16 w-16 text-[var(--muted)]" strokeWidth={1.5} aria-hidden />
    </div>
  );
}
