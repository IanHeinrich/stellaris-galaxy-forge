import type { ArchaeologySite } from "../../../../generated/ArchaeologySite";
import { siteLabel } from "../../../../lib/details/labels";
import { Empty, Section } from "../../parts";

/**
 * The digs standing in the system, by the type the site itself names; `systemKinds` those an
 * initializer places on the system and no body.
 */
export function SiteSection({
  sites,
  systemKinds = [],
}: {
  sites: ArchaeologySite[];
  systemKinds?: readonly string[];
}) {
  const count = sites.length + systemKinds.length;
  return (
    <Section id="system.sites" title="Archaeology sites" count={count}>
      {count === 0 ? (
        <Empty>No archaeology sites in this system.</Empty>
      ) : (
        <>
          {sites.map((site) => (
            <div key={site.id} className="ins-line">
              <span>{siteLabel(site.kind)}</span>
              <span className="muted mono">#{site.id}</span>
            </div>
          ))}
          {systemKinds.map((kind, i) => (
            <div key={`${kind}-${i}`} className="ins-line">
              <span>{siteLabel(kind)}</span>
              <span className="muted">on the system</span>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}
