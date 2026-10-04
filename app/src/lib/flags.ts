import type { CountryNode } from "../generated/CountryNode";
import type { EmpireFlag } from "../generated/EmpireFlag";
import type { FlagParts } from "../generated/FlagParts";
import type { FlagRef } from "../generated/FlagRef";
import type { MapColor } from "../generated/MapColor";
import type { Swatch } from "../panels/EditField";
import type { TileGroup, TileItem } from "../panels/TilePicker";
import { flagKey } from "./flagKey";

/** Which of a palette colour's looks a swatch shows: on the map, or in the flag. */
export type PaletteUse = "map" | "flag";

/** A palette colour as a swatch: its colour for `use`, and its name, or a note that it is not there. */
export function paletteSwatch(
  name: string,
  palette: ReadonlyMap<string, MapColor>,
  use: PaletteUse,
): Swatch {
  const color = palette.get(name);
  if (color === undefined) return { key: name, label: `unknown: ${name}` };
  return { key: name, label: name, color: color[use] };
}

/** Which palette the swatches come from, and what choosing from a mod's asks of the save. */
export function paletteLines(
  palette: ReadonlyMap<string, MapColor>,
  source: string | null,
): string[] {
  if (palette.size === 0) return ["Load game data to pick from the game's palette."];
  if (source === null) return ["Palette: Stellaris"];
  return [`Palette: ${source}`, "The save needs this mod to show these colours."];
}

/** The flag an empire has, as the op takes it; null when the save gives no complete flag. */
export function empireFlag(country: CountryNode): EmpireFlag | null {
  const icon = country.flag_icon;
  const background = country.flag_background;
  const [primary, secondary] = country.colors;
  if (!icon || !background || primary === undefined || secondary === undefined) return null;
  return {
    icon_category: icon.category,
    icon_file: icon.file,
    background: background.file,
    primary,
    secondary,
  };
}

/** Whether two flags are the same in every part. */
export function sameFlag(a: EmpireFlag, b: EmpireFlag): boolean {
  return (
    a.icon_category === b.icon_category &&
    a.icon_file === b.icon_file &&
    a.background === b.background &&
    a.primary === b.primary &&
    a.secondary === b.secondary
  );
}

/** A flag file's name as the pickers show it. */
function fileLabel(file: string): string {
  return file.replace(/\.dds$/i, "");
}

export function emblemItem(category: string, file: string): TileItem {
  return {
    key: `${category}/${file}`,
    label: fileLabel(file),
    textures: [`flag:${category}/${file}`],
  };
}

/**
 * The emblem categories as the dropdown lists them, each with its count: the game's first, in
 * alphabetical order, then those only mods add, under a heading and named with their mods.
 */
export function emblemGroups(parts: FlagParts): TileGroup[] {
  const groups = parts.emblems.map((category): TileGroup => {
    const name = `${category.name.replace(/_/g, " ")} ${category.files.length}`;
    const mods = [...new Set(category.files.map((f) => f.source))];
    const modded = mods.every((mod) => mod !== null);
    return {
      key: category.name,
      label: name,
      section: modded ? "From mods" : undefined,
      note: modded ? (mods.length === 1 ? mods[0] : `${mods.length} mods`) : undefined,
      items: category.files.map((f) => emblemItem(category.name, f.file)),
    };
  });
  const game = groups.filter((g) => g.section === undefined);
  const mods = groups.filter((g) => g.section !== undefined);
  const byLabel = (a: TileGroup, b: TileGroup) => a.label.localeCompare(b.label);
  return [...game.sort(byLabel), ...mods.sort(byLabel)];
}

/** A background in the empire's colours, without the emblem. */
export function backgroundItem(
  file: string,
  background: FlagRef,
  colors: readonly string[],
): TileItem {
  return {
    key: file,
    label: fileLabel(file),
    textures: [flagKey({ ...background, file }, null, colors)],
  };
}

/** The mods the flag's emblem and background come from, each once. */
export function flagMods(flag: EmpireFlag, parts: FlagParts): string[] {
  const emblem = parts.emblems
    .find((category) => category.name === flag.icon_category)
    ?.files.find((f) => f.file === flag.icon_file);
  const background = parts.backgrounds.find((f) => f.file === flag.background);
  const mods = [emblem?.source, background?.source].filter(
    (mod): mod is string => typeof mod === "string",
  );
  return [...new Set(mods)];
}
