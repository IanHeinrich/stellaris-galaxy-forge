import type { FlagIcon } from "../../generated/FlagIcon";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { SpecialSystem } from "../../generated/SpecialSystem";
import { megastructureLabel, shownMegastructures } from "../details/labels";
import { displayNameIn } from "../names";
import { kindLabel } from "../special";
import { titleCase } from "../text";
import type { LabelTier } from "./labels";

export const KIND_STYLE: Record<SpecialKind, { color: number }> = {
  leviathan: { color: 0xff5533 },
  enclave: { color: 0x2dd4bf },
  marauder: { color: 0x9333ea },
  fallen_empire: { color: 0xd4af37 },
  landmark: { color: 0x8b5cf6 },
  unique: { color: 0x22c55e },
};

/** Rare and always worth a badge, even zoomed all the way out. */
export const NOTABLE_KINDS: ReadonlySet<SpecialKind> = new Set([
  "leviathan",
  "enclave",
  "marauder",
  "fallen_empire",
  "landmark",
]);

/** Kinds that own whole territories: the owners layer emphasises their borders instead of badging each system. */
export const TERRITORY_KINDS: ReadonlySet<SpecialKind> = new Set(["marauder", "fallen_empire"]);
/** One bright colour for every emphasised territory. */
export const EMPHASIS_COLOR = 0xffe08a;

/** Whether a kind's badge shows at the given zoom tier. */
export function badgeVisible(kind: SpecialKind, tier: LabelTier): boolean {
  if (TERRITORY_KINDS.has(kind)) return false;
  return NOTABLE_KINDS.has(kind) || tier !== "none";
}

/** Screen-pixel geometry of a badge plate: large on the whole-galaxy view, compact once names show. */
export interface BadgeGeometry {
  icon: number;
  font: number;
  pad: number;
  gap: number;
  radius: number;
  halo: number;
}

export const BADGE_FAR: BadgeGeometry = { icon: 26, font: 13, pad: 5, gap: 5, radius: 6, halo: 18 };
export const BADGE_NEAR: BadgeGeometry = { icon: 18, font: 11, pad: 4, gap: 4, radius: 5, halo: 0 };

export function badgeGeometry(tier: LabelTier): BadgeGeometry {
  return tier === "none" ? BADGE_FAR : BADGE_NEAR;
}

export type BadgeSide = "above" | "below";

/** Neighbouring badges on the whole-galaxy view alternate sides so they do not stack. */
export function badgeSide(id: number, tier: LabelTier): BadgeSide {
  return tier === "none" && id % 2 === 1 ? "below" : "above";
}

/** The game's name for each vanilla guardian, for when its definitions are not loaded. */
export const LEVIATHAN_NAMES: Record<string, string> = {
  guardians_init_dragon: "NAME_Ether_Drake",
  guardians_init_horror: "NAME_Dimensional_Horror",
  guardians_init_fortress: "NAME_Enigmatic_Fortress",
  guardians_init_dreadnought: "NAME_Automated_Dreadnought",
  guardians_init_stellarites: "NAME_Stellarite_Devourer",
  guardians_init_technosphere: "NAME_Infinity_Machine",
  guardians_init_hive: "NAME_Hive_Asteroid",
  guardians_init_hatchling: "NAME_Voidspawn",
  guardians_init_wraith: "NAME_Wraith",
  elderly_tiyanki_system: "NAME_Elderly_Tiyanki",
  scavenger_system: "NAME_Scavenger_Bot",
  toxic_knights_finish: "NAME_Toxic_God",
};

const INITIALIZER_PREFIX = /^(guardians_init_|mem_|the_)+/;
const INITIALIZER_SUFFIX = /(_initializer|_system|_init|_\d+)+$/;

/** `mem_mortis_system_initializer` → `Mortis`, `abandoned_gateways_01` → `Abandoned Gateways`. */
export function humaniseInitializer(initializer: string): string {
  const core = initializer.replace(INITIALIZER_PREFIX, "").replace(INITIALIZER_SUFFIX, "");
  return titleCase((core === "" ? initializer : core).split("_"));
}

/**
 * The vanilla stand-in for an initializer the loaded game data does not define, which is every
 * one of them when no game data is loaded.
 */
function vanilla<T>(special: SpecialSystem | undefined, table: Record<string, T>): T | undefined {
  return special && !special.initializer_known ? table[special.initializer] : undefined;
}

/** The classifier's name when it says more than the system's own. */
function classifierLabel(special: SpecialSystem | undefined, systemName: string): string | null {
  const label = special?.label ?? "";
  return label !== "" && label !== systemName ? label : null;
}

