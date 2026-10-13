import type { PlanetPageDigSite } from "../../../generated/PlanetPageDigSite";
import { digSiteLine } from "../../../lib/details/digSitePicker";
import { siteLabel } from "../../../lib/details/labels";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { useNamed } from "../../useNamed";
import { Section } from "../parts";
import { DIG_SITE_PICKER } from "./DigSitePicker";
import { PickedRow } from "./PickedRow";
import { PlanetPicker } from "./PlanetPicker";
import type { PlanetSectionProps } from "./planetSection";
import { SiteArt } from "./SiteArt";

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
