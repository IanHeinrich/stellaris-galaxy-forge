import { useMemo } from "react";
import type { ScenarioOwners } from "../../generated/ScenarioOwners";
import type { Territory } from "../../generated/Territory";
import { empireGroups, specialSystemOfCountry } from "../../lib/browserRows";
import { empireFlagKey } from "../../lib/details/fleets";
import { systemsOf, type Ownership } from "../../lib/ownership";
import { ownerColor, toCss } from "../../lib/visual/ownerColors";
import { rowLookups, type EmpireRow } from "../../store/browserRows";
import { useEditorStore } from "../../store/editorStore";
import { useCanEdit, useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useOwnership } from "../../store/ownership";
import { Chip, SourceChip } from "../parts";
import { useCollapse } from "./collapse";
import { Action, Emblem, Eye, Group, Row } from "./rows";

/** Why a territory's day-one badge means what it means, shown on hover. */
const DAY_ONE_TITLE =
  "Claimed on day one, by an event on_game_start fires, not at galaxy generation.";

/** Why a territory's assumed marker means what it means, shown on hover. */
const ASSUMED_TITLE = "A claim whose conditions this editor cannot judge is marked assumed.";

function EmpireLine({
  row,
  station,
  territory,
  ownership,
  editable,
}: {
  row: EmpireRow;
  station: number | null;
  territory: Territory | undefined;
  ownership: Ownership;
  /** Whether the row opens the empire's page to edit it: a save's empire. */
  editable: boolean;
}) {
  const hidden = useGalaxyStore((s) => s.hiddenCountries.has(row.id));
  const toggleCountryHidden = useGalaxyStore((s) => s.toggleCountryHidden);
  const systems = useGalaxyStore((s) => s.systems);
  const systemName = useGalaxyStore((s) => s.systemName);
  const mapColors = useGameDataStore((s) => s.mapColors);
  const setSelection = useEditorStore((s) => s.setSelection);
  const fitSelection = useEditorStore((s) => s.fitSelection);
  const panTo = useEditorStore((s) => s.panTo);
  const openPage = useInspectorStore((s) => s.openPage);
  const color = toCss(
    ownership.table.get(row.id)?.colors.outline ??
      ownerColor(row.country ?? undefined, row.index, mapColors),
  );
  const target = row.capital ?? station;
  const openEmpirePage = (id: number) => {
    const node = target === null ? undefined : systems.get(target);
    if (node) panTo(node.x, node.y);
    openPage({ ref: { kind: "country", id }, label: row.name });
  };
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
      title={country === null ? title : `Open ${row.name}'s page`}
      subline={row.subline}
      count={row.systemCount}
      onName={
        country !== null
          ? () => openEmpirePage(country.id)
          : target === null
            ? null
            : () => {
                const node = systems.get(target);
                if (node) panTo(node.x, node.y);
              }
      }
      actions={
        <>
          {country !== null && (
            <Action
              glyph="✎"
              label={`Open ${row.name}'s page`}
              onClick={() => openEmpirePage(country.id)}
              persistent
            />
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
  const mapColors = useCanEdit("map_colors");
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
              editable={mapColors}
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
