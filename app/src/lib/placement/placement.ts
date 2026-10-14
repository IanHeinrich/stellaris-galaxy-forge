import type { Pair } from "../geometry/pairs";
import type { Pt } from "../geometry/pt";

/**
 * New systems and the lanes they add. The points take provisional ids -1..-n in order, and a
 * lane may join them to existing systems by their real ids.
 */
export interface Placement {
  points: readonly Pt[];
  pairs: readonly Pair[];
}
