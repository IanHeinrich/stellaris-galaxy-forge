import type { ReactNode } from "react";

/** A 16-unit stroked icon, drawn in the text colour at `size` pixels. */
export function Glyph({
  className,
  size = 16,
  children,
}: {
  className: string;
  size?: number;
  children: ReactNode;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
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

/** A four-pointed star: a system; `scale` shrinks it about the centre. */
export function StarMark({ scale }: { scale?: number }) {
  return (
    <path
      d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5Z"
      fill="currentColor"
      stroke="none"
      transform={
        scale === undefined ? undefined : `translate(8 8) scale(${scale}) translate(-8 -8)`
      }
    />
  );
}

/** A heavy ring round a dot: an empire. */
export function OwnerMark() {
  return (
    <>
      <circle cx="8" cy="8" r="5.4" strokeWidth="2.2" />
      <circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" />
    </>
  );
}

/** A cloud: a nebula. */
export function NebulaMark() {
  return <path d="M4.4 11.2a2.6 2.6 0 0 1 .5-5.1 3.3 3.3 0 0 1 6.3.6 2.3 2.3 0 0 1-.3 4.5Z" />;
}

/** A padlock in the text colour; with a `title` it is an image that says it, else decoration. */
export function LockGlyph({
  className,
  title,
  width = 8,
  height = 10,
}: {
  className?: string;
  title?: string;
  width?: number;
  height?: number;
}) {
  const described =
    title === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": title };
  return (
    <svg className={className} viewBox="0 0 10 12" width={width} height={height} {...described}>
      {title !== undefined && <title>{title}</title>}
      <path d="M2.5 5V3.5a2.5 2.5 0 0 1 5 0V5" fill="none" stroke="currentColor" />
      <rect x="1" y="5" width="8" height="6.5" rx="1" fill="currentColor" />
    </svg>
  );
}
