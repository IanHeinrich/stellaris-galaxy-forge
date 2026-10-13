import { useId, useState } from "react";

/**
 * A hover card's wiring: the id of what it describes, the card's id, whether it shows, and the
 * pointer and focus handlers that show and hide it. `describedBy` names the card while it shows.
 */
export function useHoverCard() {
  const id = useId();
  const cardId = `${id}-card`;
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  return {
    id,
    cardId,
    shown,
    describedBy: shown ? cardId : undefined,
    hover: { onMouseEnter: show, onMouseLeave: hide },
    focus: { onFocus: show, onBlur: hide },
  };
}
