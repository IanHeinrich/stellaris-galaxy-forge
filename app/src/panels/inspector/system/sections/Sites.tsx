import type { ArchaeologySite } from "../../../../generated/ArchaeologySite";
import { siteLabel } from "../../../../lib/details/labels";
import { Empty, Section } from "../../parts";

/** The digs standing in the system, by the type the site itself names. */
export function SiteSection({ sites }: { sites: ArchaeologySite[] }) {
  return (
    <Section id="system.sites" title="Archaeology sites" count={sites.length}>
      {sites.length === 0 ? (
        <Empty>No archaeology sites in this system.</Empty>
      ) : (
        sites.map((site) => (
          <div key={site.id} className="ins-line">
            <span>{siteLabel(site.kind)}</span>
            <span className="muted mono">#{site.id}</span>
          </div>
        ))
      )}
    </Section>
  );
}
