import type { ResourceAmountView } from "../../../generated/ResourceAmountView";
import { resourceAbbrev } from "../../../lib/details/resources";
import { Icon } from "../../parts";

/** A resource's game icon, its abbreviation while the install has none. */
export function ResourceIcon({ amount }: { amount: ResourceAmountView }) {
  return (
    <Icon
      className="gi"
      keys={amount.icon === null ? [] : [amount.icon]}
      glyph={resourceAbbrev(amount.resource)}
    />
  );
}
