/** The English a system's planet, starbase, megastructure, bypass and site keys read as. */
import type { BypassKind } from "../../generated/BypassKind";
import type { BypassLink } from "../../generated/BypassLink";
import type { CountryNode } from "../../generated/CountryNode";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { MapTooltipText } from "../../store/mapChromeStore";
import { templateKeys, templateName, type Names } from "../names";
import { canonicalResource } from "../resources";
import { keyWords, titleCase } from "../text";
import {
  ARCHAEOLOGY_ICON_KEYS,
  MEGASTRUCTURE_ICON_KEY,
  PLANET_SIZE_ICON_KEY,
  bypassIconKey,
  type BypassKinds,
  type IconFrame,
  type Icon,
} from "./icons";

export const FALLBACK_HABITABLE =
  /^pc_(continental|ocean|tropical|arid|desert|savannah|alpine|arctic|tundra|gaia|nuked|relic|city|habitat|ringworld_habitable|shattered_ring_habitable)$/;

const MEGASTRUCTURE_WORDS: Record<string, string> = { lgate: "L-Gate" };
/** The states a type name can end in, and whether the structure is a ruin rather than a working one. */
const MEGASTRUCTURE_STATES: Record<string, boolean> = {
  ruined: true,
  derelict: true,
  restored: false,
  intermediate: false,
};
/** The states a label leaves unsaid: a finished structure, and one the empire is still building. */
const PLAIN_MEGASTRUCTURE_STATES = new Set(["complete", "under construction"]);
/** Suffixes that say nothing at all, stripped from the name. */
const MEGASTRUCTURE_FILLER = /^(final|base)$/;

/** The sheet's first frame, the outpost: what the game shows for a level with no frame of its own. */
const OUTPOST_FRAME = 1;

const STARBASE_LEVEL_PREFIX = "starbase_level_";
const ORDINARY_STARBASE_LEVELS = new Set(
  ["outpost", "starport", "starhold", "starfortress", "citadel"].map(
    (l) => `${STARBASE_LEVEL_PREFIX}${l}`,
  ),
);

const WAYSTATION_LEVEL_PREFIX = `${STARBASE_LEVEL_PREFIX}waystation`;
/** What the game calls the three levels of `starbase_level_waystation_1..3`, in order. */
const WAYSTATION_LEVEL_WORDS = ["Waystation", "Wayport", "Wayhold"];
const WAYSTATION_KIND_PREFIX = "swaystation_";
const WAYSTATION_TYPES = new Set(["research", "energy", "mining", "trade", "piracy"]);

export interface TooltipRow {
  label: MapTooltipText;
  value: MapTooltipText;
  stacked?: boolean;
}

export interface MegastructureParts {
  name: string;
  /** What the type name says: `complete`, `under construction`, `stage 3`, or a state word. */
  state: string;
  /** Whether that state is a ruin rather than a working structure. */
  warn: boolean;
}

/** `Alpha Centauri III` → `Continental World · size 16 · capital · colonised by Earth`. */
export function planetLine(
  p: PlanetSummary,
  name: string,
  classLabel: string,
  ownerName: (id: number) => string,
  sizeIcon = false,
  classIcon: string | null = null,
): TooltipRow {
  const pieces: Array<string | { icon: string }> = [classLabel];
  if (p.size !== null) {
    if (sizeIcon) pieces.push(" ", { icon: PLANET_SIZE_ICON_KEY }, ` ${p.size}`);
    else pieces.push(` · size ${p.size}`);
  }
  if (p.pre_ftl) pieces.push(" · pre-FTL");
  else if (p.capital) pieces.push(" · capital");
  if (p.colonised && !p.pre_ftl && p.owner !== null) {
    pieces.push(` · colonised by ${ownerName(p.owner)}`);
  }
  const value = pieces.every((piece) => typeof piece === "string") ? pieces.join("") : pieces;
  const label: MapTooltipText = classIcon ? [{ icon: classIcon }, ` ${name}`] : name;
  return { label, value, stacked: true };
}

/** `pc_tropical` → `Tropical World`, `pc_gas_giant` → `Gas Giant`. */
export function planetClassLabel(planetClass: string): string {
  const words = planetClass
    .replace(/^pc_/, "")
    .replace(/_habitable$/, "")
    .split("_")
    .filter(Boolean);
  if (words.length === 0) return planetClass;
  const label = titleCase(words);
  const named = words.some((w) => /^(world|habitat|ringworld)$/.test(w));
  return FALLBACK_HABITABLE.test(planetClass) && !named ? `${label} World` : label;
}

/** A body block without a class leaves the choice to the game, like `random`. */
const RANDOM_CLASSES: Record<string, string> = {
  "": "random planet, any class",
  none: "no planet",
  random: "random planet, any class",
  random_colonizable: "random habitable planet",
  random_non_colonizable: "random uninhabitable planet",
  random_asteroid: "random asteroid",
  random_non_machine: "random planet, no machine world",
  random_non_ideal: "random planet, not the ideal class",
  random_ruler: "random habitable planet for a ruler",
  random_pre_ftl: "random pre-FTL world",
};

