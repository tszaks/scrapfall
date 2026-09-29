// Building access: the data a map hands the access system for each building players can go
// up (an elevator tower, a stairwell walk-up, a ladder). Everything else (the lobby, car,
// stairwell and rooftop geometry, the ride, collision, zones, nav, spawning and the minimap
// icons) is derived from this by the access system, so any map can plug buildings in.
//
// Coordinates are world metres (1 unit = 1 m), y up. Rectangles are axis-aligned.

/** outward side of the entrance facade: 0 = -z, 1 = +x, 2 = +z, 3 = -x */
export type Facing = 0 | 1 | 2 | 3;
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type AccessKind = "stairs" | "elevator" | "ladder";

export type AccessSpec = {
  kind: AccessKind;
  /** Explicit spiral geometry and collision; ordinary stairs remain switchbacks. */
  stairStyle?: "spiral" | undefined;
  /** the building's ground-floor massing (solid to the street), containing the lobby */
  footprint: Rect;
  /** the walkable roof: the inner face of the parapet, at `roofY` */
  roof: Rect;
  /** roof surface height */
  roofY: number;
  /** street / lobby floor height */
  groundY: number;
  floors: number;
  /** storey height used for the floor indicator and the stair flights */
  floorHeight: number;
  /** centre of the entrance on the facade plane (the plane must be the footprint's edge) */
  door: { x: number; z: number; facing: Facing };
  /** parapet height above the roof surface */
  parapet: number;
  /** extras for the rooftop dressing */
  helipad?: boolean | undefined;
  /** a mast / spire over the elevator penthouse (the landmark keeps its spire) */
  spire?: number | undefined;
  /** a label for debugging and the test handle */
  name?: string | undefined;
  /** seed for the rooftop dressing */
  seed: number;
  /** "open": a flat roof in the weather (default); "room": an enclosed lookout (a belfry, a
   * loft, a top-floor lounge) the access system builds inside the host's walls */
  roofKind?: "open" | "room" | undefined;
  /** room: clear height and the openings cut in its walls */
  roomH?: number | undefined;
  windows?: "belfry" | "square" | "tall" | undefined;
  /** Map-owned interior themes. Absent preserves the original rooms and lobbies. */
  furnishings?:
    | {
        lobby?: "pier-reception" | "alpine-reception";
        room?: "hotel-lounge" | "chalet-loft" | "belfry";
      }
    | undefined;
  /** host things standing on the roof (a lifeguard hut): solid */
  hostObstacles?: Rect[] | undefined;
  /** rooftop props (default: open roofs yes, rooms and small decks no) */
  dressing?: boolean | undefined;
  /** the host can't cut a doorway in its facade (or a hole in its roof): the access system
   * opens them with a depth punch instead */
  punch?: boolean | undefined;
  /** height of the host's roof cap (the roof-hole punch); default roofY */
  capY?: number | undefined;
  /** the host parapet is low: add a guard rail round the roof edge */
  rail?: boolean | undefined;
  /** ladders: draw the ladder (false when the host model already has one) */
  drawLadder?: boolean | undefined;
  /** door leaf material for punch maps (opaque): wood or steel. Wood also means a plain
   * timber door frame (no canopy / backlit sign): chalets, a church */
  doorStyle?: "wood" | "steel" | undefined;
  /** punch hosts: how far the host's base sticks out in front of the footprint edge (a stone
   * plinth); the doorway punch and the door frame sit in front of it */
  plinth?: number | undefined;
  /** street doorway height (default 2.9 elevator lobby, 2.45 stairwell) */
  doorH?: number | undefined;
  /** a room: its own rectangle when the roof zone is bigger (a terrace outside one wall) */
  roomRect?: Rect | undefined;
  /** a room: a terrace outside one of its walls (a chalet balcony), through a door in that
   * wall. `wall` is the room wall's line (thin, world), `door` the opening along it */
  terrace?: { rect: Rect; wall: Rect; door: [number, number] } | undefined;
};

/** a rectangle in a building's local frame: a along the facade, d depth from the facade plane */
export type LRect = { a0: number; a1: number; d0: number; d1: number };

export type RoofProp = {
  kind: "ac" | "tank" | "mast" | "vent" | "skylight" | "crate" | "car" | "lamp";
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** 0 or 1: swap w and d (quarter turn) */
  rot?: number;
  /** props that block movement and sight (vents and masts are small, still solid) */
  solid: boolean;
};

export type Portal = {
  /** which interior floor the doorway is on: "ground" or "roof" */
  level: 0 | 1;
  /** doorway centre on the wall's outer face, local frame */
  a: number;
  d: number;
  /** outward direction in the local frame (unit, axis-aligned) */
  na: number;
  nd: number;
  /** half the clear opening */
  half: number;
  /** wall thickness (outer face to inner face) */
  wall: number;
  /** how far the walkable doorway reaches past the inner face (default: into the room) */
  inn?: number;
  /** an open doorway (no door leaf): always passable */
  open?: boolean;
};

/** what the city renderer needs to know about an access building (set on its `Bld`) */
export type BldAccess = {
  kind: AccessKind;
  /** roof cap opening over the shaft / stairwell */
  hole: Rect;
  /** doorway cut in the entrance facade: centre on the facade plane, clear width and height */
  door: { x: number; z: number; facing: Facing; w: number; h: number };
  parapet: number;
};
