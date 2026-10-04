import { useEffect, useMemo } from "react";
import type { PlanetPageDigSite } from "../../../generated/PlanetPageDigSite";
import {
  DIG_SITE_CHIPS,
  digSiteLine,
  digSitePickRows,
  digSiteSections,
  type DigSitePickRow,
} from "../../../lib/details/digSitePicker";
import { ARCHAEOLOGY_ICON_KEYS } from "../../../lib/details/icons";
import { siteLabel } from "../../../lib/details/labels";
import type { PickerTarget } from "../../../lib/details/picker";
import { useDigSitePickerStore } from "../../../store/digSitePickerStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useNamed } from "../../useNamed";
import { Icon } from "../../parts";
import { Section } from "../parts";
import { PickerMenu, PickerOpener, type PickerItem } from "./PickerMenu";

export const DIG_SITE_PICKER_NEEDS_GAME_DATA = "Adding a dig site needs the game data";
export const READING_DIG_SITES = "Reading the dig sites…";
export const NO_DIG_SITE_MATCHES = "No dig site matches";

function SiteArt() {
  return <Icon keys={ARCHAEOLOGY_ICON_KEYS} glyph="⚱" />;
}

/** A site type's row: its name, how many stages and how it is found, and one Add button. */
function digSiteItem(row: DigSitePickRow): PickerItem {
  return {
    key: row.key,
    label: row.label,
    gives: row.gives,
    description: row.choice.description,
    artClass: "pl-mod-icon",
    art: <SiteArt />,
    buttons: [{ text: "Add", label: `Add ${row.label}`, title: `Add ${row.label}` }],
  };
}

/** The open picker: the search, the chips and one row per site type. */
function DigSiteMenu({ target }: { target: PickerTarget }) {
  const query = useDigSitePickerStore((s) => s.query);
  const chip = useDigSitePickerStore((s) => s.chip);
  const choices = useDigSitePickerStore((s) => s.choices);
  useEffect(() => useDigSitePickerStore.getState().open(target), [target]);
  const rows = useMemo(() => (choices === null ? null : digSitePickRows(choices.list)), [choices]);
  return (
    <PickerMenu
      usePicker={useDigSitePickerStore}
      name="Add a dig site"
      searchName="Search dig sites"
      placeholder="Search name"
      chips={DIG_SITE_CHIPS}
      chipsName="How a dig site is found"
      sections={rows === null ? null : digSiteSections(rows, chip, query)}
      reading={READING_DIG_SITES}
      noneMatch={NO_DIG_SITE_MATCHES}
      idPrefix={`ds-row-${target.key}`}
      item={digSiteItem}
      onAdd={(row) => void useDigSitePickerStore.getState().add(row)}
    />
  );
}

/** The picker's button, and the picker below it while open. */
function DigSitePicker({ target }: { target: PickerTarget }) {
  const open = useDigSitePickerStore((s) => s.target?.key === target.key);
  if (open) return <DigSiteMenu target={target} />;
  return (
    <PickerOpener
      label="+ Add dig site…"
      title="Add an archaeological dig site. A planet holds one."
      needsGameData={DIG_SITE_PICKER_NEEDS_GAME_DATA}
      onOpen={() => useDigSitePickerStore.getState().open(target)}
    />
  );
}

/**
 * The site's row: its name, its stage and clues, the game's description of its type, and where
 * editable a button to remove it.
 */
function DigSiteRow({
  site,
  target,
  onRemove,
}: {
  site: PlanetPageDigSite;
  target: PickerTarget;
  onRemove: (() => void) | null;
}) {
  const named = useNamed([site.kind], siteLabel);
  const ready = useGameDataStore((s) => s.status === "ready");
  const choices = useDigSitePickerStore((s) => s.choices);
  useEffect(() => {
    if (ready) useDigSitePickerStore.getState().load(target);
  }, [ready, choices, target]);
  const choice = choices?.list.find((c) => c.key === site.kind);
  const stages = choice?.stages ?? null;
  const description = choice?.description ?? null;
  const name = named(site.kind);
  return (
    <div className="pl-mod">
      <span className="pl-mod-icon">
        <SiteArt />
      </span>
      <span>
        <span className="l1">{name}</span>
        <span className="l2">{digSiteLine(site, stages)}</span>
        {description !== null && <span className="l3">{description}</span>}
      </span>
      {onRemove !== null && (
        <button
          type="button"
          className="pl-dep-remove pl-mod-remove"
          title={
            site.excavating
              ? "Remove this dig site. The ship excavating it stops on the game's first day."
              : "Remove this dig site"
          }
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The planet's dig site; where `editable`, with its remove button, or the picker when it has none,
 * both through `target`'s adapter.
 */
export function PlanetDigSite({
  site,
  editable,
  target,
}: {
  site: PlanetPageDigSite | null;
  editable: boolean;
  target: PickerTarget;
}) {
  if (site === null && !editable) return null;
  return (
    <Section id="planet.digSite" title="Dig site">
      {site !== null && (
        <DigSiteRow
          site={site}
          target={target}
          onRemove={editable ? () => void target.edits.removeDigSite(site.id) : null}
        />
      )}
      {site === null && editable && <DigSitePicker target={target} />}
    </Section>
  );
}
