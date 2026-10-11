/** What a zone is, on one line: the ring is empty space the mod fills at game start. */
export const FE_ZONE_LINE =
  "Empty space where the Paint a Galaxy mod creates a fallen empire at game start.";

/** What the mod builds in the ring and what the zone is measured from. */
export const FE_ZONE_CARD =
  "At game start the mod creates the fallen empire's home system at the centre of the ring, its " +
  "other systems around it, and hyperlanes to systems nearby. Nothing already on the map is used " +
  "or moved, so keep the ring clear of your systems. Each zone is measured from one of your " +
  "systems, so add it from the system you want it near.";

/** The clan home's line: whose home it is and when the clan appears. */
export function homeLine(clan: number): string {
  return `Clan ${clan}'s home. The clan spawns here at game start.`;
}

/** What a clan is made of. */
export const CLAN_CARD = "A clan is the home and two outposts, each hyperlaned to it.";
