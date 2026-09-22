import type { AppIssueCode } from "./issues";

/** What the Issues tab says about one kind of finding, in a player's words. */
export interface IssueCopy {
  /** What it is, in a player's words. Sentence case, no jargon, no code names. */
  title: string;
  /** What it costs in-game. One or two sentences. */
  why: string;
  /** How to put it right, in the editor where that is possible. One or two sentences. */
  fix: string;
  /** Whether the validator's own message adds specifics worth showing on the row. */
  detail: boolean;
}

const COPY: Record<AppIssueCode, IssueCopy> = {
  lane_asymmetric: {
    title: "Hyperlane written at one end only",
    why: "Stellaris writes a hyperlane into both of the systems it joins. Only one end of this one is written.",
    fix: "Cut the lane and draw it again, which writes both ends.",
    detail: false,
  },
  lane_endpoint_missing: {
    title: "Hyperlane to a system that is not here",
    why: "The lane leads to a system the file does not contain, so the map cannot draw it.",
    fix: "The editor cannot cut this one lane. Right-click the system and choose Isolate, which clears every hyperlane it has, then draw the good ones again.",
    detail: false,
  },
  lane_self: {
    title: "Hyperlane from a system to itself",
    why: "The system is joined to itself. The map draws nothing for it.",
    fix: "Open the system and cut the lane to itself from its Hyperlanes list.",
    detail: false,
  },
  lane_duplicate: {
    title: "The same hyperlane written twice",
    why: "The file lists this hyperlane twice. Stellaris writes duplicates like this in its own saves and they do no harm.",
    fix: "Nothing needs doing. Deleting the lane removes both copies.",
    detail: false,
  },
  system_isolated: {
    title: "System with no hyperlanes",
    why: "Nothing links this system to the rest of the galaxy. Only a gate or a jump drive can reach it.",
    fix: "Draw a hyperlane to a neighbour, or delete the system.",
    detail: false,
  },
  out_of_bounds: {
    title: "System outside the galaxy edge",
    why: "The system sits further from the centre than the galaxy's own radius, outside the edge the map draws.",
    fix: "Drag it back inside the galaxy edge.",
    detail: true,
  },
  disconnected: {
    title: "Galaxy split into unconnected pieces",
    why: "Your edits have broken the galaxy into more pieces than it had when the file opened. A fleet in one piece cannot reach the others.",
    fix: "Choose Join islands to link the pieces with the shortest hyperlanes that cross none, or undo the lane you removed.",
    detail: true,
  },
  nebula_membership: {
    title: "Nebula list does not match the map",
    why: "The save lists each nebula's systems separately from where those systems lie. Here the two disagree.",
    fix: "Move the system or change the nebula's radius until the two agree. The list itself cannot be edited here.",
    detail: true,
  },
  coordinate_transform: {
    title: "Positions shifted before the game reads them",
    why: "This scenario shifts every position before the game places its systems. The map draws the positions as the file writes them, so the galaxy in game will sit elsewhere.",
    fix: "Nothing needs doing. Start a game on this map to see where the systems land.",
    detail: false,
  },
  position_range: {
    title: "Position written as a range",
    why: "The position here is written as a range, and the generator picks a point inside it every time it builds the galaxy. The map draws the middle.",
    fix: "Nothing needs doing. Moving the system pins it to one point.",
    detail: false,
  },
  export_dropped: {
    title: "Wormholes and gates left behind",
    why: "A scenario file has no way to say where a wormhole, a gateway or an L-Gate goes. The export dropped the ones this save had.",
    fix: "Nothing can put them back. The galaxy settings decide how many the game places and where.",
    detail: true,
  },
  home_initializer: {
    title: "Seat on a start written for one empire",
    why: "This seat stands on a starting system written for one named empire. The generator offers that start to no other empire, so the seat fits only the one that began there.",
    fix: "Select the system and pick a generic start with Choose… in the inspector's Initializer section. The Paint a Galaxy export does this for you.",
    detail: true,
  },
  fe_zone_blocked: {
    title: "System in a fallen empire's space",
    why: "A system stands inside the ring where Paint a Galaxy builds this fallen empire. The mod needs that ring clear.",
    fix: "Move the system clear of the ring, or fit the zones again.",
    detail: false,
  },
  fe_zone_overlap: {
    title: "Two fallen empire zones overlap",
    why: "Two zones' rings cover the same space, and the mod cannot build two fallen empires there.",
    fix: "Move one of the zones, or fit the zones again.",
    detail: false,
  },
  fe_zone_off_map: {
    title: "Fallen empire zone off the edge of the map",
    why: "The zone's centre lies off the canvas Paint a Galaxy paints on. The mod has nowhere to build the fallen empire.",
    fix: "Move the zone's system further in, or fit the zones again.",
    detail: false,
  },
  fe_zone_no_automatic: {
    title: "No fallen empire zones on the map",
    why: "Paint a Galaxy builds fallen empires only where the map lays a ring for them. This map lays none, so a game started on it gets none however many you ask for.",
    fix: "Press Fit zones… to lay some.",
    detail: false,
  },
  fe_link_isolated: {
    title: "Fallen empire with no way in",
    why: "This zone takes hand-picked connections and no system links to it. The fallen empire gets no hyperlane, so it starts cut off from the galaxy.",
    fix: "Press Use nearest systems to link the systems around it.",
    detail: false,
  },
  fe_link_dangling: {
    title: "Link to a fallen empire that is not there",
    why: "This system is set to connect to a fallen empire zone, and no zone claims that connection.",
    fix: "Press Unlink to drop the connection.",
    detail: false,
  },
  fe_link_shared: {
    title: "Two fallen empires share a connection",
    why: "Both zones take the same connection, so every system linked to it joins both fallen empires.",
    fix: "Open one of the zones and give it a connection of its own.",
    detail: false,
  },
  fe_link_far: {
    title: "Long link to a fallen empire",
    why: "The link to this fallen empire zone reaches from further off than Paint a Galaxy's own rule allows. The mod lays the hyperlane anyway.",
    fix: "Nothing needs doing. Link a nearer system if you want a shorter lane.",
    detail: true,
  },
  header_empire_count: {
    title: "Galaxy settings do not match the map",
    why: "This file's settings and the map disagree on how many empires, fallen empires or marauders there are. The new game screen will offer numbers the map cannot seat.",
    fix: "Press Update counts.",
    detail: true,
  },
  seat_letter_duplicate: {
    title: "Two seats reserved for the same empire",
    why: "A reservation keeps a seat for the one empire that carries its trait. More than one seat here is reserved for the same empire, and it can only start on one.",
    fix: "Open a seat's Spawn point section and give it a different reservation.",
    detail: true,
  },
  player_seat_duplicate: {
    title: "More than one seat weighted for the player",
    why: "You start on one of them. Which one comes down to the order the game places empires in.",
    fix: "Clear Weighted for its empire on the seats that are not yours.",
    detail: false,
  },
  sol_seat_mismatch: {
    title: "Sol seat that is already Sol",
    why: "This seat is reserved for the United Nations of Earth and is built as Sol already. The game never seats an empire on a system naming that empire's own start, so the seat stays empty.",
    fix: "Use Choose… in the inspector's Initializer section to give it a generic start.",
    detail: false,
  },
  l_cluster_system: {
    title: "System in the L-Cluster's space",
    why: "When it generates the galaxy the game keeps a patch of space for the L-Cluster, and this system stands in it. The map draws that patch as a circle.",
    fix: "Move the system clear of the circle if you want the L-Cluster left to itself.",
    detail: false,
  },
  scenario_name_duplicate: {
    title: "Another file in the mod uses this name",
    why: "Two files in the mod are listed under the same name. The game shows one galaxy size per name, so one of them never reaches the new game screen.",
    fix: "Change the name in the galaxy inspector's Scenario header, or rename the other file.",
    detail: true,
  },
  reserved_spawns_missing: {
    title: "Reserved seats need another mod",
    why: "A seat reserved for one empire only works with the Reserved Spawns submod. That submod is not in your playset, so these seats are filled at random.",
    fix: "Press Subscribe ↗, then enable the mod in your playset.",
    detail: false,
  },
  galaxy_size_exceeded: {
    title: "Far more systems than the largest galaxy",
    why: "The scenario has many more systems than the biggest galaxy size the game and your mods offer. A galaxy this large can make the game slow, most of all late on.",
    fix: "Nothing needs doing if the game runs well for you. Otherwise remove some systems.",
    detail: true,
  },
  marauder_home_duplicate: {
    title: "One marauder clan with two homes",
    why: "A marauder clan has one home, and more than one system here claims to be the same clan's. The clan spawns from only one of them.",
    fix: "Give the others a different clan's home, or an ordinary start.",
    detail: false,
  },
  marauder_base_orphan: {
    title: "Outpost with no clan home beside it",
    why: "An outpost only works with a hyperlane to its clan's home. This one has none, so nothing spawns there.",
    fix: "Draw a hyperlane from the outpost to its clan's home.",
    detail: false,
  },
  marauder_bases_missing: {
    title: "Marauder clan short of outposts",
    why: "A marauder clan is its home and two outposts hyperlaned to it. This home has fewer, and nothing in the game adds the rest.",
    fix: "Press Add the outposts.",
    detail: true,
  },
  marauder_near_seat: {
    title: "Marauder clan beside an empire seat",
    why: "This clan's home stands close to an empire seat. Whoever starts there takes the raids first.",
    fix: "Nothing needs doing. Move the home away from the seat if you would rather the raids were spread.",
    detail: true,
  },
};

/** Everything the panel and the map tooltip say about one kind of finding. */
export function issueCopy(code: AppIssueCode): IssueCopy {
  return COPY[code];
}

export function issueTitle(code: AppIssueCode): string {
  return COPY[code].title;
}
