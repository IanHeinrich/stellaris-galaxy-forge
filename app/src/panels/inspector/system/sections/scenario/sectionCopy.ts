/** What a zone is, in four short lines: the ring is empty space the mod fills at game start. */
export const FE_ZONE_INTRO = [
  "A fallen empire zone is empty space.",
  "At game start the Paint a Galaxy mod creates a fallen empire's home system at the centre " +
    "of the ring, its other systems around it, and hyperlanes to systems nearby.",
  "Nothing already on the map is used or moved, so keep the ring clear of your systems.",
  "Every zone belongs to one of your systems, which the ring is measured from: add it from " +
    "the system you want it near.",
] as const;

/** What a clan home is, in three short lines: three systems, created at game start. */
export function homeIntro(clan: number): readonly string[] {
  return [
    `This system is clan ${clan}'s home.`,
    "The initializer creates the clan at game start.",
    "A clan is the home and two outposts, each hyperlaned to it.",
  ];
}
