import type { Progress } from "../../generated/Progress";

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
