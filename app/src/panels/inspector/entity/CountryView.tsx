import { useMemo } from "react";
import type { CountryNode } from "../../../generated/CountryNode";
import type { EmpireFlag } from "../../../generated/EmpireFlag";
import type { EntityView as EntityViewData } from "../../../generated/EntityView";
import type { FlagParts } from "../../../generated/FlagParts";
import type { FlagRef } from "../../../generated/FlagRef";
import type { MapColor } from "../../../generated/MapColor";
import type { MapColorPair } from "../../../generated/MapColorPair";
import { empireFlagKey } from "../../../lib/details/fleets";
import { flagKey } from "../../../lib/flagKey";
import { stripped, templateName } from "../../../lib/names";
import { counted } from "../../../lib/text";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { openSystem } from "../../../store/commands";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import {
  EditBlock,
  EditKey,
  EditNote,
  EditRow,
  SwatchField,
  ToggleField,
  type Swatch,
} from "../../EditField";
import { GridPicker, type GridPickerGroup, type GridPickerItem } from "../../GridPicker";
import { useApplyOp } from "../../useApplyOp";
import { useNamed } from "../../useNamed";
import { useOwnerCss } from "../ownerCss";
import { Icon } from "../../parts";
import { LinkRow, LockedRow, Properties, PropertyRow } from "../parts";
import { EntityView } from "./EntityView";
import "./entity.css";
import { useEntityView } from "./useEntity";

export const MAP_COLORS_NEED_4_5 = "Map colours need a Stellaris 4.5 save";
export const FLAG_NEEDS_GAME_DATA = "Load game data to change the flag";
export const FLAG_UNREADABLE = "The save has no complete flag for this empire";

/** The root level of the country, whose government the About block reads. */
const ROOT: readonly string[] = [];

/** A palette colour as a swatch: its map colour, and its name, or a note that it is not there. */
function colorSwatch(name: string, palette: ReadonlyMap<string, MapColor>): Swatch {
  const color = palette.get(name);
  if (color === undefined) return { key: name, label: `unknown: ${name}` };
  return { key: name, label: name, color: color.map };
}

/** Which palette the swatches come from, and what choosing from a mod's asks of the save. */
function paletteLines(palette: ReadonlyMap<string, MapColor>, source: string | null): string[] {
  if (palette.size === 0) return ["Load game data to pick from the game's palette."];
  if (source === null) return ["Palette: Stellaris"];
  return [`Palette: ${source}`, "The save needs this mod to show these colours."];
}

