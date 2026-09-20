/**
 * Paint a Galaxy, embedded: the site's address, the page the panel loads, and the messages the
 * two sides exchange over `postMessage`.
 */

/** The published site; also the one address the shell's `open_url` allows. */
export const PAINT_URL = "https://oatmealproblem.github.io/paint-a-galaxy/";

/** The site the panel embeds: `VITE_PAINT_URL` names a local build for testing. */
const EMBED_URL: string = import.meta.env.VITE_PAINT_URL || PAINT_URL;

/** The only origin a galaxy is accepted from. */
export const PAINT_ORIGIN = new URL(EMBED_URL).origin;

const PAINT_SOURCE = "paint-a-galaxy";
const PARENT_APP_NAME = "Stellaris Galaxy Forge";
const DEFAULT_NAME = "Painted galaxy";

/** What Forge answers a `ready` message with. */
export const PAINT_READY = { source: "stellaris-galaxy-forge", type: "ready", version: 1 } as const;

/** A painted galaxy as the site sends it: its project name and the scenario text. */
export interface PaintedGalaxy {
  name: string;
  txt: string;
}

/** The page the panel loads: the site in embedded mode, told what to call this app. */
export function paintEmbedUrl(): string {
  const url = new URL(EMBED_URL);
  url.searchParams.set("embeddedMode", "true");
  url.searchParams.set("parentAppName", PARENT_APP_NAME);
  // Percent-encoded, not form-encoded: a `+` would reach the site as a plus sign.
  url.search = url.searchParams.toString().replace(/\+/g, "%20");
  return url.toString();
}

function fields(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

/** True for the site's `ready` message, which asks for `PAINT_READY` back. */
export function isPaintReadyMessage(data: unknown): boolean {
  const message = fields(data);
  return message !== null && message.source === PAINT_SOURCE && message.type === "ready";
}

/** The galaxy a `galaxy` message carries; null for anything else. */
export function parsePaintMessage(data: unknown): PaintedGalaxy | null {
  const message = fields(data);
  if (message === null || message.source !== PAINT_SOURCE || message.type !== "galaxy") return null;
  const { name, txt } = message;
  if (typeof txt !== "string" || txt === "") return null;
  return { name: typeof name === "string" && name.trim() !== "" ? name : DEFAULT_NAME, txt };
}
