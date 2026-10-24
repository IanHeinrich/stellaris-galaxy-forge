import type { Progress } from "../generated/Progress";

/** `["gas", "giant"]` → `Gas Giant`; empty words are dropped and `special` overrides a word. */
export function titleCase(words: readonly string[], special: Record<string, string> = {}): string {
  return words
    .filter((w) => w !== "")
    .map((w) => special[w] ?? w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** `habitable class` → `Habitable class`: words as they start a line. */
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

const LIST_TYPES = { and: "conjunction", or: "disjunction" } as const;

/** `["a", "b", "c"], "and"` → `a, b and c`; `"or"` gives `a, b or c`; one item stands alone. */
export function listed(items: readonly string[], joiner: "and" | "or"): string {
  return new Intl.ListFormat("en-GB", { style: "long", type: LIST_TYPES[joiner] }).format(items);
}

/** `add a system` → `Load game data to add a system.`: why a control is off until the install is read. */
export function needsGameData(task: string): string {
  return `Load game data to ${task}.`;
}

/** `Habitat` → `a Habitat`; `Ocean world` → `an Ocean world`. */
export function withArticle(text: string): string {
  return /^[aeiou]/i.test(text) ? `an ${text}` : `a ${text}`;
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

const AGO_UNITS: [seconds: number, noun: string][] = [
  [DAY, "day"],
  [3600, "hour"],
  [60, "minute"],
];

/** "just now", "4 minutes ago", "3 hours ago", "2 days ago": how long before `now` it was. */
export function savedAgo(seconds: number, now: number): string {
  const elapsed = Math.max(0, now - seconds);
  for (const [unit, noun] of AGO_UNITS) {
    if (elapsed >= unit) return `${counted(Math.floor(elapsed / unit), noun)} ago`;
  }
  return "just now";
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
