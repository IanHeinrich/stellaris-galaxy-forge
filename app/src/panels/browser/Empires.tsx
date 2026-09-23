import { useMemo, useState } from "react";
import type { CountryNode } from "../../generated/CountryNode";
import type { MapColor } from "../../generated/MapColor";
import type { MapColorPair } from "../../generated/MapColorPair";
import type { ScenarioOwners } from "../../generated/ScenarioOwners";
import type { Territory } from "../../generated/Territory";
import { empireGroups, specialSystemOfCountry } from "../../lib/browserRows";
import { empireFlagKey } from "../../lib/details/fleets";
import { systemsOf, type Ownership } from "../../lib/ownership";
import { ownerColor, toCss } from "../../lib/visual/ownerColors";
import { rowLookups, type EmpireRow } from "../../store/browserRows";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useOwnership } from "../../store/ownership";
import { IconPicker, type IconPickerItem } from "../IconPicker";
import { Chip, SourceChip } from "../inspector/parts";
import { useApplyOp } from "../useApplyOp";
import { useCollapse } from "./collapse";
import { Action, Emblem, Eye, Group, Row } from "./rows";

/** Why a territory's day-one badge means what it means, shown on hover. */
const DAY_ONE_TITLE =
  "Claimed on day one, by an event on_game_start fires, not at galaxy generation.";

/** Why a territory's assumed marker means what it means, shown on hover. */
const ASSUMED_TITLE = "A claim whose conditions this editor cannot judge is marked assumed.";

/** Where `flag.colors` keeps the map border and fill in a 4.5 save: after the four flag colours. */
const MAP_BORDER = 4;
const MAP_FILL = 5;

export const MAP_COLORS_NEED_4_5 = "Map colours need a Stellaris 4.5 save";

/** A palette colour as a picker row: its map colour as a swatch, and its name. */
function colorItem(name: string, palette: ReadonlyMap<string, MapColor>): IconPickerItem {
  const color = palette.get(name);
  if (color === undefined) return { key: name, label: `unknown: ${name}` };
  return {
    key: name,
    label: name,
    icon: <span className="swatch" style={{ background: color.map }} />,
  };
}

/** Which palette the swatches come from, and what choosing from a mod's asks of the save. */
function paletteLines(palette: ReadonlyMap<string, MapColor>, source: string | null): string[] {
  if (palette.size === 0) return ["Load game data to pick from the game's palette."];
  if (source === null) return ["Palette: Stellaris"];
  return [`Palette: ${source}`, "The save needs this mod to show these colours."];
}

