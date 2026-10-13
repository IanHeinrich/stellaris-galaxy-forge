import { Icon } from "../../parts";

/** A modifier's icon in its frame, a diamond where the install has no icon. */
export function ModifierArt({
  icon,
  frame,
}: {
  icon: string | null | undefined;
  frame: string | null | undefined;
}) {
  return (
    <>
      <Icon keys={icon == null ? [] : [icon]} glyph="◆" />
      {frame != null && <Icon className="pl-mod-frame" keys={[frame]} />}
    </>
  );
}
