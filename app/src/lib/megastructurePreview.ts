/**
 * What the Add megastructure dialog shows of a type: its tile's picture in the chosen owner's
 * culture, and the preview beside the tiles with the game's description, what it produces, what
 * it gives its owner and what adding it also writes.
 */
import type { ConstructionLineView } from "../generated/ConstructionLineView";
import type { CountryNode } from "../generated/CountryNode";
import type { MegastructureView } from "../generated/MegastructureView";
import type { SummaryKind } from "../generated/SummaryKind";
import type { SystemDetails } from "../generated/SystemDetails";
import { MEGASTRUCTURE_ICON_KEY } from "./details/icons";
import { producedRows, type ResourceRow } from "./details/resources";
import { megastructureLook, modelKey } from "./details/structures";
import { plainGameText } from "./gameText";
import {
  addLabel,
  cleanName,
  stageLine,
  type MegastructureChain,
  type MegastructureEntry,
  type MegastructureStage,
} from "./megastructurePicks";

/**
 * The textures a tile of `type` shows, the first that lands: its model in `culture`, bare for
 * no culture, else the game's megastructure icon when it has no model or the model fails.
 */
export function megastructureThumbKeys(
  type: MegastructureView | undefined,
  culture: string | null,
): string[] {
  const look = megastructureLook(type);
  if (look.kind !== "model") return [MEGASTRUCTURE_ICON_KEY];
  return [modelKey(culture, look.entity), MEGASTRUCTURE_ICON_KEY];
}

/**
 * The graphical culture `owner` builds in: the one its country in `countries` names, else the
 * one the save shows on a station or megastructure it owns in `systems`; null for no owner,
 * or one with none read yet.
 */
export function ownerCulture(
  owner: number | null,
  systems: Iterable<SystemDetails>,
  countries?: ReadonlyMap<number, CountryNode>,
): string | null {
  if (owner === null) return null;
  const named = countries?.get(owner)?.graphical_culture;
  if (named) return named;
  const all = [...systems];
  const stations = all.flatMap((d) => [d.starbase, ...d.other_starbases]);
  const rows = [...stations, ...all.flatMap((d) => d.megastructures)];
  return rows.find((row) => row?.owner === owner && row.culture)?.culture ?? null;
}

/** Whether the editor has a model to draw a type with. */
export function hasModel(type: MegastructureView | undefined): boolean {
  return megastructureLook(type).kind === "model";
}

/**
 * The localisation keys a stage's description is read from, the first with any text: the
 * `_DESC` and `_MEGASTRUCTURE_DETAILS` of the type Add writes, `variant`, then the stage's own,
 * then the `_MEGASTRUCTURE_DETAILS` the build menu shows for the first stage of the
 * megastructure's main build chain.
 */
export function megastructureDescriptionKeys(
  key: string,
  entry: MegastructureEntry,
  variant: string = key,
): string[] {
  const keys = [
    `${variant}_DESC`,
    `${variant}_MEGASTRUCTURE_DETAILS`,
    `${key}_DESC`,
    `${key}_MEGASTRUCTURE_DETAILS`,
    `${entry.chains[0].first}_MEGASTRUCTURE_DETAILS`,
  ];
  return keys.filter((k, i) => keys.indexOf(k) === i);
}

const PLACES: Readonly<Record<ConstructionLineView["on"], string>> = {
  system: "on the system",
  body: "on the planet or star it orbits",
  planets: "on every planet in the system",
  owner: "for the empire that owns it",
};

const KINDS: readonly SummaryKind[] = ["modifier", "deposit"];

/** Where a line lands, in the player's words, with when it lands when that is not always. */
function placeOf(line: ConstructionLineView): string {
  if (!line.conditional || line.on === "owner") return PLACES[line.on];
  if (line.on === "planets") return "on some planets in the system";
  if (line.on === "system") return `${PLACES.system}, when it has an owner`;
  return `${PLACES.body}, in some cases`;
}

/**
 * What adding a type also writes, one sentence each: "An Arc Furnace modifier and deposit on
 * some planets in the system". A modifier and a deposit of one name in one place share a line,
 * and a modifier that runs out says so.
 */
export function constructionLines(summary: readonly ConstructionLineView[]): string[] {
  const lines = new Map<string, { name: string; place: string; kinds: Set<SummaryKind> }>();
  for (const line of summary) {
    const name = plainGameText(line.name) || line.key;
    const place = line.permanent ? placeOf(line) : `${placeOf(line)}, for a limited time`;
    const at = `${name}|${place}`;
    const seen = lines.get(at);
    if (seen) seen.kinds.add(line.kind);
    else lines.set(at, { name, place, kinds: new Set([line.kind]) });
  }
  return [...lines.values()].map(({ name, place, kinds }) => {
    const what = KINDS.filter((kind) => kinds.has(kind)).join(" and ");
    const article = /^[aeiou]/i.test(name) ? "An" : "A";
    return `${article} ${name} ${what} ${place}`;
  });
}

/** What the preview shows of the type the dialog has selected. */
export interface MegastructurePreview {
  /** The stage selected. */
  key: string;
  /** The type Add writes: the stage's, or the one the game swaps it for at the spot. */
  variant: string;
  /** Its full name: the variant's when it has one, else the stage's title. */
  label: string;
  /** `Stage 3 of 4: Maturity`; null for a chain of one, a ruins row or a variant's row. */
  stage: string | null;
  /** The Add button's text. */
  add: string;
  /** The keys the description is read from, the first with any text. */
  descriptionKeys: string[];
  /** The game's description with its markup kept; null when the game gives none. */
  description: string | null;
  /** What it produces each month, per resource. */
  produces: ResourceRow[];
  /** What it gives its owner, as the game's tooltip says it. */
  effects: string[];
  /** What adding it also writes to its system, planets and owner. */
  writes: string[];
  /** Whether the editor has a model to draw it with. */
  model: boolean;
  /** Why the save would refuse it here; null when it fits. */
  refused: string | null;
}

/**
 * The preview of `stage`, one of `chain`'s, a row of `entry`. `type` is the type Add writes,
 * `stage.variant`'s. Names come from `names`, and the description from `text`, which keeps the
 * game's markup, else from `names`.
 */
export function megastructurePreview(
  stage: MegastructureStage,
  chain: MegastructureChain,
  entry: MegastructureEntry,
  type: MegastructureView | undefined,
  names: ReadonlyMap<string, string>,
  icons: ReadonlyMap<string, string> = new Map(),
  text: (key: string) => string = (key) => names.get(key) ?? "",
): MegastructurePreview {
  const descriptionKeys = megastructureDescriptionKeys(stage.key, entry, stage.variant);
  const description = descriptionKeys.map(text).find((found) => found.trim() !== "") ?? null;
  const variantName = stage.variant === stage.key ? "" : cleanName(names.get(stage.variant) ?? "");
  return {
    key: stage.key,
    variant: stage.variant,
    label: variantName || stage.label,
    stage: stageLine(stage, chain),
    add: addLabel(stage, chain),
    descriptionKeys,
    description,
    produces: producedRows(type?.produces ?? [], icons),
    effects: (type?.country_effects ?? []).map((effect) => effect.text),
    writes: constructionLines(type?.construction_summary ?? []),
    model: hasModel(type),
    refused: stage.refused,
  };
}
