import type { ReactNode } from "react";
import type { SpecialKind } from "../../generated/SpecialKind";
import type { LayerId } from "../../lib/visual/layerIds";

const STAR = "M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="layer-icon"
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

function FilledGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="layer-icon"
      viewBox="0 0 32 32"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      stroke="none"
    >
      {children}
    </svg>
  );
}

function glyphOf(id: LayerId): ReactNode {
  switch (id) {
    case "lanes":
      return (
        <Glyph>
          <path d="M3.2 11.2 8 5.2 12.8 9.2" />
          <circle cx="3.2" cy="11.2" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="8" cy="5.2" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12.8" cy="9.2" r="1.7" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "systems":
      return (
        <Glyph>
          <path d={STAR} fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "details":
      return (
        <Glyph>
          <path d="M3 4.8h10M3 8h6.5M3 11.2h8.5" />
        </Glyph>
      );
    case "colonies":
      return (
        <Glyph>
          <path d="M4.6 13.6V2.4" />
          <path d="M4.6 3.2h7.2l-1.9 2.5 1.9 2.5H4.6Z" />
        </Glyph>
      );
    case "owners":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="5.4" strokeWidth="2.2" />
          <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "claims":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="5.4" strokeDasharray="2.4 2" />
          <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "classes":
      return (
        <Glyph>
          <circle cx="3.3" cy="8" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
          <circle cx="13" cy="8" r="2.9" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "bypasses":
    case "day_one_bypasses":
      return (
        <Glyph>
          <path d="M3.2 12 12.8 4" strokeDasharray="2.2 1.8" />
          <circle cx="3.2" cy="12" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12.8" cy="4" r="1.7" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "waylines":
      return (
        <Glyph>
          <path d="M4.6 8h6.8" strokeDasharray="2.4 1.6" strokeWidth="2.6" />
          <rect x="1.4" y="6.4" width="3.2" height="3.2" />
          <rect x="11.4" y="6.4" width="3.2" height="3.2" />
        </Glyph>
      );
    case "special":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="6.2" />
          <path
            d={STAR}
            fill="currentColor"
            stroke="none"
            transform="translate(8 8) scale(0.62) translate(-8 -8)"
          />
        </Glyph>
      );
    case "initializers":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="2.3" fill="currentColor" stroke="none" />
          <path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2" />
          <path d="M3.9 3.9 5.4 5.4M10.6 10.6 12.1 12.1M12.1 3.9 10.6 5.4M5.4 10.6 3.9 12.1" />
        </Glyph>
      );
    case "spawns":
      return (
        <Glyph>
          <path d="M9.9 1.6V2.9" />
          <rect x="7.45" y="2.9" width="4.9" height="4.4" rx="1" />
          <circle cx="8.9" cy="5.1" r="0.62" fill="currentColor" stroke="none" />
          <circle cx="10.9" cy="5.1" r="0.62" fill="currentColor" stroke="none" />
          <path d="M7 11.9v-1a2.9 2.9 0 0 1 5.8 0v1" />
          <circle cx="5.6" cy="7.4" r="2.3" fill="currentColor" stroke="none" />
          <path d="M2.2 14.6v-1.7a3.4 3.4 0 0 1 6.8 0v1.7Z" fill="currentColor" stroke="none" />
        </Glyph>
      );
    case "feZones":
      return (
        <Glyph>
          <circle cx="10" cy="6" r="4.2" strokeDasharray="2 1.6" />
          <circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none" />
          <path d="M3.9 12.1 7 8.9" />
        </Glyph>
      );
    case "marauders":
      return (
        <Glyph>
          <path d="M3 3l8.6 8.6M13 3 4.4 11.6" />
          <path d="M2.6 13.4 4.4 11.6M13.4 13.4 11.6 11.6" />
          <path d="M2.2 10.4l1.4 1.4M13.8 10.4l-1.4 1.4" />
        </Glyph>
      );
    case "mapBorder":
      return (
        <Glyph>
          <rect x="2.6" y="2.6" width="10.8" height="10.8" strokeDasharray="2.2 1.6" />
        </Glyph>
      );
    case "lCluster":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="5.4" strokeDasharray="2.2 1.6" />
          <path d="M6.4 5.4v5.2h3.2" />
        </Glyph>
      );
    case "nebulae":
      return (
        <Glyph>
          <path d="M4.4 11.2a2.6 2.6 0 0 1 .5-5.1 3.3 3.3 0 0 1 6.3.6 2.3 2.3 0 0 1-.3 4.5Z" />
        </Glyph>
      );
    case "issues":
      return (
        <Glyph>
          <path d="M8 2.6 14.2 13H1.8Z" />
          <path d="M8 6.6v3.2M8 11.6v.1" />
        </Glyph>
      );
    case "highlights":
      return (
        <Glyph>
          <path d="M8 2.4 13.6 8 8 13.6 2.4 8Z" />
        </Glyph>
      );
    case "labels":
      return null;
  }
}

/** A layer's 16 px mark, drawn in `currentColor` so the toggle's state tints it. */
export function LayerIcon({ id }: { id: LayerId }) {
  if (id === "labels") return <span className="layer-text">Aa</span>;
  return <>{glyphOf(id)}</>;
}

function kindGlyph(kind: SpecialKind): ReactNode {
  switch (kind) {
    case "leviathan":
      return (
        <FilledGlyph>
          <path d="M16 2L18 5 16.5 8C21 3 27 2 30 7C27 11 24 9 22 12C20 15 18.5 13.5 17 16L16.5 18 16 18 19 21 21 24.5 18 26.5 15.5 24 15.5 18 15 16C13.5 13.5 12 15 10 12C8 9 5 11 2 7C5 2 11 3 15.5 8L14 5Z" />
        </FilledGlyph>
      );
    case "enclave":
      return (
        <FilledGlyph>
          <path
            d="M16 7.5A8.5 8.5 0 1 0 16 24.5A8.5 8.5 0 1 0 16 7.5ZM16 10A6 6 0 1 1 16 22A6 6 0 1 1 16 10Z"
            fillRule="evenodd"
          />
          <circle cx="16" cy="16" r="3" />
          <path d="M14.5 13 17.5 13 16 4Z" />
          <rect x="24.5" y="13.5" width="2" height="5" />
          <rect x="26.9" y="13.5" width="2" height="5" />
          <rect x="29.3" y="13.5" width="2" height="5" />
          <rect x="5.5" y="13.5" width="2" height="5" />
          <rect x="3.1" y="13.5" width="2" height="5" />
          <rect x="0.7" y="13.5" width="2" height="5" />
        </FilledGlyph>
      );
    default:
      return (
        <Glyph>
          <path d={STAR} fill="currentColor" stroke="none" />
        </Glyph>
      );
  }
}

/** A point-of-interest kind's 16 px mark, drawn in `currentColor`. */
export function KindIcon({ kind }: { kind: SpecialKind }) {
  return <>{kindGlyph(kind)}</>;
}
