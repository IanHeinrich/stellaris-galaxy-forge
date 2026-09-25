import type { BitmapText, FederatedPointerEvent, Graphics, Sprite } from "pixi.js";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import { OwnedTooltip } from "../../ownedTooltip";

export type Item = Sprite | BitmapText | Graphics;

export interface Tip {
  title: string;
  lines: MapTooltipLine[];
}

/** Routes hover on the items carrying a tooltip to the editor's `MapTooltip`. */
export class Hover {
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
