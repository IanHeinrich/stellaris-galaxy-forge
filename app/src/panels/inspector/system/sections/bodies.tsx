import { PLANET_SIZE_ICON_KEY } from "../../../../lib/details/icons";
import {
  type ResourceRow,
  formatAmount,
  resourceAbbrev,
  resourceLabel,
} from "../../../../lib/details/resources";
import { useTextureUrl } from "../../../useTextureUrl";
import { Icon } from "../../../parts";

export function Pill({ row }: { row: ResourceRow }) {
  const url = useTextureUrl([row.sprite]);
  return (
    <span className="res" title={`${resourceLabel(row.resource)} ${formatAmount(row.amount)}`}>
      {url ? <img src={url} alt="" /> : <i>{resourceAbbrev(row.resource)}</i>}
      {formatAmount(row.amount)}
    </span>
  );
}

export function Pills({ rows }: { rows: readonly ResourceRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <Pill key={row.resource} row={row} />
      ))}
    </>
  );
}

/** The game's planet-size glyph with the size beside it. */
export function PlanetSize({ size }: { size: string | number }) {
  return (
    <span className="sz">
      <Icon className="gi" keys={[PLANET_SIZE_ICON_KEY]} glyph="◍" />
      {size}
    </span>
  );
}
