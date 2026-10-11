import { useMemo } from "react";
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
import { useDigSitePickerStore } from "../../../store/digSitePickerStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
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
    effects: row.effects,
    description: row.choice.description,
    artClass: "pl-mod-icon",
    art: <SiteArt />,
    buttons: [{ text: "Add", label: `Add ${row.label}`, title: `Add ${row.label}` }],
  };
}

/** The archaeological site picker, with the chips for how a site is found and one row per site type. */
const DIG_SITE_PICKER: PickerKind<DigSitePickRow, DigSiteChip, DigSiteChoice> = {
  store: useDigSitePickerStore,
  words: {
    name: "Add an archaeological site",
    searchName: "Search archaeological sites",
    placeholder: "Search name",
    chipsName: "How an archaeological site is found",
    reading: "Reading the archaeological sites…",
    noneMatch: "No archaeological site matches",
    opener: {
      label: "+ Add archaeological site…",
      title: "Add an archaeological site. A planet holds one.",
      needsGameData: "Adding an archaeological site needs the game data",
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
  onRemove,
}: {
  site: PlanetPageDigSite;
  onRemove: (() => void) | null;
}) {
  const named = useNamed([site.kind], siteLabel);
  const type = usePlanetDataStore((s) => s.digSites.get(site.kind));
  const description = type?.description ?? null;
  const name = named(site.kind);
  return (
    <PickedRow
      art={<SiteArt />}
      name={name}
      lines={[
        { className: "l2", text: digSiteLine(site, type?.stages ?? null) },
        ...(description === null ? [] : [{ className: "l3" as const, text: description }]),
      ]}
      remove={
        onRemove === null
          ? null
          : {
              title: site.excavating
                ? "Remove this archaeological site. The ship excavating it stops on the game's first day."
                : "Remove this archaeological site",
              label: `Remove ${name}`,
              run: onRemove,
            }
      }
    />
  );
}

/**
 * The planet's archaeological site; where the page offers them, with its remove button, or the picker
 * when it has none, both through the target's adapter.
 */
export function PlanetDigSite({ read, offers }: PlanetSectionProps) {
  const held = read.rows.digSite;
  const { target } = read;
  const editable = offers.digSite;
  if (held === null && !editable) return null;
  return (
    <Section id="planet.digSite" title="Archaeological site">
      {held !== null && (
        <DigSiteRow
          site={held.site}
          onRemove={editable ? () => void target.edits.removeDigSite(held.ref) : null}
        />
      )}
      {held === null && editable && <PlanetPicker kind={DIG_SITE_PICKER} target={target} />}
    </Section>
  );
}
