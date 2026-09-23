import type { StarClassView } from "../../generated/StarClassView";
import { useTextureUrl } from "../useTextureUrl";

/** A star icon's side in pixels at `icon_scale` 1, and the most any scale may make it. */
const ROW_ICON = { base: 22, max: 32 };
const TRIGGER_ICON = { base: 12, max: 18 };

/** The icon the map draws for `view`, sized by its `icon_scale`. */
function StarIcon({ view, size }: { view: StarClassView; size: { base: number; max: number } }) {
  const url = useTextureUrl([view.texture_key]);
  if (url === undefined) return null;
  const px = Math.min(size.max, Math.round(size.base * view.icon_scale));
  return <img className="star-class-icon" src={url} width={px} height={px} alt="" />;
}

/** The icon a star class picker's row shows for `view`. */
export function StarRowIcon({ view }: { view: StarClassView }) {
  return <StarIcon view={view} size={ROW_ICON} />;
}

/** The icon a star class picker's button shows for `view`. */
export function StarTriggerIcon({ view }: { view: StarClassView }) {
  return <StarIcon view={view} size={TRIGGER_ICON} />;
}