/** The flag an empire has, as the op takes it; null when the save gives no complete flag. */
function empireFlag(country: CountryNode): EmpireFlag | null {
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

/** A flag file's name as the pickers show it. */
function fileLabel(file: string): string {
  return file.replace(/\.dds$/i, "");
}

function emblemItem(category: string, file: string): GridPickerItem {
  return {
    key: `${category}/${file}`,
    label: fileLabel(file),
    textures: [`flag:${category}/${file}`],
  };
}

/** A background as the whole flag it makes with the empire's emblem and colours. */
function backgroundItem(
  file: string,
  icon: FlagRef,
  background: FlagRef,
  colors: readonly string[],
): GridPickerItem {
  return {
    key: file,
    label: fileLabel(file),
    textures: [flagKey({ ...background, file }, icon, colors)],
  };
}

/** A palette colour as a flag swatch: its flag colour, and its name, or a note that it is not there. */
function flagSwatch(name: string, palette: ReadonlyMap<string, MapColor>): Swatch {
  const color = palette.get(name);
  if (color === undefined) return { key: name, label: `unknown: ${name}` };
  return { key: name, label: name, color: color.flag };
}

/** The mods the flag's emblem and background come from, each once. */
function flagMods(flag: EmpireFlag, parts: FlagParts): string[] {
  const emblem = parts.emblems
    .find((category) => category.name === flag.icon_category)
    ?.files.find((f) => f.file === flag.icon_file);
  const background = parts.backgrounds.find((f) => f.file === flag.background);
  const mods = [emblem?.source, background?.source].filter(
    (mod): mod is string => typeof mod === "string",
  );
  return [...new Set(mods)];
}

/** The flag fields, disabled, and why. */
function FlagUnavailable({ reason }: { reason: string }) {
  const none: GridPickerItem = { key: "", label: "none", textures: [] };
  const noColor: Swatch = { key: "", label: "none" };
  return (
    <EditBlock title="Flag">
      {["Emblem", "Background"].map((label) => (
        <EditRow key={label} label={label}>
          <GridPicker
            label={label}
            disabledReason={reason}
            current={none}
            groups={[]}
            onPick={() => undefined}
          />
        </EditRow>
      ))}
      {["Primary", "Secondary"].map((label) => (
        <EditRow key={label} label={label}>
          <SwatchField
            label={label}
            disabledReason={reason}
            current={noColor}
            swatches={[]}
            onPick={() => undefined}
          />
        </EditRow>
      ))}
      <EditNote>{reason}</EditNote>
    </EditBlock>
  );
}

/** A save empire's flag: its emblem, its background and its two colours. */
function FlagFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const parts = useGameDataStore((s) => s.flagParts);
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  const flag = empireFlag(country);
  const icon = country.flag_icon;
  const background = country.flag_background;
  if (flag === null || !icon || !background) return <FlagUnavailable reason={FLAG_UNREADABLE} />;
  if (parts.emblems.length === 0 && parts.backgrounds.length === 0) {
    return <FlagUnavailable reason={FLAG_NEEDS_GAME_DATA} />;
  }
  const set = (change: Partial<EmpireFlag>) => {
    const next = { ...flag, ...change };
    const keys = Object.keys(next) as (keyof EmpireFlag)[];
    if (keys.some((key) => next[key] !== flag[key])) {
      applyOp({ type: "SetEmpireFlag", country: country.id, flag: next });
    }
  };
  const emblems: GridPickerGroup[] = parts.emblems.map((category) => ({
    key: category.name,
    label: category.name.replace(/_/g, " "),
    items: category.files.map((f) => emblemItem(category.name, f.file)),
  }));
  const backgrounds: GridPickerGroup[] = [
    {
      key: "backgrounds",
      label: "Backgrounds",
      items: parts.backgrounds.map((f) => backgroundItem(f.file, icon, background, country.colors)),
    },
  ];
  const swatches = [...palette.keys()].map((name) => flagSwatch(name, palette));
  return (
    <EditBlock title="Flag">
      <EditRow label="Emblem">
        <GridPicker
          label="Emblem"
          title="The emblem in the middle of the flag"
          current={emblemItem(flag.icon_category, flag.icon_file)}
          groups={emblems}
          onPick={(key) => {
            const [icon_category, icon_file] = key.split("/");
            set({ icon_category, icon_file });
          }}
        />
      </EditRow>
      <EditRow label="Background">
        <GridPicker
          label="Background"
          title="The pattern behind the emblem"
          current={backgroundItem(flag.background, icon, background, country.colors)}
          groups={backgrounds}
          onPick={(file) => set({ background: file })}
        />
      </EditRow>
      <EditRow label="Primary">
        <SwatchField
          label="Primary"
          title="The flag's main colour"
          current={flagSwatch(flag.primary, palette)}
          swatches={swatches}
          onPick={(primary) => set({ primary })}
        />
      </EditRow>
      <EditRow label="Secondary">
        <SwatchField
          label="Secondary"
          title="The flag's second colour"
          current={flagSwatch(flag.secondary, palette)}
          swatches={swatches}
          onPick={(secondary) => set({ secondary })}
        />
      </EditRow>
      {flagMods(flag, parts).map((mod) => (
        <EditNote key={mod}>{`The save needs ${mod} to show this flag.`}</EditNote>
      ))}
      {paletteLines(palette, source).map((line) => (
        <EditNote key={line}>{line}</EditNote>
      ))}
    </EditBlock>
  );
}

/** A 4.4 save's empire: the map colour fields, disabled, and why. */
function MapColorsUnavailable() {
  const none: Swatch = { key: "", label: "none" };
  return (
    <EditBlock title="Map colours">
      <EditRow label="Border">
        <SwatchField
          label="Border"
          disabledReason={MAP_COLORS_NEED_4_5}
          current={none}
          swatches={[]}
          onPick={() => undefined}
        />
      </EditRow>
      <EditRow label="Fill">
        <SwatchField
          label="Fill"
          disabledReason={MAP_COLORS_NEED_4_5}
          current={none}
          swatches={[]}
          onPick={() => undefined}
        />
      </EditRow>
      <EditNote>{MAP_COLORS_NEED_4_5}</EditNote>
    </EditBlock>
  );
}

