import { create } from "zustand";
import type { DocumentKind } from "../generated/DocumentKind";
import type { SaveMeta } from "../generated/SaveMeta";
import { PREF_KEYS } from "./prefKeys";
import { prefField } from "./prefs";
import { counted } from "../lib/text";

/** One document recently opened, either kind, for the Open screen and the File menu. */
export interface RecentDoc {
  kind: DocumentKind;
  path: string;
  title: string;
  openedAt: number;
  subtitle: string;
}

export interface RecentsState {
  recents: RecentDoc[];
  /** Records a document as just opened: dedupes by path, newest first, capped. */
  noteOpened(doc: Omit<RecentDoc, "openedAt">): void;
  forget(path: string): void;
}

const RECENTS_CAP = 20;

const RECENTS = prefField<unknown[]>(PREF_KEYS.recents, [], Array.isArray);

/** The trailing word of a game version string, `"Pegasus v4.4.6"` -> `"v4.4.6"`. */
function versionShort(version: string): string {
  const parts = version.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/** A save's empire, date and version; a scenario's system count when one is given. */
export function recentSubtitle(
  kind: DocumentKind,
  meta: SaveMeta | null,
  galaxySystems?: number,
): string {
  if (kind === "save") {
    if (meta === null) return "";
    return [meta.name, meta.date, versionShort(meta.version)].filter(Boolean).join(" · ");
  }
  if (typeof galaxySystems !== "number") return "";
  return counted(galaxySystems, "system");
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "save" || value === "scenario";
}

function isRecentDoc(value: unknown): value is RecentDoc {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isDocumentKind(v.kind) &&
    typeof v.path === "string" &&
    typeof v.title === "string" &&
    typeof v.openedAt === "number" &&
    typeof v.subtitle === "string"
  );
}

function loadRecents(): RecentDoc[] {
  return RECENTS.read().filter(isRecentDoc).slice(0, RECENTS_CAP);
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  recents: loadRecents(),

  noteOpened(doc) {
    const rest = get().recents.filter((r) => r.path !== doc.path);
    const recents = [{ ...doc, openedAt: Date.now() }, ...rest].slice(0, RECENTS_CAP);
    set({ recents });
    RECENTS.save(recents);
  },

  forget(path) {
    const recents = get().recents.filter((r) => r.path !== path);
    set({ recents });
    RECENTS.save(recents);
  },
}));
