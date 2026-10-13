import { useMemo } from "react";
import type { DigSiteChoice } from "../../../generated/DigSiteChoice";
import {
  DIG_SITE_CHIPS,
  digSitePickRows,
  digSiteSections,
  type DigSiteChip,
  type DigSitePickRow,
} from "../../../lib/details/digSitePicker";
import { useDigSitePickerStore } from "../../../store/digSitePickerStore";
import type { PickerItem } from "./PickerMenu";
import type { PickerKind } from "./PlanetPicker";
import { SiteArt } from "./SiteArt";

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
export const DIG_SITE_PICKER: PickerKind<DigSitePickRow, DigSiteChip, DigSiteChoice> = {
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
