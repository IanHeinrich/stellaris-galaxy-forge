import { useEffect, useMemo } from "react";
import type { CountryNode } from "../../../generated/CountryNode";
import type { EntityView as EntityViewData } from "../../../generated/EntityView";
import type { MapColor } from "../../../generated/MapColor";
import type { MapColorPair } from "../../../generated/MapColorPair";
import { empireFlagKey } from "../../../lib/details/fleets";
import { displayNameIn, templateName } from "../../../lib/names";
import { counted } from "../../../lib/text";
import { useEditorStore } from "../../../store/editorStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
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
import { useApplyOp } from "../../useApplyOp";
import { useOwnerCss } from "../ownerCss";
import { Icon, LinkRow, LockedRow, Properties, PropertyRow } from "../parts";
import { EntityView } from "./EntityView";
import "./entity.css";
import { useEntityView } from "./useEntity";

/** Where `flag.colors` keeps the map border and fill in a 4.5 save: after the four flag colours. */
const MAP_BORDER = 4;
const MAP_FILL = 5;

export const MAP_COLORS_NEED_4_5 = "Map colours need a Stellaris 4.5 save";

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
export function MapColorFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  const entries = country.flag_colors;
  if (entries.length <= MAP_FILL) return <MapColorsUnavailable />;
  const border = entries[MAP_BORDER];
  const fill = entries[MAP_FILL];
  const on = country.use_map_color;
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
  const names = useGameDataStore((s) => s.names);
  const authority = authorityOf(view);
  useEffect(() => {
    if (authority !== null) void useGameDataStore.getState().fetchNames([authority]);
  }, [authority]);
  return (
    <LockedRow label="Government" reason="This editor cannot change an empire's government yet.">
      {authority === null ? "on the Data tab" : displayNameIn(names, authority)}
    </LockedRow>
  );
}

function About({ country }: { country: CountryNode }) {
  const jumpTo = useEditorStore((s) => s.jumpTo);
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
            onOpen={() => void jumpTo(capital)}
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

/** A save empire's own page: its map colours to edit first, then what it is. */
export function EmpireOverview({ country }: { country: CountryNode }) {
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