function initializerLabel(special: SpecialSystem | undefined): string | null {
  return special && special.initializer !== "" ? humaniseInitializer(special.initializer) : null;
}

/** Vanilla enclaves whose country takes a random generated name, so the badge names the enclave. */
const GENERATED_NAME_HIDDEN: ReadonlySet<string> = new Set(["salvager_enclave"]);

function hidesGeneratedName(initializer: string): boolean {
  return GENERATED_NAME_HIDDEN.has(initializer.replace(INITIALIZER_SUFFIX, ""));
}

/**
 * The badge text, always saying what the system is: a leviathan by the country the classifier
 * found, a landmark by the megastructure standing there, an enclave by the classifier's name
 * unless that name is a generated one this map hides, else the classifier's name; a
 * humanised initializer before the kind alone.
 */
export function badgeLabel(
  kind: SpecialKind,
  special: SpecialSystem | undefined,
  systemName: string,
  names: ReadonlyMap<string, string>,
  megastructures: readonly MegastructureSummary[] = [],
): string {
  switch (kind) {
    case "leviathan": {
      const key = vanilla(special, LEVIATHAN_NAMES);
      const name = key === undefined ? undefined : displayNameIn(names, key);
      return (
        classifierLabel(special, systemName) ?? name ?? initializerLabel(special) ?? kindLabel(kind)
      );
    }
    case "landmark": {
      const megastructure = shownMegastructures(megastructures)[0];
      return (
        (megastructure && megastructureLabel(megastructure.kind)) ??
        initializerLabel(special) ??
        classifierLabel(special, systemName) ??
        kindLabel(kind)
      );
    }
    case "enclave": {
      const hidden =
        special?.label_is_generated_name === true && hidesGeneratedName(special.initializer);
      const label = hidden ? null : classifierLabel(special, systemName);
      return label ?? initializerLabel(special) ?? kindLabel(kind);
    }
    default:
      return classifierLabel(special, systemName) ?? kindLabel(kind);
  }
}

/** The game's own art for each vanilla guardian, likewise for when its definitions are not loaded. */
const LEVIATHAN_ICONS: Record<string, string> = {
  guardians_init_dragon: "symbol:zoological/flag_zoological_9.dds",
  guardians_init_hatchling: "symbol:zoological/flag_zoological_11.dds",
  guardians_init_horror: "symbol:zoological/flag_zoological_18.dds",
  guardians_init_dreadnought: "symbol:pointy/flag_pointy_15.dds",
  guardians_init_fortress: "symbol:spherical/flag_spherical_1.dds",
  guardians_init_stellarites: "symbol:ornate/flag_ornate_19.dds",
  guardians_init_technosphere: "symbol:spherical/flag_spherical_2.dds",
  guardians_init_wraith: "symbol:ornate/flag_ornate_17.dds",
  guardians_init_hive: "symbol:zoological/flag_zoological_1.dds",
  scavenger_system: "symbol:spherical/flag_spherical_16.dds",
  elderly_tiyanki_system: "symbol:zoological/flag_zoological_4.dds",
  toxic_knights_finish: "symbol:zoological/flag_zoological_24.dds",
};

const KIND_ICONS: Record<SpecialKind, string> = {
  leviathan: "symbol:pirate/flag_pirate_3.dds",
  enclave: "symbol:enclaves/enclaves_flag_curator.dds",
  marauder: "symbol:pirate/flag_pirate_5.dds",
  fallen_empire: "symbol:special/the_empire.dds",
  landmark: "sprite:GFX_point_of_interest_levels#1",
  unique: "symbol:pointy/flag_pointy_16.dds",
};

/** The texture key for a flag symbol, the game's white-on-transparent emblem art. */
export function symbolKey(icon: FlagIcon | null | undefined): string | null {
  return icon ? `symbol:${icon.category}/${icon.file}` : null;
}

/**
 * The texture key for a badge's icon: the spawned country's flag symbol for a leviathan, an
 * enclave or a fallen empire, else the kind's icon.
 */
export function badgeIconKey(kind: SpecialKind, special: SpecialSystem | undefined): string {
  const countryIcon = symbolKey(special?.countries[0]?.icon);
  switch (kind) {
    case "leviathan":
      return countryIcon ?? vanilla(special, LEVIATHAN_ICONS) ?? KIND_ICONS.leviathan;
    case "enclave":
    case "fallen_empire":
      return countryIcon ?? KIND_ICONS[kind];
    default:
      return KIND_ICONS[kind];
  }
}
