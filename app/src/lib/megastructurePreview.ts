/**
 * What the Add megastructure dialog shows of a type: its tile's picture in the chosen owner's
 * culture, and the preview beside the tiles with the game's description and what it produces.
 */
import type { CountryNode } from "../generated/CountryNode";
import type { MegastructureView } from "../generated/MegastructureView";
import type { SystemDetails } from "../generated/SystemDetails";
import { MEGASTRUCTURE_ICON_KEY } from "./details/icons";
import { producedRows, type ResourceRow } from "./details/resources";
import { megastructureLook, modelKey } from "./details/structures";
import type {
  MegastructureChain,
  MegastructureEntry,
  MegastructureStage,
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
 * stage's own `_DESC`, then the `_MEGASTRUCTURE_DETAILS` the build menu shows for it or for
 * the first stage of the megastructure's main build chain.
 */
export function megastructureDescriptionKeys(key: string, entry: MegastructureEntry): string[] {
  return [
    `${key}_DESC`,
    `${key}_MEGASTRUCTURE_DETAILS`,
    `${entry.chains[0].first}_MEGASTRUCTURE_DETAILS`,
  ];
}

/**
 * `text` as plain sentences: colour codes (`§Y…§!`), icons (`£energy£`) and any reference
 * left unresolved (`$KEY$`) removed, runs of spaces made one; null when nothing is left.
 */
export function descriptionText(text: string | undefined): string | null {
  if (text === undefined) return null;
  const plain = text
    .replace(/£[^£\s]*£/g, "")
    .replace(/\$[\w.|]+\$/g, "")
    .replace(/§./g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return plain === "" ? null : plain;
}

/** What the preview shows of the type the dialog has selected. */
export interface MegastructurePreview {
  key: string;
  label: string;
  /** Where it stands in its chain, as "Stage 2 of 6"; null for a variant or a chain of one. */
  stage: string | null;
  description: string | null;
  /** What it produces each month, per resource. */
  produces: ResourceRow[];
  /** Whether the editor has a model to draw it with. */
  model: boolean;
  /** Why the save would refuse it here; null when it fits. */
  refused: string | null;
}

/**
 * The preview of `stage`, one of `chain`'s, a row of `entry`, from its type and the names
 * fetched so far.
 */
export function megastructurePreview(
  stage: MegastructureStage,
  chain: MegastructureChain,
  entry: MegastructureEntry,
  type: MegastructureView | undefined,
  names: ReadonlyMap<string, string>,
  icons: ReadonlyMap<string, string> = new Map(),
): MegastructurePreview {
  const at = chain.stages.findIndex((s) => s.key === stage.key);
  const count = chain.working;
  const description =
    megastructureDescriptionKeys(stage.key, entry)
      .map((key) => descriptionText(names.get(key)))
      .find((text) => text !== null) ?? null;
  return {
    key: stage.key,
    label: stage.label,
    stage: count > 1 && at >= 0 && at < count ? `Stage ${at + 1} of ${count}` : null,
    description,
    produces: producedRows(type?.produces ?? [], icons),
    model: hasModel(type),
    refused: stage.refused,
  };
}
