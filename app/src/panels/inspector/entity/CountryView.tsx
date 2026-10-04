import { useMemo, useState } from "react";
import type { CountryNode } from "../../../generated/CountryNode";
import type { EmpireFlag } from "../../../generated/EmpireFlag";
import type { EntityView as EntityViewData } from "../../../generated/EntityView";
import type { FlagRef } from "../../../generated/FlagRef";
import type { MapColorPair } from "../../../generated/MapColorPair";
import { empireFlagKey } from "../../../lib/details/fleets";
import {
  backgroundItem,
  emblemGroups,
  emblemItem,
  empireFlag,
  flagMods,
  paletteLines,
  paletteSwatch,
  sameFlag,
} from "../../../lib/flags";
import { readableKey, stripped, templateName } from "../../../lib/names";
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
  TextField,
  ToggleField,
  type Swatch,
} from "../../EditField";
import { TilePicker, type TileGroup, type TileItem } from "../../TilePicker";
import { useApplyOp } from "../../useApplyOp";
import { useNamed } from "../../useNamed";
import { useOwnerCss } from "../ownerCss";
import { Icon } from "../../parts";
import { LinkRow, LockedRow, Properties, PropertyRow } from "../parts";
import { EntityView } from "./EntityView";
import "./entity.css";
import { useEntityView } from "./useEntity";

export const MAP_COLORS_NEED_4_5 = "Map colours need a Stellaris 4.5 save";
export const INDEPENDENT_MAP_COLOUR = "Independent map colour";
export const FLAG_NEEDS_GAME_DATA = "Load game data to change the flag";
export const FLAG_UNREADABLE = "The save has no complete flag for this empire";

/** The root level of the country, whose government the About block reads. */
const ROOT: readonly string[] = [];

/** What a disabled picker shows in place of a choice. */
const NO_TILE: TileItem = { key: "", label: "none", textures: [] };
const NO_COLOR: Swatch = { key: "", label: "none" };

/** Which of the flag's tile panels is open; one at a time. */
type FlagPanel = "emblem" | "background" | null;

/** The flag the fields edit with the background it sits on, or the reason they cannot edit one. */
function editableFlag(
  country: CountryNode,
  hasParts: boolean,
): { flag: EmpireFlag; background: FlagRef } | { reason: string } {
  const flag = empireFlag(country);
  const background = country.flag_background;
  if (flag === null || !background) return { reason: FLAG_UNREADABLE };
  if (!hasParts) return { reason: FLAG_NEEDS_GAME_DATA };
  return { flag, background };
}

/** A save empire's flag: its emblem, its background and its two colours. */
function FlagFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const [panel, setPanel] = useState<FlagPanel>(null);
  const parts = useGameDataStore((s) => s.flagParts);
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  const editable = editableFlag(country, parts.emblems.length + parts.backgrounds.length > 0);
  const ready = "flag" in editable ? editable : null;
  const reason = "reason" in editable ? editable.reason : undefined;
  const set = (change: Partial<EmpireFlag>) => {
    if (ready === null) return;
    const next = { ...ready.flag, ...change };
    if (!sameFlag(next, ready.flag)) {
      applyOp({ type: "SetEmpireFlag", country: country.id, flag: next });
    }
  };
  const openPanel = (which: FlagPanel) => (open: boolean) => setPanel(open ? which : null);
  const backgrounds: TileGroup[] =
    ready === null
      ? []
      : [
          {
            key: "backgrounds",
            label: "Backgrounds",
            items: parts.backgrounds.map((f) =>
              backgroundItem(f.file, ready.background, country.colors),
            ),
          },
        ];
  const swatches = [...palette.keys()].map((name) => paletteSwatch(name, palette, "flag"));
  return (
    <EditBlock title="Flag">
      <TilePicker
        label="Emblem"
        title="The emblem in the middle of the flag"
        disabledReason={reason}
        current={
          ready === null ? NO_TILE : emblemItem(ready.flag.icon_category, ready.flag.icon_file)
        }
        groups={ready === null ? [] : emblemGroups(parts)}
        open={panel === "emblem"}
        onOpenChange={openPanel("emblem")}
        onPick={(key) => {
          const [icon_category, icon_file] = key.split("/");
          set({ icon_category, icon_file });
        }}
      />
      <TilePicker
        label="Background"
        title="The pattern behind the emblem"
        disabledReason={reason}
        current={
          ready === null
            ? NO_TILE
            : backgroundItem(ready.flag.background, ready.background, country.colors)
        }
        groups={backgrounds}
        open={panel === "background"}
        onOpenChange={openPanel("background")}
        onPick={(file) => set({ background: file })}
      />
      <EditRow label="Primary">
        <SwatchField
          label="Primary"
          title="The flag's main colour"
          disabledReason={reason}
          current={ready === null ? NO_COLOR : paletteSwatch(ready.flag.primary, palette, "flag")}
          swatches={swatches}
          onOpen={() => setPanel(null)}
          onPick={(primary) => set({ primary })}
        />
      </EditRow>
      <EditRow label="Secondary">
        <SwatchField
          label="Secondary"
          title="The flag's second colour"
          disabledReason={reason}
          current={ready === null ? NO_COLOR : paletteSwatch(ready.flag.secondary, palette, "flag")}
          swatches={swatches}
          onOpen={() => setPanel(null)}
          onPick={(secondary) => set({ secondary })}
        />
      </EditRow>
      {ready === null ? (
        <EditNote>{reason}</EditNote>
      ) : (
        <>
          {flagMods(ready.flag, parts).map((mod) => (
            <EditNote key={mod}>{`The save needs ${mod} to show this flag.`}</EditNote>
          ))}
          {paletteLines(palette, source).map((line) => (
            <EditNote key={line}>{line}</EditNote>
          ))}
        </>
      )}
    </EditBlock>
  );
}