/** A save empire's edit strip: its map border and fill, or its flag colours in their place. */
export function MapColorStrip({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  const entries = country.flag_colors;
  if (entries.length <= MAP_FILL) {
    return (
      <div className="browser-edit">
        <div className="browser-edit-note">{MAP_COLORS_NEED_4_5}</div>
      </div>
    );
  }
  const border = entries[MAP_BORDER];
  const fill = entries[MAP_FILL];
  const on = country.use_map_color;
  const set = (colors: MapColorPair | null) =>
    applyOp({ type: "SetEmpireMapColors", country: country.id, colors });
  const pick = (pair: MapColorPair) => {
    if (!on || pair.border !== border || pair.fill !== fill) set(pair);
  };
  const items = [...palette.keys()].map((name) => colorItem(name, palette));
  return (
    <div className="browser-edit">
      <div className="browser-edit-line">
        <span className="browser-edit-label">Map colours</span>
        <span className="browser-edit-field">
          Border
          <IconPicker
            label="Border"
            title="The colour of the empire's border on the map"
            current={colorItem(border, palette)}
            items={items}
            onPick={(name) => pick({ border: name, fill })}
          />
        </span>
        <span className="browser-edit-field">
          Fill
          <IconPicker
            label="Fill"
            title="The colour the empire's territory is filled with on the map"
            current={colorItem(fill, palette)}
            items={items}
            onPick={(name) => pick({ border, fill: name })}
          />
        </span>
      </div>
      <label className="browser-edit-check">
        <input
          type="checkbox"
          checked={!on}
          onChange={(e) => set(e.currentTarget.checked ? null : { border, fill })}
        />
        Use flag colours instead
      </label>
      {paletteLines(palette, source).map((line) => (
        <div key={line} className="browser-edit-note">
          {line}
        </div>
      ))}
    </div>
  );
}

function EmpireLine({
  row,
  station,
  territory,
  ownership,
  editable,
  editing,
  onEdit,
}: {
  row: EmpireRow;
  station: number | null;
  territory: Territory | undefined;
  ownership: Ownership;
  /** Whether the row offers its edit strip: a save's empire. */
  editable: boolean;
  editing: boolean;
  onEdit(): void;
}) {
  const hidden = useGalaxyStore((s) => s.hiddenCountries.has(row.id));
  const toggleCountryHidden = useGalaxyStore((s) => s.toggleCountryHidden);
  const systems = useGalaxyStore((s) => s.systems);
  const systemName = useGalaxyStore((s) => s.systemName);
  const mapColors = useGameDataStore((s) => s.mapColors);
  const setSelection = useEditorStore((s) => s.setSelection);
  const fitSelection = useEditorStore((s) => s.fitSelection);
  const panTo = useEditorStore((s) => s.panTo);
  const color = toCss(
    ownership.table.get(row.id)?.colors.outline ??
      ownerColor(row.country ?? undefined, row.index, mapColors),
  );
  const target = row.capital ?? station;
  const title =
    target === null
      ? `${row.name} holds no systems`
      : row.capital === null
        ? `at ${systemName(target)}`
        : row.country === null
          ? "Go to the clan's home"
          : row.country.capital_system === null
            ? "no capital: nearest to its centre"
            : "Go to the capital system";
  const country = editable ? row.country : null;
  return (
    <>
      <Row
        lead={
          <>
            <Eye
              on={!hidden}
              label={hidden ? `Show ${row.name}` : `Hide ${row.name}`}
              onToggle={() => toggleCountryHidden(row.id)}
            />
            <Emblem flagKey={empireFlagKey(row.country ?? undefined)} color={color} />
            {territory?.tier === "day_one" && (
              <Chip src title={DAY_ONE_TITLE}>
                day 1
              </Chip>
            )}
            {territory?.assumed && (
              <Chip warn title={ASSUMED_TITLE}>
                assumed
              </Chip>
            )}
            {territory && (
              <SourceChip
                source={territory.tier === "day_one" ? "scripts" : "initializers"}
                title={
                  territory.tier === "day_one"
                    ? "These systems are claimed on day one, by the events on_game_start fires."
                    : "These systems are claimed at generation, by the initializers the file names."
                }
              />
            )}
          </>
        }
        name={row.name}
        title={title}
        subline={row.subline}
        count={row.systemCount}
        onName={
          target === null
            ? null
            : () => {
                const node = systems.get(target);
                if (node) panTo(node.x, node.y);
              }
        }
        actions={
          <>
            {country !== null && (
              <Action glyph="✎" label={`Edit ${row.name}'s map colours`} onClick={onEdit} />
            )}
            {row.systemCount > 0 && (
              <Action
                glyph="⊙"
                label={`Select and fit the ${row.systemCount} systems of ${row.name}`}
                onClick={() =>
                  void setSelection(systemsOf(ownership.owners, row.id), "replace").then(() =>
                    fitSelection(),
                  )
                }
              />
            )}
          </>
        }
      />
      {editing && country !== null && <MapColorStrip country={country} />}
    </>
  );
}

/** What a scenario's rows are, and why some of its systems have no owner at all. */
export const TERRITORY_NOTE =
  "Territories are the systems the scripts hand out: at galaxy generation, and on day one by the " +
  "events on_game_start fires. A claim whose conditions this editor cannot judge is marked " +
  "assumed. Owners set through a scope (prev, from, this, root) are not drawn.";

const TERRITORY_NONE =
  "No initializer script in the loaded game data gives any of this scenario's systems an owner.";

const TERRITORY_NEEDS_GAME_DATA =
  "Load game data to read the territories from the initializer scripts the install and its mods define.";

/**
 * Every country in the save but the enclaves, grouped by type. A row goes to its capital, or
 * to the middle of its territory; one that holds no systems goes to the special system its
 * station or fleet stands in. A scenario lists the territories its scripts hand out instead.
 */
export function Empires() {
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const save = useFileSessionStore((s) => s.kind === "save");
  const [editing, setEditing] = useState<number | null>(null);
  const ready = useGameDataStore((s) => s.status === "ready");
  const countries = useGalaxyStore((s) => s.countries);
  const systems = useGalaxyStore((s) => s.systems);
  const countryTypes = useGameDataStore((s) => s.countryTypes);
  const special = useGameDataStore((s) => s.special);
  const scenarioOwners = useGameDataStore((s) => s.scenarioOwners);
  const names = useGameDataStore((s) => s.names);
  const ownership = useOwnership();
  const collapse = useCollapse("empires");
  const groups = useMemo(
    () => empireGroups(countries, countryTypes, rowLookups(systems, names), ownership),
    [countries, countryTypes, systems, names, ownership],
  );
  const stations = useMemo(() => specialSystemOfCountry(special), [special]);
  const territories = useMemo(
    () => new Map(scenarioOwners?.territories.map((t) => [t.country.id, t]) ?? []),
    [scenarioOwners],
  );
  const summary = scenarioOwners ? territorySummary(scenarioOwners) : null;

  if (groups.length === 0) return <div className="muted">{emptyText(scenario, ready)}</div>;
  return (
    <div className="browser">
      {scenario && <div className="browser-note src">{TERRITORY_NOTE}</div>}
      {groups.map((group) => (
        <Group
          key={group.key}
          label={group.label}
          count={group.rows.length}
          open={!collapse.collapsed(group.key, group.key === "other")}
          onToggle={() => collapse.toggle(group.key)}
        >
          {group.rows.map((row) => (
            <EmpireLine
              key={row.id}
              row={row}
              station={stations.get(row.id) ?? null}
              territory={territories.get(row.id)}
              ownership={ownership}
              editable={save}
              editing={editing === row.id}
              onEdit={() => setEditing(editing === row.id ? null : row.id)}
            />
          ))}
        </Group>
      ))}
      {scenario && summary !== null && <div className="browser-note">{summary}</div>}
    </div>
  );
}

/** How many of a scenario's territories were claimed on day one or rest on an assumed condition. */
function territorySummary(owners: ScenarioOwners): string | null {
  const parts: string[] = [];
  if (owners.day_one_systems > 0) {
    parts.push(`${owners.day_one_systems} claimed on day one`);
  }
  if (owners.assumed_systems > 0) parts.push(`${owners.assumed_systems} assumed`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Why the list is empty: a save with no empires, a scenario with no scripted owners, or no game data. */
function emptyText(scenario: boolean, ready: boolean): string {
  if (!scenario) return "No empires in this save.";
  return ready ? TERRITORY_NONE : TERRITORY_NEEDS_GAME_DATA;
}
