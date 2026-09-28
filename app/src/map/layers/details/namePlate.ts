import { NineSliceSprite, Texture } from "pixi.js";
import { PLATE_BORDER_PX } from "../../../lib/details/icons";
import type { Box } from "../../../lib/details/layout";

/** The game's plate behind a colonised system's name, stretched between its faded ends. */
export function namePlate(): NineSliceSprite {
  return new NineSliceSprite({
    texture: Texture.EMPTY,
    leftWidth: PLATE_BORDER_PX,
    rightWidth: PLATE_BORDER_PX,
    topHeight: 1,
    bottomHeight: 1,
  });
}

/** Shows `texture` on `plate` over `box`, in units of the plate's own position. */
export function fitPlate(plate: NineSliceSprite, texture: Texture, box: Box): void {
  if (plate.texture !== texture) plate.texture = texture;
  plate.width = box.width;
  plate.height = box.height;
  plate.pivot.set(-box.x, -box.y);
}
