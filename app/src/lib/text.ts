import type { Progress } from "../generated/Progress";

/** `["gas", "giant"]` → `Gas Giant`; empty words are dropped and `special` overrides a word. */
export function titleCase(words: readonly string[], special: Record<string, string> = {}): string {
  return words
    .filter((w) => w !== "")
    .map((w) => special[w] ?? w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** `ship_role_science` → `Ship Role Science`: a key's words, for when nothing names it. */
export function keyWords(key: string): string {
  return titleCase(key.split("_"));
}

/** The number typed as `text`, or null for blank text or text that is no number. */
export function typedNumber(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** `1600` → `1,600`: a count or a cost as the game writes it. */
export function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

/** `3, "system"` → `3 systems`; `1, "lane"` → `1 lane`; `plural` for a noun that takes no `s`. */
export function counted(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

const DAY = 86400;

/** "14:02" today, "yesterday", then "3 Sep" and the year once it is not this one. */
export function formatWhen(seconds: number): string {
  const when = new Date(seconds * 1000);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = midnight.getTime() / 1000;
  if (seconds >= startOfToday) {
    return when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (seconds >= startOfToday - DAY) return "yesterday";
  const sameYear = when.getFullYear() === midnight.getFullYear();
  return when.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

export function formatSize(bytes: number): string {
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const GAME_DATA_PHASE: Record<string, string> = {
  discover: "finding Stellaris",
  definitions: "reading definitions",
  localisation: "reading localisation",
  done: "done",
};

/** "reading localisation · 43%" for the game-data pill and the start screen. */
export function phaseLabel(progress: Progress | null): string {
  const percent = Math.round((progress?.fraction ?? 0) * 100);
  const phase = GAME_DATA_PHASE[progress?.phase ?? ""];
  return phase ? `${phase} · ${percent}%` : `${percent}%`;
}
