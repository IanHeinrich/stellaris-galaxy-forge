import { ADDED_THIS_SESSION } from "../../lib/addSystem";
import { useGalaxyStore } from "../../store/galaxyStore";
import { OwnedTooltip } from "../ownedTooltip";

/** The tooltip on a save system added this session while the pointer rests on its star. */
export class AddedTooltip {
  private readonly tip = new OwnedTooltip();

  /** Follows the pointer: `system` is the star under it, at (sx, sy) in map-area pixels. */
  update(system: number | null, sx: number, sy: number): void {
    const galaxy = useGalaxyStore.getState();
    const node = system === null ? undefined : galaxy.systems.get(system);
    if (!node?.added) {
      this.drop();
      return;
    }
    this.tip.show({
      x: sx,
      y: sy,
      title: `${galaxy.systemName(node.id)} #${node.id}`,
      lines: [ADDED_THIS_SESSION],
    });
  }

  /** Takes the tooltip down, if it is still the one showing. */
  drop(): void {
    this.tip.hide();
  }
}
