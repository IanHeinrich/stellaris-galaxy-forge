import type { BitmapText, FederatedPointerEvent, Graphics, Sprite } from "pixi.js";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import { OwnedTooltip } from "../../ownedTooltip";

export type Item = Sprite | BitmapText | Graphics;

export interface Tip {
  title: string;
  lines: MapTooltipLine[];
}

/** Where a row's items record the tooltip each shows. */
export interface TipSink {
  bind(item: Item): void;
  set(item: Item, tip: Tip | null): void;
}

/** Routes hover on the items carrying a tooltip to the editor's `MapTooltip`. */
export class Hover implements TipSink {
  private readonly tips = new Map<Item, Tip>();
  private target: Item | null = null;
  private readonly tip = new OwnedTooltip();

  bind(item: Item): void {
    item.on("pointerover", (e: FederatedPointerEvent) => this.enter(item, e));
    item.on("pointerout", () => this.leave(item));
  }

  set(item: Item, tip: Tip | null): void {
    if (tip) {
      this.tips.set(item, tip);
      item.eventMode = "static";
      item.cursor = "help";
    } else {
      this.tips.delete(item);
      item.eventMode = "none";
      this.leave(item);
    }
  }

  private enter(item: Item, e: FederatedPointerEvent): void {
    const tip = this.tips.get(item);
    if (!tip) return;
    this.target = item;
    this.tip.show({ x: e.global.x, y: e.global.y, ...tip });
  }

  private leave(item: Item): void {
    if (this.target !== item) return;
    this.target = null;
    this.tip.hide();
  }
}

/**
 * Keeps each item's tooltip for its owner to look up by point, for a row drawn where the
 * pointer is picked by hand rather than by PixiJS's events.
 */
export class PickedTips implements TipSink {
  private readonly tips = new Map<Item, Tip>();

  bind(): void {}

  set(item: Item, tip: Tip | null): void {
    item.eventMode = "none";
    if (tip) this.tips.set(item, tip);
    else this.tips.delete(item);
  }

  /** The tooltip of the last item set that covers (x, y), in the pixels its parent is laid out in. */
  at(x: number, y: number): Tip | null {
    let found: Tip | null = null;
    for (const [item, tip] of this.tips) {
      if (!item.visible) continue;
      const b = item.getLocalBounds();
      const lx = (x - item.x) / item.scale.x;
      const ly = (y - item.y) / item.scale.y;
      if (lx >= b.minX && lx <= b.maxX && ly >= b.minY && ly <= b.maxY) found = tip;
    }
    return found;
  }
}
