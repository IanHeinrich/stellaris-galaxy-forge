import { useEffect, useMemo } from "react";
import type { DigSiteChoice } from "../../../generated/DigSiteChoice";
import type { PlanetPageDigSite } from "../../../generated/PlanetPageDigSite";
import {
  DIG_SITE_CHIPS,
  digSiteLine,
  digSitePickRows,
  digSiteSections,
  type DigSiteChip,
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
import { PickedRow } from "./PickedRow";
import type { PickerItem } from "./PickerMenu";
import { PlanetPicker, type PickerKind } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";

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

/** The dig site picker, with the chips for how a site is found and one row per site type. */
const DIG_SITE_PICKER: PickerKind<DigSitePickRow, DigSiteChip, DigSiteChoice> = {
  store: useDigSitePickerStore,
  words: {
    name: "Add a dig site",
    searchName: "Search dig sites",
    placeholder: "Search name",
    chipsName: "How a dig site is found",
    reading: "Reading the dig sites…",
    noneMatch: "No dig site matches",
    opener: {
      label: "+ Add dig site…",
      title: "Add an archaeological dig site. A planet holds one.",
      needsGameData: "Adding a dig site needs the game data",
    },
  },
  chips: DIG_SITE_CHIPS,
  idPrefix: (target) => `ds-row-${target.key}`,
  useIsOpen: (target) => useDigSitePickerStore((s) => s.target?.key === target.key),
  open: (target) => useDigSitePickerStore.getState().open(target),
  useRows: (choices) =>
    useMemo(() => (choices === null ? null : digSitePickRows(choices.list)), [choices]),
  sections: digSiteSections,
  item: digSiteItem,
  onAdd: (row) => void useDigSitePickerStore.getState().add(row),
};

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
  const description = choice?.description ?? null;
  const name = named(site.kind);
  return (
    <PickedRow
      art={<SiteArt />}
      name={name}
      lines={[
        { className: "l2", text: digSiteLine(site, choice?.stages ?? null) },
        ...(description === null ? [] : [{ className: "l3" as const, text: description }]),
      ]}
      remove={
        onRemove === null
          ? null
          : {
              title: site.excavating
                ? "Remove this dig site. The ship excavating it stops on the game's first day."
                : "Remove this dig site",
              label: `Remove ${name}`,
              run: onRemove,
            }
      }
    />
  );
}

/**
 * The planet's dig site; where the page offers dig sites, with its remove button, or the picker
 * when it has none, both through `target`'s adapter.
 */
export function PlanetDigSite({ page, offers, target }: PlanetSectionProps) {
  const site = page.dig_site;
  const editable = offers.digSite;
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
      {site === null && editable && <PlanetPicker kind={DIG_SITE_PICKER} target={target} />}
    </Section>
  );
}
