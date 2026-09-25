import type { ReactNode } from "react";
import type { SearchKind } from "../../generated/SearchKind";
import { Glyph, NebulaMark, OwnerMark, StarMark } from "../Glyph";

/** What a row shows: a kind of hit. */
export type RowKind = SearchKind;

function PaletteGlyph({ children }: { children: ReactNode }) {
  return <Glyph className="palette-icon">{children}</Glyph>;
}

function glyphOf(kind: RowKind): ReactNode {
  switch (kind) {
    case "system":
      return (
        <PaletteGlyph>
          <StarMark />
        </PaletteGlyph>
      );
    case "country":
      return (
        <PaletteGlyph>
          <OwnerMark />
        </PaletteGlyph>
      );
    case "planet":
      return (
        <PaletteGlyph>
          <circle cx="8" cy="8" r="4.2" fill="currentColor" stroke="none" />
          <path d="M2.4 10.4C4.6 12 11.4 12 13.6 10.4" />
        </PaletteGlyph>
      );
    case "fleet":
      return (
        <PaletteGlyph>
          <path d="M8 2.6 12.6 13.4 8 10.6 3.4 13.4Z" />
        </PaletteGlyph>
      );
    case "nebula":
      return (
        <PaletteGlyph>
          <NebulaMark />
        </PaletteGlyph>
      );
  }
}

/** A row's 16 px mark, drawn in `currentColor`. */
export function RowIcon({ kind }: { kind: RowKind }) {
  return <>{glyphOf(kind)}</>;
}

/** The pin on the field's Pin button, 12 px in `currentColor`. */
export function PinGlyph() {
  return (
    <svg
      className="pin-glyph"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 2.5h5M6.5 2.5v4L4 9.5h8L9.5 6.5v-4M8 9.5v4.5" />
    </svg>
  );
}
