/**
 * The typeface empire names are written in on the map: the game's own, read from the install
 * and registered as a web font, or a light wide system face until it loads or without one.
 */

const FAMILY = "Stellaris Map Names";
/** Light and wide, the nearest the usual systems come to the game's face. */
export const MAP_NAME_FALLBACK = "Bahnschrift, 'Segoe UI', Helvetica, Arial, sans-serif";

let face: FontFace | null = null;
let generation = 0;
const listeners = new Set<() => void>();

/** The CSS font family list for empire names, the game's face first once it is loaded. */
export function mapNameFamily(): string {
  return face ? `"${FAMILY}", ${MAP_NAME_FALLBACK}` : MAP_NAME_FALLBACK;
}

/** Whether the game's own face is loaded. */
export function hasGameMapFont(): boolean {
  return face !== null;
}

/** Called whenever the face changes, loaded or dropped. */
export function onMapNameFont(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Registers the font file sent as base64, or drops the face with null. A file the browser
 * cannot read leaves the fallback in place.
 */
export async function setMapNameFont(base64: string | null): Promise<void> {
  const mine = ++generation;
  let next: FontFace | null = null;
  if (base64 !== null && typeof FontFace !== "undefined" && typeof document !== "undefined") {
    try {
      next = await new FontFace(FAMILY, bytesOf(base64)).load();
    } catch {
      next = null;
    }
  }
  if (mine !== generation) return;
  if (face) document.fonts.delete(face);
  if (next) document.fonts.add(next);
  if (face === null && next === null) return;
  face = next;
  for (const listener of listeners) listener();
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
