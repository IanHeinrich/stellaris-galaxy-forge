import type { ReactNode } from "react";
import type { SearchKind } from "../../generated/SearchKind";

/** What a row shows: a kind of hit. */
export type RowKind = SearchKind;

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="palette-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function glyphOf(kind: RowKind): ReactNode {
  switch (kind) {
    case "system":
      return (
        <Glyph>
          <path
            d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z"
            fill="currentColor"
            stroke="none"
          />
        </Glyph>
      );
    case "country":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="5.4" strokeWidth="2.2" />
          <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "planet":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="4.2" fill="currentColor" stroke="none" />
          <path d="M2.4 10.4C4.6 12 11.4 12 13.6 10.4" />
        </Glyph>
      );
    case "fleet":
      return (
        <Glyph>
          <path d="M8 2.6 12.6 13.4 8 10.6 3.4 13.4Z" />
        </Glyph>
      );
    case "nebula":
      return (
        <Glyph>
          <path d="M4.4 11.2a2.6 2.6 0 0 1 .5-5.1 3.3 3.3 0 0 1 6.3.6 2.3 2.3 0 0 1-.3 4.5Z" />
        </Glyph>
      );
  }
}

/** A row's 16 px mark, drawn in `currentColor`. */
export function RowIcon({ kind }: { kind: RowKind }) {
  return <>{glyphOf(kind)}</>;
}
