import { BitmapText, TextStyle } from "pixi.js";
import { MAP_FONT } from "../../lib/visual/style";

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
export const NAME_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 14,
  fontWeight: "600",
  fill: 0xd6dde8,
  stroke: { color: 0x000000, width: 3 },
});

let ruler: BitmapText | null = null;

/** Half the rendered width of a system name, as the labels layer draws it. */
export function nameHalf(name: string): number {
  ruler ??= new BitmapText({ text: "", style: NAME_STYLE });
  ruler.text = name;
  return ruler.width / 2;
}