/** `rl_habitable_planets` → `random from habitable planets`. */
export function randomListLabel(key: string): string {
  return `random from ${key.slice(3).replace(/_/g, " ")}`;
}

/** What a body's class is called: a planet class, one of the random kinds, or a random list. */
export function initClassLabel(planetClass: string): string {
  const random = RANDOM_CLASSES[planetClass];
  if (random !== undefined) return random;
  if (planetClass.startsWith("rl_")) return randomListLabel(planetClass);
  if (planetClass.startsWith("random")) return planetClass.replace(/_/g, " ");
  return planetClassLabel(planetClass);
}

/** What a body's class reads as: the game's name, else the random kinds' words or the key made readable. */
export function bodyClassName(planetClass: string, names: Names, moon = false): string {
  // The game localises the class key "random" to nothing, so an empty entry is a miss.
  const text = names.get(planetClass);
  if (text) return text;
  const unrolled = planetClass === "" || planetClass === "random";
  return unrolled && moon ? "random moon" : initClassLabel(planetClass);
}

/** A body's name: its own, else its class's, capitalised. */
export function bodyName(
  planet: Pick<PlanetSummary, "name" | "name_key" | "class"> & { moon?: boolean },
  names: Names,
): string {
  const named = templateName(planet);
  if (named !== "") return named;
  const text = bodyClassName(planet.class, names, planet.moon);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A plain outpost earns no icon: the border already says the system is held. */
export function starbaseShown(level: string): boolean {
  return level !== `${STARBASE_LEVEL_PREFIX}outpost`;
}

export function starbaseKeys(
  level: string,
  levels: ReadonlyMap<string, StarbaseLevelView>,
  owner?: CountryNode,
): string[] {
  const symbol = owner?.flag_icon;
  if (empireShield(level, levels) && symbol) {
    return [`symbol:${symbol.category}/${symbol.file}`];
  }
  const frame = levels.get(level)?.icon_frame ?? OUTPOST_FRAME;
  return [`sprite:GFX_starbase_ship_size_small#${frame}`];
}

/** Vanilla levels flagged `display_empire_shield`, for when the game's definitions are not loaded. */
const EMPIRE_SHIELD_FALLBACK = /^starbase_level_(marauder|caravaneer|exd|gatebuilders|hatchery)$/;

/** Whether the game marks this station with its owner's flag rather than a level glyph. */
export function empireShield(
  level: string,
  levels: ReadonlyMap<string, StarbaseLevelView>,
): boolean {
  return levels.get(level)?.empire_shield ?? EMPIRE_SHIELD_FALLBACK.test(level);
}

/** Owner-built levels get the station ring; enclaves, marauders and the like the point-of-interest one. */
export function starbaseFrame(level: string): IconFrame {
  return ORDINARY_STARBASE_LEVELS.has(level) ? "station" : "poi";
}

/** Whether a level is one of the three a wayline network's stations wear. */
export function isWaystationLevel(level: string): boolean {
  return level.startsWith(WAYSTATION_LEVEL_PREFIX);
}

/** `swaystation_research` → `research`; null for a plain or unknown one. */
export function waystationType(kind: string): string | null {
  if (!kind.startsWith(WAYSTATION_KIND_PREFIX)) return null;
  const type = kind.slice(WAYSTATION_KIND_PREFIX.length);
  return WAYSTATION_TYPES.has(type) ? type : null;
}

/** `starbase_level_starport` → `Starport`, `starbase_level_waystation_2` → `Wayport`. */
export function starbaseLabel(level: string): string {
  if (isWaystationLevel(level)) {
    const tier = Number(level.slice(WAYSTATION_LEVEL_PREFIX.length).replace(/^_/, ""));
    return WAYSTATION_LEVEL_WORDS[tier - 1] ?? WAYSTATION_LEVEL_WORDS[0];
  }
  const name = level.startsWith(STARBASE_LEVEL_PREFIX)
    ? level.slice(STARBASE_LEVEL_PREFIX.length)
    : level;
  return keyWords(name);
}

/**
 * `ring_world_ruined` → Ring World, ruined; `dyson_sphere_2` → Dyson Sphere, stage 2; a type
 * with no state suffix is complete. The number of stages lives in game data, so a stage says
 * only which one it is.
 */
export function megastructureParts(kind: string): MegastructureParts {
  const words = kind.split("_").filter(Boolean);
  let state = "complete";
  let warn = false;
  while (words.length > 1) {
    const last = words[words.length - 1];
    const found = suffixState(last);
    if (found === null && !MEGASTRUCTURE_FILLER.test(last)) break;
    // The outermost suffix wins: `dyson_gun_0_restored` is restored, not under construction.
    if (found !== null && state === "complete") {
      state = found;
      warn = MEGASTRUCTURE_STATES[last] ?? false;
    }
    words.pop();
  }
  return { name: titleCase(words, MEGASTRUCTURE_WORDS), state, warn };
}

function suffixState(word: string): string | null {
  if (word in MEGASTRUCTURE_STATES) return word;
  if (!/^\d+$/.test(word)) return null;
  return word === "0" ? "under construction" : `stage ${word}`;
}

/** `ring_world_ruined` → `Ring World (ruined)`, `dyson_sphere_3` → `Dyson Sphere (stage 3)`. */
export function megastructureLabel(kind: string): string {
  const { name, state } = megastructureParts(kind);
  return PLAIN_MEGASTRUCTURE_STATES.has(state) ? name : `${name} (${state})`;
}

/**
 * Gateways, L-Gates and hyper relays are megastructures the save also lists as bypasses, where
 * their icon belongs.
 */
export function isBypassMegastructure(kind: string): boolean {
  return /^(gateway|lgate|hyper_relay)/.test(kind);
}

/** A gateway, whose open or closed state the save keeps in the bypass list, not in the type name. */
export function isGatewayMegastructure(kind: string): boolean {
  return kind.startsWith("gateway");
}

export function shownMegastructures(
  megastructures: readonly MegastructureSummary[],
): MegastructureSummary[] {
  return megastructures.filter((m) => !isBypassMegastructure(m.kind));
}

/** One icon for all the megastructures here, titled by the one or their count; null without any. */
export function megastructureIcon(megastructures: readonly MegastructureSummary[]): Icon | null {
  return collapsedIcon(
    shownMegastructures(megastructures).map((m) => megastructureLabel(m.kind)),
    "megastructure",
    [MEGASTRUCTURE_ICON_KEY],
    "◈",
  );
}

/** One icon for all the archaeology sites here; null without any. */
export function siteIcon(kinds: readonly string[]): Icon | null {
  return collapsedIcon(kinds.map(siteLabel), "archaeology site", ARCHAEOLOGY_ICON_KEYS, "⚱");
}

function collapsedIcon(labels: string[], noun: string, keys: string[], glyph: string): Icon | null {
  if (labels.length === 0) return null;
  const label = labels.length === 1 ? labels[0] : `${labels.length} ${noun}s`;
  return { keys, glyph, label, frame: "poi" };
}

/** The bypasses the game names itself; `common/bypass` carries no display name for the rest. */
const BYPASS_NAMES: Record<string, string> = {
  wormhole: "Wormhole",
  gateway: "Gateway",
  l_gate: "L-Gate",
  lgate: "L-Gate",
};

/** What a bypass kind is called: the game's own word, else its key's words. */
export function bypassName(kind: string): string {
  return BYPASS_NAMES[kind] ?? (keyWords(kind) || kind);
}

function bypassIcon(kind: string, label: string, kinds?: BypassKinds): Icon {
  const key = bypassIconKey(kind, kinds);
  return {
    keys: key === null ? [] : [key],
    glyph: "◎",
    label,
    frame: kind === "lgate" ? "lgate" : "bypass",
  };
}

/** The icon and label one of a scenario's bypass endpoints wears. */
export function scenarioBypassIcon(kind: BypassKind, kinds?: BypassKinds): Icon {
  switch (kind.type) {
    case "wormhole":
      return bypassIcon("wormhole", "Natural wormhole", kinds);
    case "gateway":
      return bypassIcon("gateway", kind.ruined ? "Gateway (ruined)" : "Gateway", kinds);
    case "other":
      return bypassIcon(kind.kind, bypassName(kind.kind), kinds);
  }
}

/** One icon per bypass touching system `id`, in the galaxy's order. */
export function bypassIcons(
  bypasses: readonly BypassLink[],
  id: number,
  kinds?: BypassKinds,
): Icon[] {
  const icons: Icon[] = [];
  for (const b of bypasses) {
    switch (b.type) {
      case "wormhole":
        if (b.a === id || b.b === id) icons.push(bypassIcon("wormhole", "Natural wormhole", kinds));
        break;
      case "gateway":
        if (b.system === id)
          icons.push(bypassIcon("gateway", b.active ? "Gateway" : "Gateway (inactive)", kinds));
        break;
      case "l_gate":
        if (b.system === id) icons.push(bypassIcon("lgate", "L-Gate", kinds));
        break;
      case "other":
        if (b.system === id) icons.push(bypassIcon(b.kind, bypassName(b.kind), kinds));
        break;
    }
  }
  return icons;
}

/** `site_tiyanki_graveyard` → `Tiyanki Graveyard`. */
export function siteLabel(kind: string): string {
  const words = kind
    .replace(/^site_/, "")
    .split("_")
    .filter(Boolean);
  return words.length === 0 ? kind : titleCase(words);
}

/** Every localisation key the details bar and its tooltips show for `d`: planet and fleet names, resource ids. */
export function detailNameKeys(d: SystemDetails): string[] {
  const keys: string[] = [];
  for (const p of d.planets) keys.push(...templateKeys(p.name));
  for (const f of d.fleets_present) keys.push(...templateKeys(f.name));
  if (d.starbase) keys.push(...templateKeys(d.starbase.name));
  for (const r of d.resources) keys.push(canonicalResource(r.resource));
  return keys;
}
