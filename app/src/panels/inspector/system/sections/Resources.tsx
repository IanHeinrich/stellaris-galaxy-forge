import type { SystemDetails } from "../../../../generated/SystemDetails";
import { resourceRows } from "../../../../lib/details/resources";
import { useDetailsStore } from "../../../../store/detailsStore";
import { Section } from "../../parts";
import { Pills } from "./bodies";

/** What the whole system holds, on the total row the planet list ends with; nothing when it holds none. */
export function ResourceSection({ details }: { details: SystemDetails }) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const rows = resourceRows(details, icons);
  if (rows.length === 0) return null;
  return (
    <Section id="system.resources" title="Resources" count={rows.length}>
      <div className="ins-prow total wide">
        <span className="pi ghost" />
        <span>
          <span className="l1">System total</span>
          <span className="l3">
            <Pills rows={rows} />
          </span>
        </span>
      </div>
    </Section>
  );
}