/** A save empire's map border and fill, or its flag colours in their place. */
function MapColorFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const palette = useGameDataStore((s) => s.mapColors);
  const source = useGameDataStore((s) => s.mapColorSource);
  const reason = country.has_map_colors ? undefined : MAP_COLORS_NEED_4_5;
  const on = country.use_map_color;
  const border = country.painted_border ?? "";
  const fill = country.painted_fill ?? "";
  const set = (colors: MapColorPair | null) =>
    applyOp({ type: "SetEmpireMapColors", country: country.id, colors });
  const pick = (pair: MapColorPair) => {
    if (pair.border !== border || pair.fill !== fill) set(pair);
  };
  const swatch = (name: string) =>
    reason === undefined ? paletteSwatch(name, palette, "map") : NO_COLOR;
  const swatches = [...palette.keys()].map((name) => paletteSwatch(name, palette, "map"));
  return (
    <EditBlock title="Map colours">
      {reason === undefined && (
        <ToggleField
          label={INDEPENDENT_MAP_COLOUR}
          title="On: the border and fill use the colours below. Off: they come from the flag's primary and secondary colours."
          checked={on}
          onChange={(independent) => set(independent ? { border, fill } : null)}
        />
      )}
      {on || reason !== undefined ? (
        <>
          <EditRow label="Border">
            <SwatchField
              label="Border"
              title="The colour of the empire's border on the map"
              disabledReason={reason}
              current={swatch(border)}
              swatches={swatches}
              onPick={(name) => pick({ border: name, fill })}
            />
          </EditRow>
          <EditRow label="Fill">
            <SwatchField
              label="Fill"
              title="The colour the empire's territory is filled with on the map"
              disabledReason={reason}
              current={swatch(fill)}
              swatches={swatches}
              onPick={(name) => pick({ border, fill: name })}
            />
          </EditRow>
        </>
      ) : (
        <>
          <EditRow label="Border">
            <FlagColourText swatch={swatch(border)} source="flag primary" />
          </EditRow>
          <EditRow label="Fill">
            <FlagColourText swatch={swatch(fill)} source="flag secondary" />
          </EditRow>
          <EditNote>The map uses the flag&apos;s primary and secondary colours.</EditNote>
        </>
      )}
      {reason === undefined ? (
        paletteLines(palette, source).map((line) => <EditNote key={line}>{line}</EditNote>)
      ) : (
        <EditNote>{reason}</EditNote>
      )}
    </EditBlock>
  );
}

/** A map colour the flag decides, as plain text: its swatch, its name and where it comes from. */
function FlagColourText({ swatch, source }: { swatch: Swatch; source: string }) {
  return (
    <span className="edit-derived">
      {swatch.color !== undefined && (
        <span className="swatch" style={{ background: swatch.color }} />
      )}
      {swatch.label}
      <span className="muted"> · {source}</span>
    </span>
  );
}

/** A save empire's name, as the game shows it: what the player types is written as it stands. */
function NameFields({ country }: { country: CountryNode }) {
  const applyOp = useApplyOp();
  const shown = templateName(country);
  const rename = (typed: string) => {
    const name = typed.trim();
    if (name !== "" && name !== shown) applyOp({ type: "RenameEmpire", country: country.id, name });
  };
  return (
    <EditBlock title="Empire">
      <EditRow label="Name">
        <TextField
          kind="text"
          label="Empire name"
          title="The empire's name. Renaming the player's empire also renames the save on the load screen."
          value={shown}
          onCommit={rename}
        />
      </EditRow>
    </EditBlock>
  );
}

/** A pre-FTL civilisation's age, as the game names it. */
function Age({ age }: { age: string }) {
  const named = useNamed([age], readableKey);
  return <PropertyRow label="Age">{named(age)}</PropertyRow>;
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
        {country.preftl_age !== undefined && <Age age={country.preftl_age} />}
        <Government id={country.id} />
      </Properties>
    </>
  );
}

/** A save empire's own page: its name, flag and map colours to edit first, then what it is. */
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
      <NameFields country={country} />
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