/** A save empire's map border and fill, or its flag colours in their place. */
function MapColorFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  if (!country.has_map_colors) return <MapColorsUnavailable />;
  const on = country.use_map_color;
  const border = country.painted_border ?? "";
  const fill = country.painted_fill ?? "";
  const set = (colors: MapColorPair | null) =>
    applyOp({ type: "SetEmpireMapColors", country: country.id, colors });
  const pick = (pair: MapColorPair) => {
    if (!on || pair.border !== border || pair.fill !== fill) set(pair);
  };
  const swatches = [...palette.keys()].map((name) => colorSwatch(name, palette));
  return (
    <EditBlock title="Map colours">
      <EditRow label="Border">
        <SwatchField
          label="Border"
          title="The colour of the empire's border on the map"
          current={colorSwatch(border, palette)}
          swatches={swatches}
          onPick={(name) => pick({ border: name, fill })}
        />
      </EditRow>
      <EditRow label="Fill">
        <SwatchField
          label="Fill"
          title="The colour the empire's territory is filled with on the map"
          current={colorSwatch(fill, palette)}
          swatches={swatches}
          onPick={(name) => pick({ border, fill: name })}
        />
      </EditRow>
      <ToggleField
        label="Use flag colours instead"
        checked={!on}
        onChange={(flag) => set(flag ? null : { border, fill })}
      />
      {paletteLines(palette, source).map((line) => (
        <EditNote key={line}>{line}</EditNote>
      ))}
    </EditBlock>
  );
}

/** The authority key `government` states, where the country's root level has been read. */
function authorityOf(view: EntityViewData | undefined): string | null {
  const node = view?.nodes.find(
    (n) => n.path.join("/") === "government/authority" && n.value.kind === "scalar",
  );
  return node?.value.kind === "scalar" ? node.value.text : null;
}

function Government({ id }: { id: number }) {
  const addr = useMemo(() => ({ kind: "country" as const, id }), [id]);
  const { value: view } = useEntityView(addr, ROOT);
  const authority = authorityOf(view);
  const named = useNamed(authority === null ? [] : [authority], stripped);
  return (
    <LockedRow label="Government" reason="This editor cannot change an empire's government yet.">
      {authority === null ? "on the Data tab" : named(authority)}
    </LockedRow>
  );
}

function About({ country }: { country: CountryNode }) {
  const systemName = useGalaxyStore((s) => s.systemName);
  const capital = country.capital_system;
  return (
    <>
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        {capital === null ? (
          <PropertyRow label="Capital">none</PropertyRow>
        ) : (
          <LinkRow
            label="Capital"
            title="Select the capital system"
            onOpen={() => openSystem(capital)}
          >
            {systemName(capital)}
          </LinkRow>
        )}
        <PropertyRow label="Systems">{counted(country.system_count, "system")}</PropertyRow>
        <Government id={country.id} />
      </Properties>
    </>
  );
}

/** A save empire's own page: its flag and map colours to edit first, then what it is. */
function EmpireOverview({ country }: { country: CountryNode }) {
  const color = useOwnerCss(country.id) ?? undefined;
  const flag = empireFlagKey(country);
  return (
    <>
      <div className="ins-head ins-country-head">
        <Icon
          className="ins-emblem"
          keys={flag === null ? [] : [flag]}
          style={{ background: color }}
        />
        <span className="name">{templateName(country)}</span>
        <span className="muted mono">#{country.id}</span>
      </div>
      <FlagFields country={country} />
      <MapColorFields country={country} />
      <About country={country} />
      <EditKey />
    </>
  );
}

/**
 * A country: a save empire's Overview is its own page, and every other tab, or a country the
 * galaxy does not list, is the generic entity view.
 */
export function CountryView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const id = entry.ref.kind === "country" ? entry.ref.id : null;
  const country = useGalaxyStore((s) => (id === null ? undefined : s.countries.get(id)));
  if (tab !== "overview" || country === undefined) return <EntityView entry={entry} />;
  return <EmpireOverview country={country} />;
}
