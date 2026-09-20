/**
 * The glyph every collapsible row faces: down when it is open, right when it is closed. A row
 * whose `<details>` element turns it in CSS asks for the room without the glyph.
 */
export function Twisty({ open }: { open?: boolean }) {
  return <span className="tri">{open === undefined ? null : open ? "▾" : "▸"}</span>;
}
