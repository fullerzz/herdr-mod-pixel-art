// Sprite to element, with a look and a motion per agent status.
// Contract: docs/DESIGN.md, "Contract: sprite-view.js".
//
// Every pixel is an absolutely positioned div. Moving parts sit in their own full-size
// layers so one `.loop("top", ...)` moves the whole part. Motion is native (`.loop`) and
// costs no script time. Each status also differs in a still frame: eyes and accents change,
// not only the motion, because a screenshot is one frame.
//
//   null     open eyes, still
//   working  what its agent is doing, when the agent's hooks say (`work`), else the
//            creature's own way of working, picked by its seed. See WORK below. The
//            longer the work holds, the more tired it gets: after ten minutes sweat drips
//            down both sides of its face, and after thirty a cup of coffee stands by it,
//            on top of any way (`stage`, see STAGES and `fatigue`).
//   blocked  open eyes, still, on fire: a bed of flames at its feet, tongues licking up its
//            sides, and a blinking "!" badge in the top right corner. The longer the block
//            holds, the hotter it burns: small flames at first, tall ones after a minute,
//            and smoke and embers after five (`stage`, see STAGES).
//   done     happy ^ ^ eyes, hops, two sparkles twinkle in turn. After a few seconds it
//            calms down: it stops hopping and the sparkles twinkle slowly, so a drawer of
//            finished agents is quiet (`stage`, see STAGES).
//   idle     closed eyes, dimmed, breathes slowly, a fading "z", and now and then a brief
//            fidget of its own at its own rhythm, picked by its seed. See FIDGET below.
//            The longer the idle holds, the deeper the sleep: after five minutes the "z"
//            becomes a snore bubble, and after thirty dust gathers and the creature fades
//            greyer (`stage`, see STAGES).
//
// A creature at rest (done or idle) also keeps a prop for the time of day at its lower
// right: a lantern at night, a cup of coffee in the morning. See DAYTIME below.
//
// A hit (lines its agent added or removed) adds, on top of any status, a flash of the
// creature's silhouette and a knock: up for added lines, sideways for removed ones. Both
// start at full strength and ease back with `.transition`, so the caller renders a hit
// twice: `live` first, then settled. Its size sets the strength: a tick flashes faintly
// and knocks by less than a cell; a crit flashes solid and fades slowly. No knock grows
// past one cell, since the art leaves only the outer ring of the box empty.
//
// A turn (a one-shot the caller plays when its agent's status changes, see TURNS) takes the
// status's place while it lasts: the turn moves the creature's parts, as a way of working
// does, and draws its own marks, once a step as the caller renders it. The creature goes
// back to its status's look when the turn is over.
//
//   jolt     any change to blocked: the creature jumps up a cell as if startled, drops
//            back, and the fire catches at its feet; the badge comes with the blocked look
//   douse    blocked to working: water pours on the fire and puts it out, steam rises
//   cheer    working to done: one burst of confetti pops out from behind the creature,
//            which hops with happy eyes, and drifts down as it fades
//   stretch  any other change to working (idle or done): the creature yawns with its eyes
//            shut, stretches up a cell, and drops back with its eyes popped open
//   party    no change of its own: the drawer plays it on every creature at once when all
//            its agents are done. Each crouches and jumps twice with happy eyes, together
//   glance   no change of its own either: the drawer plays it on every creature but a
//            blocked one when its window comes back. Each opens its eyes and lifts its head
//            a cell, then lowers it again
//
// Dozing (`doze`), while the window is away, a working or done creature rests as an idle one
// does, in a nap's first stage; an idle one sleeps on. A blocked one keeps burning.
//
// `faceRects` is the creature still from one side, front, back or turned edge-on, for a
// caller that turns it.
//
// Facing a way (`face`), the creature, with its props and marks, steps a cell toward it, and
// to a side its open or glancing eyes look that way. The drawer turns its creatures toward
// its open side on hover.
//
// Riding (`ride`), all of it sways from side to side as one, as a rider on a bus does. The
// drawer has its creatures ride while it is dragged.

import { div } from "gpui-kit";
import { theme } from "herdr";
import { GRID, hashSeed } from "./sprites.js";

/** @import { Color, Element } from "gpui-kit" */
/** @import { Status } from "herdr" */
/** @import { Mood, Rect, Sprite } from "./sprites.js" */
/** @import { HitSize } from "./edits.js" */

/**
 * `theme()`, its values typed as the hex colors they are so they can go to `.bg()`.
 * `herdr.d.ts` declares them as plain strings.
 * @typedef {Record<string, Color>} Theme
 */

/** @type {(r: Rect, u: number) => Element} One rectangle, `u` px per cell. */
const cell = (r, u) => div().absolute().left(r.x * u).top(r.y * u).w(r.w * u).h(r.h * u).bg(r.color);
/** @type {(rects: Rect[], u: number) => Element} A full-size layer of rectangles. */
const layer = (rects, u) => div().absolute().left(0).top(0).size(GRID * u).children(rects.map((r) => cell(r, u)));

/** @typedef {[x: number, y: number, w?: number, h?: number][]} Cells w and h default to 1. */

/**
 * Rectangles in cells, for accents. Any color.
 * @param {Cells} cells
 * @param {Color} color
 * @param {number} u
 * @returns {Element}
 */
const mark = (cells, color, u) => layer(cells.map(([x, y, w = 1, h = 1]) => ({ x, y, w, h, color })), u);

/**
 * How long a status must hold for a sprite to reach each stage, in ms from its start,
 * ascending, per status. Stage 0 is before the first; the drawer counts the stage from its
 * clock of each agent's status and redraws when the next one is reached. A look that
 * changes with time adds its times here. Blocked burns hotter after a minute and again
 * after five (see `fire`); idle snores after five minutes and gathers dust after thirty
 * (see `sleep`); working sweats after ten minutes and takes a coffee after thirty (see
 * `fatigue`); done calms down after five seconds, once any cheer and party are over (see
 * `accents` and the hop in `spriteElement`).
 * @type {Record<Status, number[]>}
 */
export const STAGES = { working: [600_000, 1_800_000], blocked: [60_000, 300_000], done: [5_000], idle: [300_000, 1_800_000] };

/** The colors of hits: added lines heal, removed lines hurt. */
export const HIT = /** @type {const} */ ({ added: "#3ddc6a", removed: "#ff4d5e" });

/**
 * A hit as the sprite shows it.
 * @typedef {object} SpriteHit
 * @property {number} n The hit's number: a new number is a new hit, drawn from the start.
 * @property {boolean} damage Lines were removed: a red flash and a sideways knock.
 * @property {boolean} live Its first frame, at full strength. Settled, it eases back.
 * @property {HitSize} [size] How hard it hits (default "hit"): sets the flash and the knock.
 */

/** @type {Record<HitSize, { flash: number, fade: number }>} A flash's opacity when live, and ms it fades over. */
const STRIKE = { tick: { flash: 0.5, fade: 200 }, hit: { flash: 0.9, fade: 320 }, crit: { flash: 1, fade: 700 } };

/** The colors of a blocked creature's fire, from its edge in to its core. */
export const FIRE = /** @type {const} */ ({ red: "#e5381f", orange: "#ff8c1a", yellow: "#ffd447" });

/**
 * The colors of the smoke a long fire gives off: a warm gray ash, lighter than a failed
 * command's black smoke. Their own: never FIRE's, DOUSE's or a status cue's.
 */
export const SMOKE = /** @type {const} */ ({ dark: "#6e655c", light: "#a89d92" });

/**
 * A blocked creature on fire, as hot as its stage. The bed at its feet holds still, so a
 * single frame shows the fire; the tongues flicker in turn over it and up both sides, go
 * behind the creature, so they show only where the art leaves room, and lick up by a cell.
 * At stage 0 the flames are small: the bed and short tongues at its ends. From stage 1 they
 * burn bigger: the bed's ends rise and tall tongues lick up both sides. From stage 2 smoke
 * billows at the top left, clear of the badge, and embers twinkle over the tongues.
 * @param {number} u
 * @param {number} [stage] How hot it burns: 0, 1, or 2 and above (default 0).
 * @returns {{ behind: Element[], front: Element[] }}
 */
function fire(u, stage = 0) {
  /** @type {(cells: Cells, color: Color, from: number, to: number, period: number) => Element} */
  const flicker = (cells, color, from, to, period) => mark(cells, color, u).loop("opacity", { from, to, period });
  /** @type {(el: Element, period: number) => Element} Licks up by a cell and back. */
  const lick = (el, period) => div().absolute().left(0).top(0).size(GRID * u).child(el).loop("top", { from: 0, to: -u, period });
  const big = stage >= 1;
  const bed = [
    mark([[1, 11, 10, 1], ...(big ? /** @type {Cells} */ ([[1, 10], [10, 10]]) : [])], FIRE.red, u),
    mark([[3, 11, 6, 1], ...(big ? /** @type {Cells} */ ([[2, 10], [9, 10]]) : [])], FIRE.orange, u),
    mark([[5, 11, 2, 1]], FIRE.yellow, u),
  ];
  const tongues = big
    ? [
      lick(flicker([[0, 6, 1, 4], [1, 8, 1, 2], [11, 8, 1, 2]], FIRE.red, 1, 0.3, 420), 300),
      lick(flicker([[11, 5, 1, 3], [10, 8, 1, 2], [0, 9]], FIRE.orange, 0.3, 1, 420), 360),
    ]
    : [
      lick(flicker([[0, 9, 1, 2]], FIRE.red, 1, 0.3, 420), 300),
      lick(flicker([[11, 9, 1, 2]], FIRE.orange, 0.3, 1, 420), 360),
    ];
  // Every smoke puff and ember starts shown, so a single frame has them too.
  const smoke = stage >= 2
    ? [
      lick(flicker([[0, 2, 2, 1], [1, 1, 2, 1]], SMOKE.dark, 0.9, 0.4, 1800), 2400),
      lick(flicker([[4, 1, 3, 1], [5, 2]], SMOKE.light, 0.4, 0.9, 1800), 2000),
      lick(flicker([[0, 4], [3, 3]], FIRE.yellow, 1, 0.1, 500), 700),
      lick(flicker([[1, 3], [8, 1]], FIRE.orange, 0.1, 1, 500), 820),
    ]
    : [];
  return {
    behind: [...tongues, ...smoke],
    front: [
      ...bed,
      flicker([[3, 10], [6, 10], [8, 10]], FIRE.orange, 1, 0.2, 260),
      flicker([[4, 10], [5, 9], [7, 10]], FIRE.yellow, 0.2, 1, 260),
    ],
  };
}

/** @type {(size: number) => Element} An empty full-size layer, to move what it holds as one. */
const full = (size) => div().absolute().left(0).top(0).size(size);

/** The colors of the water that puts a fire out and of the steam it raises. Their own: never FIRE's or a status cue's. */
export const DOUSE = /** @type {const} */ ({ water: "#2f8fe8", spray: "#a3d8ff", steam: "#e3eaf0", haze: "#9eabb7" });

/**
 * A fire put out, at one step of the turn. Poured, the fire still burns and water hangs over
 * it; splashed, the water falls onto the bed, faster as it falls, and the fire dies as it
 * lands, throwing spray at both ends; steamed, the water is gone and steam rises off the
 * bed and fades. Each part keeps its id across the steps, so `.transition` eases between them.
 * The creature holds still meanwhile: none of its parts moves. The fire is the small one of
 * a block's first minute, the most common: a turn knows no stage, since the status it
 * plays on has just begun.
 * @param {TurnParts} parts Its step is "pour", "splash" or "steam".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function douse({ id, step, u }) {
  const size = GRID * u;
  const wet = step !== "pour";
  const steamed = step === "steam";
  /** @type {(name: string, children: Element[]) => Element} */
  const part = (name, children) => full(size).id(`${id}-${name}`).children(children);
  /** @type {(name: string, children: Element[]) => Element} Burns until the water lands, then dies. */
  const dying = (name, children) => part(name, children).opacity(wet ? 0 : 1).transition("opacity", { duration: 240, delay: 260, easing: "ease-in" });
  const flames = fire(u);
  const water = part("water", [
    mark([[2, 0, 1, 2], [5, 1, 1, 2], [7, 0, 1, 2], [10, 1, 1, 2]], DOUSE.water, u),
    mark([[2, 0], [7, 0]], DOUSE.spray, u),
  ])
    .top(wet ? 8 * u : 0)
    .opacity(steamed ? 0 : 1)
    .transition("top", { duration: 300, easing: "ease-in" })
    .transition("opacity", { duration: 200 });
  const spray = part("spray", [mark([[0, 9], [1, 8], [10, 8], [11, 9]], DOUSE.spray, u)])
    .opacity(step === "splash" ? 1 : 0)
    .transition("opacity", steamed ? { duration: 300 } : { duration: 80, delay: 280 });
  // Steam goes up in front, over the creature: it is the news that the fire is out.
  const steam = part("steam", [[1, 8], [5, 9], [9, 8]].map(([x, y], i) => cell({ x, y, w: 2, h: 2, color: i === 1 ? DOUSE.haze : DOUSE.steam }, u).rounded(u)))
    .top(steamed ? -6 * u : 0)
    .opacity(step === "splash" ? 0.9 : 0)
    .transition("top", { duration: 1000, easing: "ease-out" })
    .transition("opacity", steamed ? { duration: 1000, easing: "ease-in" } : { duration: 160, delay: 420 });
  return { behind: [dying("embers", flames.behind)], front: [dying("fire", flames.front), spray, water, steam] };
}

/** The colors of the confetti a finished creature throws. Their own: never HIT's, FIRE's or a status cue's. */
export const CONFETTI = /** @type {const} */ ({ pink: "#ff5fa2", violet: "#a77bff", sky: "#4cc9f0" });

/**
 * Where each bit of confetti lands, in cells, and its color: the top rows and the edge
 * columns, where the art leaves room. Behind the creature, so it never covers a face.
 * @type {[x: number, y: number, color: keyof typeof CONFETTI][]}
 */
const BITS = [[0, 4, "sky"], [1, 1, "pink"], [3, 0, "violet"], [5, 1, "sky"], [7, 0, "pink"], [9, 1, "violet"], [11, 2, "sky"], [11, 5, "pink"]];

/** The cell the confetti bursts out of, behind the body. */
const POP = /** @type {const} */ ({ x: 5, y: 5 });

/**
 * A creature that just finished, at one step of the turn. Popped, the confetti waits
 * unseen behind the body; burst, it flies out to the top rows and the edges, slowing as it
 * goes; fallen, it drifts three cells down, faster as it falls, and fades. Each bit keeps
 * its id across the steps, so `.transition` eases between them. The creature hops as it
 * does when done, with happy eyes, so the done pose takes over without a jump.
 * @param {TurnParts} parts Its step is "pop", "burst" or "fall".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function cheer({ id, step, u, left, right, torso }) {
  const hop = { from: 0, to: -u, period: 700, easing: /** @type {const} */ ("ease-out") };
  for (const part of [left, right, torso]) part.loop("top", hop);
  const popped = step === "pop";
  const fallen = step === "fall";
  const bits = BITS.map(([x, y, color], i) =>
    full(GRID * u)
      .id(`${id}-bit-${i}`)
      .child(cell({ x, y, w: 1, h: 1, color: CONFETTI[color] }, u))
      .left(popped ? (POP.x - x) * u : 0)
      .top(popped ? (POP.y - y) * u : fallen ? 3 * u : 0)
      .opacity(popped || fallen ? 0 : 1)
      .transition("left", { duration: 420, easing: "ease-out" })
      .transition("top", fallen ? { duration: 900, easing: "ease-in" } : { duration: 420, easing: "ease-out" })
      .transition("opacity", fallen ? { duration: 900, easing: "ease-in" } : { duration: 80 }));
  return { behind: bits, front: [] };
}

/** The color of a yawning mouth: the art's own ink, so it reads as part of the face. */
const YAWN = "#16141f";

/**
 * A creature waking up for work, at one step of the turn. Yawning, it slumps a little with
 * its eyes shut and its mouth open wide under them; stretching, the mouth shuts and the body
 * reaches up a cell over its planted feet, slowing as it goes; woken, it drops back into
 * place with its eyes open, and a tick pops out in each top corner, by its head. The body
 * keeps its id across the steps, so `.transition` eases between them. The eyes are the
 * turn's, by step.
 * @param {TurnParts} parts Its step is "yawn", "stretch" or "wake".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function stretch({ id, step, u, nudge, size, t, sprite, torso }) {
  const woken = step === "wake";
  torso
    .id(`${id}-body`)
    .top(step === "yawn" ? nudge : step === "stretch" ? -u : 0)
    .transition("top", woken ? { duration: 160, easing: "ease-in" } : { duration: 420, easing: "ease-out" });
  if (step === "yawn") {
    // Two rows under the eyes' top, across the middle two columns, two rows deep: only
    // where the body is, so it never shows off the art.
    const y = Math.min(...sprite.parts.eyes.open.map((r) => r.y)) + 2;
    /** @type {(x: number, y: number) => boolean} */
    const art = (x, y) => sprite.parts.body.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    /** @type {Cells} */
    const gape = [[GRID / 2 - 1, y], [GRID / 2, y], [GRID / 2 - 1, y + 1], [GRID / 2, y + 1]];
    torso.child(full(size).id(`${id}-mouth`).child(mark(gape.filter(([x, y]) => art(x, y)), YAWN, u)));
  }
  // Behind the creature, so the ticks show only where the art leaves room.
  const pop = full(size).id(`${id}-pop`).child(mark([[0, 2], [1, 1], [GRID - 1, 2], [GRID - 2, 1]], t.foreground, u));
  return { behind: woken ? [pop] : [], front: [] };
}

/**
 * A creature startled into a block, at one step of the turn. Jumped, the whole creature,
 * feet and all, snaps up a cell at once, over two dashes on the floor it left; landed, it drops back into place, faster as it falls; caught, the blocked fire fades
 * in at its feet and up its sides: the small one of a block's first minute, since a turn
 * knows no stage. The fire is there from the first step, unseen, and each
 * part keeps its id across the steps, so `.transition` eases between them. The startle
 * draws no "!": the badge is the blocked look's, and shows when the turn is over.
 * @param {TurnParts} parts Its step is "jump", "land" or "catch".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function jolt({ id, step, u, size, t, left, right, torso }) {
  const jumped = step === "jump";
  /** @type {[string, Element][]} */
  const moving = [["left", left], ["right", right], ["body", torso]];
  for (const [name, part] of moving) part.id(`${id}-${name}`).top(jumped ? -u : 0).transition("top", { duration: 140, easing: "ease-in" });
  const flames = fire(u);
  /** @type {(name: string, children: Element[]) => Element} Unseen until the fire catches. */
  const catching = (name, children) => full(size).id(`${id}-${name}`).children(children)
    .opacity(step === "catch" ? 1 : 0)
    .transition("opacity", { duration: 300, easing: "ease-in" });
  // On the floor it left, in the bottom rows a creature a cell up leaves empty, behind it.
  const lift = full(size).id(`${id}-lift`).child(mark([[2, GRID - 1, 2, 1], [GRID - 4, GRID - 1, 2, 1]], t.foreground, u));
  return { behind: [catching("embers", flames.behind), ...(jumped ? [lift] : [])], front: [catching("fire", flames.front)] };
}

/**
 * A creature at the party when every agent is done, at one step of the turn. Crouched, the
 * body dips over its planted feet; hopped and leapt, the whole creature, feet and all, jumps
 * a cell, slowing as it rises; landed and settled, it drops back, faster as it falls. The
 * drawer plays the same step on every creature at once, so they all jump together, and
 * transitions rather than loops move them, so none is out of step for having turned done
 * earlier. Each part keeps its id across the steps, so `.transition` eases between them.
 * @param {TurnParts} parts Its step is "crouch", "hop", "land", "leap" or "settle".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function party({ id, step, u, nudge, left, right, torso }) {
  const up = step === "hop" || step === "leap";
  /** @type {[string, Element][]} */
  const moving = [["left", left], ["right", right], ["body", torso]];
  for (const [name, part] of moving) {
    part
      .id(`${id}-${name}`)
      .top(up ? -u : step === "crouch" && name === "body" ? nudge : 0)
      .transition("top", up ? { duration: 200, easing: "ease-out" } : { duration: 140, easing: "ease-in" });
  }
  return { behind: [], front: [] };
}

/**
 * A creature glancing up as its window comes back, at one step of the turn. Up, its eyes
 * open and its head and body lift a cell over its planted feet, at once; down, they drop
 * back, faster as they fall. The body keeps its id across the steps, so `.transition` eases
 * between them. Nothing loops, so the drawer keeps every creature in step.
 * @param {TurnParts} parts Its step is "up" or "down".
 * @returns {{ behind: Element[], front: Element[] }}
 */
function perk({ id, step, u, torso }) {
  torso.id(`${id}-body`).top(step === "up" ? -u : 0).transition("top", { duration: 200, easing: "ease-in" });
  return { behind: [], front: [] };
}

/**
 * A one-shot a sprite plays when its agent's status changes: a turn.
 * @typedef {object} Turn
 * @property {Status | null} from The status it plays from; null for any.
 * @property {Status | null} to The status it plays to; null for any.
 * @property {string} first Its first step, drawn on the draw that finds the change.
 * @property {[ms: number, step: string | null][]} steps When each next step starts, in ms
 *   from the change, ascending; null: it is over.
 * @property {Mood | Record<string, Mood>} eyes The creature's eyes while it plays, or by
 *   step for eyes that change: a step it leaves out has open eyes.
 * @property {(parts: TurnParts) => { behind: Element[], front: Element[] }} build
 *   At a step: moves the creature's parts, as a way of working does, and returns its marks,
 *   in place of the status's. A part it leaves alone holds still.
 */

/**
 * What a turn is given at a step: the creature's parts, the turn's id (the sprite's, its
 * kind and its number: any id it uses starts with `id + "-"`) and the step.
 * @typedef {Parts & { id: string, step: string }} TurnParts
 */

/**
 * The turns, by name. The caller plays the first whose `from` and `to` match a change, and
 * a later change on the same agent ends it. A new turn adds its entry here.
 * @type {Record<string, Turn>}
 */
export const TURNS = {
  // The only turn to blocked, from any status. Short: the agent is waiting on its person.
  jolt: { from: null, to: "blocked", first: "jump", steps: [[200, "land"], [400, "catch"], [900, null]], eyes: "open", build: jolt },
  douse: { from: "blocked", to: "working", first: "pour", steps: [[40, "splash"], [700, "steam"], [1800, null]], eyes: "open", build: douse },
  // Over well before the done look calms down after a few seconds (STAGES).
  cheer: { from: "working", to: "done", first: "pop", steps: [[40, "burst"], [600, "fall"], [1600, null]], eyes: "happy", build: cheer },
  // After douse: blocked to working matches it first, so this one plays from idle or done.
  stretch: { from: null, to: "working", first: "yawn", steps: [[500, "stretch"], [1000, "wake"], [1500, null]], eyes: { yawn: "closed", stretch: "closed", wake: "open" }, build: stretch },
  // No change is from a status to itself, so no change plays it: the drawer plays it on every
  // creature at once, when the last agent turns done and every one is.
  party: { from: "done", to: "done", first: "crouch", steps: [[100, "hop"], [380, "land"], [560, "leap"], [840, "settle"], [1100, null]], eyes: "happy", build: party },
  // No change plays it either: the drawer plays it on every creature but a blocked one, at
  // once, when its window comes back and they wake from their doze.
  glance: { from: "idle", to: "idle", first: "up", steps: [[500, "down"], [700, null]], eyes: "open", build: perk },
};

/**
 * A turn as the sprite shows it.
 * @typedef {object} SpriteTurn
 * @property {string} kind Its name in TURNS. Any other name is no turn.
 * @property {number} n Its number: a new number is a new turn, drawn from the start.
 * @property {string} step The step it is at.
 */
/** @type {(x: number, y: number, w: number, h: number, color: Color) => Element} A rectangle in px. */
const rect = (x, y, w, h, color) => div().absolute().left(x).top(y).w(w).h(h).bg(color);

/** The colors of the things a working creature holds. Their own, like the sprite's art. */
const PROP = /** @type {const} */ ({
  keyboard: "#bac2de",
  key: "#585b70",
  ink: "#45475a",
  page: "#ece6da",
  leaf: "#d6ccb8",
  cover: "#7a4a2c",
  wood: "#a8703f",
  shadow: "#101016", // under a light shape, so it reads on pale creatures too
  glass: "#cfe3ea",
  bubble: "#ffffff",
  brick: "#a4553a",
  mortar: "#6e3a28",
  box: "#c8955a",
  flap: "#dcb27a",
  hold: "#5a3d22", // the inside of an open box
});

/**
 * The eyes a prop in front from row 8 down would cover, drawn again over it and bobbing as
 * the body does, so a book or a keyboard never hides a low-eyed creature's face. Nothing for
 * the eyes higher up.
 * @param {Rect[]} eyes
 * @param {number} u
 * @param {import("gpui-shell").LoopPolicy} bob The torso's own loop on `top`.
 * @returns {Element[]}
 */
function peek(eyes, u, bob) {
  const low = eyes.filter((r) => r.y + r.h > 8);
  return low.length ? [layer(low, u).loop("top", bob)] : [];
}

/**
 * The thought bubble's size in cells. It sits in the top left corner, two rows tall so a head
 * that reaches row 2 (a hat, horns) still has an empty cell beside it under the bubble's end.
 */
const BUBBLE = /** @type {const} */ ({ w: 5, h: 2 });

/**
 * Where a thought bubble's tail goes, as puff centres in cells: `near` in an empty cell
 * beside the creature's head (the art at or above its eyes), and `mid` halfway from it to
 * the bubble when there is room for a second puff, clear of the art. The shortest tail
 * wins: most heads come within a cell of the bubble, and the tail is one puff between them.
 * On a tie the cell nearer the face wins. It never ends in the two columns at the left
 * edge, and in the top row only when no other cell is near: a tail there runs along the
 * cell's edge, away from the face.
 * @param {Sprite} sprite
 * @returns {{ near: { x: number, y: number }, mid: { x: number, y: number } | null }}
 */
function tail(sprite) {
  const solid = new Set();
  for (const r of [...sprite.parts.body, ...sprite.parts.eyes.open]) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) solid.add(y * GRID + x);
  }
  /** @type {(x: number, y: number) => boolean} Art in the cell holding the point (x, y). */
  const art = (x, y) => solid.has(Math.floor(y) * GRID + Math.floor(x));
  /** @type {(x: number, y: number) => boolean} Art in a cell round the point. */
  const beside = (x, y) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => art(x + dx, y + dy)));
  /** @type {(x: number, y: number) => boolean} A middle puff here touches art. */
  const blocked = (x, y) => [-0.35, 0.35].some((dy) => [-0.35, 0.35].some((dx) => art(x + dx, y + dy)));
  const eyes = sprite.parts.eyes.open;
  const face = {
    x: eyes.reduce((sum, r) => sum + r.x + r.w / 2, 0) / eyes.length,
    y: eyes.reduce((sum, r) => sum + r.y + r.h / 2, 0) / eyes.length,
  };
  const top = Math.min(...eyes.map((r) => r.y));
  /** @type {{ score: number, near: { x: number, y: number }, mid: { x: number, y: number } | null } | null} */
  let best = null;
  for (let y = 0; y <= top; y++) {
    for (let x = 2; x < GRID; x++) {
      const near = { x: x + 0.5, y: y + 0.5 };
      if ((x < BUBBLE.w && y < BUBBLE.h) || art(near.x, near.y) || !beside(near.x, near.y)) continue;
      // The bubble's nearest point. A second puff fits halfway to it from a cell away.
      const edge = { x: Math.min(near.x, BUBBLE.w), y: Math.min(near.y, BUBBLE.h) };
      const gap = Math.hypot(near.x - edge.x, near.y - edge.y);
      if (gap > 2.5) continue;
      const mid = gap >= 1.5 ? { x: (near.x + edge.x) / 2, y: (near.y + edge.y) / 2 } : null;
      if (mid && blocked(mid.x, mid.y)) continue;
      const score = gap + (y === 0 ? GRID : 0) + Math.hypot(near.x - face.x, near.y - face.y) / GRID ** 2;
      if (!best || score < best.score) best = { score, near, mid };
    }
  }
  // No head comes near the bubble: one puff under it, toward the face.
  return best ?? { near: { x: Math.min(face.x, BUBBLE.w - 0.5), y: BUBBLE.h + 0.5 }, mid: null };
}

/**
 * What a working creature is given to move: its parts, built but not yet put together.
 * @typedef {object} Parts
 * @property {number} u Pixels per cell.
 * @property {number} size The sprite's side in px.
 * @property {number} nudge A sub-cell move, at least one pixel.
 * @property {Theme} t
 * @property {Sprite} sprite
 * @property {Element} left The left foot's layer.
 * @property {Element} right The right foot's layer.
 * @property {Element} torso The body and eyes, as one layer.
 * @property {boolean} tube Whether it holds its test tube when testing.
 * @property {(mood: Mood) => Rect[]} gaze The eyes in a mood, turned as the creature is: a
 *   way that draws the eyes again over a prop draws these, so the creature has one gaze.
 */

/**
 * One way of working: its eyes, what it moves and draws, and where a tired creature's cup
 * stands beside its props.
 * @typedef {object} Work
 * @property {Mood} eyes
 * @property {(parts: Parts) => { behind: Element[], front: Element[] }} build
 * @property {keyof typeof CUP} cup
 */

/**
 * The colors of a tired creature's sweat and coffee: a pale blue drop with a shine, and a
 * white mug of dark coffee. Their own: never DOUSE's, SMOKE's, DUST's, FIRE's, HIT's or a
 * status cue's.
 */
export const FATIGUE = /** @type {const} */ ({ sweat: "#7cc9f2", shine: "#effaff", mug: "#f6f3ee", coffee: "#5c3a21", steam: "#dde5ee" });

/**
 * Where a tired creature's cup stands, as the top left cell of its 3 by 3 box: a wisp of
 * steam in its top row over a 2 by 2 mug, its handle in the left column, toward the
 * creature. `floor` is the lower right, rows 9 to 11 and columns 8 to 10, clear of the edge
 * column. `top` is the top right corner, rows 0 to 2, where no kind has an eye: for a way
 * whose props fill the floor or the right edge.
 */
const CUP = /** @type {const} */ ({ floor: [8, 9], top: [9, 0] });

/**
 * A working creature's fatigue, as tired as its stage: from stage 1, a drop of sweat on each
 * side of its face drips and fades; from stage 2, a cup of coffee stands where its way
 * leaves room. The drops go just outside the eyes, in columns no eye the ways draw reaches,
 * whichever way the creature faces, on the body from a row over the eyes' top down. They
 * ride in the torso, so they bob with the body, under any prop it holds. The cup is a front
 * mark. Every part starts shown, so a single frame has it.
 * @param {Parts} parts
 * @param {keyof typeof CUP} spot Where the way leaves room for the cup.
 * @param {number} stage How long the work has held: 0, 1, or 2 and above.
 * @returns {{ sweat: Element[], cup: Element[] }}
 */
function fatigue({ u, nudge, size, sprite }, spot, stage) {
  if (!(stage >= 1)) return { sweat: [], cup: [] };
  // Every gaze a way can draw: open, look, and look mirrored for a creature facing the other way.
  const { body, eyes: { open, look } } = sprite.parts;
  const eyes = [...open, ...look, ...mirrored(look)];
  const over = Math.min(...eyes.map((r) => r.y)) - 1;
  /** @type {(x: number, y: number) => boolean} Whether the body covers a cell. */
  const skin = (x, y) => body.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  /**
   * A drop over its shadow, dripping as it fades, on the first stretch of body at least two
   * cells tall in its column from a row over the eyes' top down. The drop, its shadow and
   * its drip stay on that stretch, so it only ever covers the body: never a prop held behind
   * the creature, which shows only beside it. No such stretch, no drop.
   * @type {(x: number, period: number) => Element | null}
   */
  const drop = (x, period) => {
    for (let y = Math.max(0, over); y < GRID - 1; y++) {
      if (!skin(x, y) || !skin(x, y + 1)) continue;
      let end = y + 2;
      while (end < GRID && skin(x, end)) end++;
      // A cell, or as far as the shadow, a nudge under the drop, can go and stay on the body.
      const fall = Math.min(u, (end - y - 1) * u - nudge);
      const bead = full(size)
        .child(full(size)
          .child(rect(x * u, y * u + nudge, u, u, PROP.shadow))
          .child(rect(x * u, y * u, u, u, FATIGUE.sweat))
          .child(rect(x * u, y * u, nudge, nudge, FATIGUE.shine))
          .loop("opacity", { from: 1, to: 0.3, period }));
      return fall > 0 ? bead.loop("top", { from: 0, to: fall, period, easing: "ease-in" }) : bead;
    }
    return null;
  };
  const sweat = [drop(Math.min(...eyes.map((r) => r.x)) - 1, 1400), drop(Math.max(...eyes.map((r) => r.x + r.w)), 1900)].filter((d) => d !== null);
  if (!(stage >= 2)) return { sweat, cup: [] };
  const [x, top] = CUP[spot];
  /** @type {(col: number, from: number, to: number) => Element} A thin wisp of steam over a column of the mug. */
  const wisp = (col, from, to) => rect(col * u + Math.floor((u - nudge) / 2), top * u, nudge, Math.max(1, u - nudge), FATIGUE.steam).loop("opacity", { from, to, period: 1800 });
  const cup = [
    mark([[x + 1, top + 1, 2, 2]], FATIGUE.mug, u),
    rect((x + 1) * u, (top + 1) * u, 2 * u, nudge, FATIGUE.coffee),
    rect(x * u + nudge, (top + 1) * u + nudge, u - nudge, u - nudge, FATIGUE.mug),
    wisp(x + 1, 0.9, 0.2),
    wisp(x + 2, 0.2, 0.9),
  ];
  return { sweat, cup };
}

/**
 * The ways a creature works, by what its agent is doing. The props sit over the lower body,
 * in the top left corner, in the two columns at each edge or in empty cells, where no kind
 * has an eye; one that crosses the face draws a second copy of the eyes over itself.
 * @type {Record<string, Work>}
 */
const WORK = {
  // Anything. Feet in turn: swapped from/to puts them half a stride apart.
  walk: {
    eyes: "look",
    cup: "floor",
    build({ u, nudge, t, left, right, torso }) {
      left.loop("top", { from: 0, to: -u, period: 480 });
      right.loop("top", { from: -u, to: 0, period: 480 });
      torso.loop("top", { from: 0, to: -nudge, period: 240 });
      const lines = mark([[0, 5], [0, 7]], t.working, u);
      return { behind: [lines.loop("opacity", { from: 1, to: 0.25, period: 480 })], front: [] };
    },
  },
  // Editing files: a keyboard under the face, its keys lighting in an uneven rhythm, and
  // the body bobbing once a keystroke.
  typing: {
    eyes: "open",
    cup: "top",
    build({ u, nudge, size, t, gaze, torso }) {
      // Keys a cell apart, with a sub-cell gap of case between them.
      /** @type {(x: number, y: number, w: number, color: Color) => Element} */
      const key = (x, y, w, color) => rect(x * u, y * u, w * u - nudge, u - nudge, color);
      const keys = full(size).children([
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((x) => key(x, 9, 1, PROP.key)),
        ...[[2, 1], [3, 1], [4, 4], [8, 1], [9, 1]].map(([x, w]) => key(x, 10, w, PROP.key)), // a space bar
      ]);
      /** @type {(cells: number[][], from: number, to: number, period: number) => Element} */
      const lit = (cells, from, to, period) =>
        full(size).children(cells.map(([x, y]) => key(x, y, 1, t.working))).loop("opacity", { from, to, period });
      const bob = { from: 0, to: -nudge, period: 200 };
      torso.loop("top", bob);
      return {
        behind: [],
        front: [
          rect(u, 9 * u - nudge, 10 * u - nudge, 3 * u, PROP.keyboard),
          keys,
          // Two groups in turn, and a third on its own period, so the rhythm never quite repeats.
          lit([[4, 9], [2, 10]], 1, 0.1, 400),
          lit([[7, 9], [9, 10]], 0.1, 1, 400),
          lit([[5, 9], [8, 9]], 0.1, 1, 560),
          ...peek(gaze("open"), u, bob),
        ],
      };
    },
  },
  // Reading files: an open book under the face. A leaf turns across the spine and a
  // highlight runs along a line, while the body sways slowly.
  reading: {
    eyes: "look",
    cup: "top",
    build({ u, nudge, size, t, gaze, torso }) {
      // Three lines of text a page, the last one short, a quarter of the page apart: inside it at any size.
      /** @type {(x: number) => Element[]} */
      const lines = (x) => [3, 3, 2].map((w, k) => rect(x * u, 8 * u + Math.floor(((k + 1) * 3 * u) / 4), w * u, nudge, PROP.ink));
      const cover = mark([[0, 9, 12, 2], [1, 11, 10, 1]], PROP.cover, u);
      const pages = mark([[1, 8, 10, 3]], PROP.page, u);
      const text = full(size).children([...lines(2), ...lines(7)]);
      const spine = rect(6 * u - nudge, 8 * u, 2 * nudge, 4 * u, PROP.ink);
      // The leaf narrows toward the spine on the right as it grows out on the left. Ease-out
      // on one and ease-in on the other put most of each half of the turn on one side. The
      // left half grows and slides at once: one loop each, on a layer and the leaf in it.
      const turn = { period: 3200 };
      const leafR = rect(6 * u, 8 * u, 0, 3 * u, PROP.leaf).loop("width", { from: 5 * u, to: 0, ...turn, easing: "ease-out" });
      const leafL = full(size)
        .child(rect(6 * u, 8 * u, 0, 3 * u, PROP.leaf).loop("width", { from: 0, to: 5 * u, ...turn, easing: "ease-in" }))
        .loop("left", { from: 0, to: -5 * u, ...turn, easing: "ease-in" });
      const highlight = full(size)
        .child(rect(2 * u, 8 * u + nudge, u, 3 * nudge, t.working))
        .loop("left", { from: 0, to: 2 * u, period: 1600, easing: "linear" });
      const bob = { from: 0, to: -nudge, period: 1600 };
      torso.loop("top", bob);
      return { behind: [], front: [cover, pages, highlight, text, leafR, leafL, spine, ...peek(gaze("look"), u, bob)] };
    },
  },
  // Running commands: a hammer held up at the top left slams down on an
  // anvil, sparks flick at each blow, and the body dips with it.
  hammering: {
    eyes: "open",
    cup: "floor",
    build({ u, size, nudge, t, gaze, torso }) {
      // One blow a period. Ease-in hangs the hammer up high, then slams it down.
      const blow = { period: 720, easing: /** @type {const} */ ("ease-in") };
      // A head 2 by 3 cells, its handle in from its middle. Down, it rests on the anvil's face
      // (rows 7 to 9 over row 10).
      /** @type {Cells} */
      const head = [[0, 1, 2, 3]];
      const hammer = full(size)
        .child(mark([[2, 2, 2, 1]], PROP.wood, u))
        .child(div().absolute().left(nudge).top(nudge).size(size).child(mark(head, PROP.shadow, u)))
        .child(mark(head, t.foreground, u))
        .loop("top", { from: 0, to: 6 * u, ...blow });
      // Held in the torso, so it dips with each blow. The eyes go again on top: the handle
      // passes the face on the way down.
      torso.loop("top", { from: 0, to: nudge, ...blow }).child(hammer).child(layer(gaze("open"), u));
      const anvil = mark([[0, 10, 3, 1], [1, 11]], t.dim, u);
      const sparks = mark([[2, 9], [3, 10]], t.working, u).loop("opacity", { from: 0, to: 1, ...blow });
      return { behind: [], front: [anvil, sparks] };
    },
  },
  // Searching code: a lens wanders across the creature, which shows through its tinted
  // glass, and a glint twinkles on it.
  searching: {
    eyes: "look",
    cup: "floor",
    build({ u, size, nudge, t, gaze, torso }) {
      // A round rim around a 2 by 2 glass, its handle off the lower right.
      /** @type {Cells} */
      const rim = [[1, 0, 2, 1], [1, 3, 2, 1], [0, 1, 1, 2], [3, 1, 1, 2], [3, 3]];
      const lens = full(size)
        .child(div().absolute().left(nudge).top(nudge).size(size).child(mark(rim, PROP.shadow, u)))
        .child(mark([[1, 1, 2, 2]], t.accent, u).opacity(0.3))
        .child(mark([[1, 1]], "#ffffff", u).loop("opacity", { from: 0.9, to: 0.3, period: 1600 }))
        .child(mark(rim, t.foreground, u))
        .child(mark([[4, 4], [5, 5]], PROP.wood, u))
        // Periods that never line up: the lens wanders instead of tracing one path.
        .loop("top", { from: u, to: 3 * u, period: 1700 });
      const sweep = full(size).child(lens).loop("left", { from: 0, to: 6 * u, period: 2600 });
      // Over the body but under a second copy of the eyes, so the lens never covers them.
      torso.child(sweep).child(layer(gaze("look"), u));
      return { behind: [], front: [] };
    },
  },
  // Thinking between tools: a thought bubble in the top left corner, its dots lighting one
  // after another, like "...", and a tail of one or two puffs leading from it to the head,
  // while the creature leans slowly.
  thinking: {
    eyes: "open",
    cup: "floor",
    build({ u, nudge, t, sprite, torso }) {
      torso.loop("left", { from: 0, to: -nudge, period: 2400 });
      const dot = Math.round((2 * u) / 3);
      const x0 = Math.floor((BUBBLE.w * u - 5 * dot) / 2);
      const y0 = Math.floor((BUBBLE.h * u - dot) / 2);
      /** @type {(i: number) => Element} */
      const pip = (i) => div().absolute().left(x0 + 2 * i * dot).top(y0).size(dot).bg(t.canvas);
      // Same period, two easings: the middle dot lights before the last one.
      const bubble = div().absolute().left(0).top(0).w(BUBBLE.w * u).h(BUBBLE.h * u).rounded(u).bg(t.foreground)
        .child(pip(0))
        .child(pip(1).loop("opacity", { from: 0.2, to: 1, period: 1200, easing: "ease-out" }))
        .child(pip(2).loop("opacity", { from: 0.2, to: 1, period: 1200, easing: "ease-in" }));
      // The tail, in front: its puffs sit clear of the art, so they never cover an eye. Two
      // shrink toward the head; one alone is the larger size, to show at 3 px a cell.
      /** @type {(x: number, y: number, s: number) => Element} A puff of side s, centred on (x, y) in cells. */
      const puff = (x, y, s) => div().absolute().left(Math.round(x * u - s / 2)).top(Math.round(y * u - s / 2)).size(s).rounded(s).bg(t.foreground);
      const { near, mid } = tail(sprite);
      const puffs = mid ? [puff(mid.x, mid.y, dot), puff(near.x, near.y, nudge)] : [puff(near.x, near.y, dot)];
      return { behind: [], front: [bubble, ...puffs] };
    },
  },
  // Fetching from the web: an antenna held up at its left, two radio arcs pulsing out of
  // its tip in turn.
  signal: {
    eyes: "look",
    cup: "floor",
    build({ u, nudge, size, t, torso }) {
      torso.loop("top", { from: 0, to: -nudge, period: 1200 });
      // Strokes of two thirds of a cell, so the arcs stay round at 3 px a cell. They go in
      // front: no kind has an eye in rows 0 to 2, or in column 2 above row 5.
      const p = Math.round((2 * u) / 3);
      /** @type {(cells: Cells, color: Color) => Element} */
      const strokes = (cells, color) => full(size).children(cells.map(([x, y, w = 1, h = 1]) => rect(x * p, y * p, w * p, h * p, color)));
      const outer = strokes([[1, 0, 5], [0, 1], [6, 1]], t.working);
      const inner = strokes([[2, 2, 3], [1, 3], [5, 3]], t.working);
      const tip = strokes([[3, 4]], t.foreground);
      // Held at shoulder height, so it never shows in the gap the bob opens above the feet.
      // Behind the creature: it shows only beside it.
      const mast = rect(3 * p, 5 * p, p, 7 * u - 5 * p, t.dim);
      // Same period, two easings: the inner arc lights before the outer one.
      return {
        behind: [mast],
        front: [
          tip,
          inner.loop("opacity", { from: 0.45, to: 1, period: 1200, easing: "ease-out" }),
          outer.loop("opacity", { from: 0.45, to: 1, period: 1200, easing: "ease-in" }),
        ],
      };
    },
  },
  // Running tests: a test tube at its right, bubbles lighting from the bottom of its liquid
  // up and out of it, which the creature watches. Without the tube, it only watches.
  testing: {
    eyes: "look",
    cup: "top",
    build({ u, nudge, t, torso, tube: held }) {
      torso.loop("top", { from: 0, to: -nudge, period: 900 });
      if (!held) return { behind: [], front: [] };
      // Two columns at the right edge, where no kind has an eye: glass over liquid.
      const tube = [mark([[10, 5, 2, 3]], PROP.glass, u), mark([[10, 8, 2, 4]], t.accent, u)];
      const side = Math.floor((u - nudge) / 2);
      /** @type {(x: number, y: number, easing: import("gpui-shell").MotionEasing) => Element} */
      const bubble = (x, y, easing) => rect(x * u + side, y * u + side, nudge, nudge, PROP.bubble).loop("opacity", { from: 0.1, to: 1, period: 900, easing });
      // Same period, three easings: they light from the bottom up.
      return { behind: [], front: [...tube, bubble(10, 10, "ease-out"), bubble(11, 8, "linear"), bubble(10, 6, "ease-in")] };
    },
  },
  // Building: a crane over its head lifts a brick from a pile at its left foot, the cable
  // reeling in as it goes up.
  building: {
    eyes: "open",
    cup: "floor",
    build({ u, nudge, size, t, torso }) {
      torso.loop("top", { from: 0, to: -nudge, period: 800 });
      const p = Math.round((2 * u) / 3);
      // A mast at the right edge, behind the creature, and a jib along the empty top row.
      const mast = rect(size - p, 0, p, size, t.dim);
      const jib = rect(0, 0, size, p, t.dim);
      const pile = [mark([[0, 11, 3, 1]], PROP.mortar, u), mark([[0, 10, 2, 1]], PROP.brick, u)];
      // The brick rides the two columns at the left edge, where no kind has an eye: it rests
      // on the pile and rises to row 3 and back. The cable runs from the jib to its top.
      const lift = { period: 1800, easing: /** @type {const} */ ("ease-in-out") };
      const low = 9 * u;
      const high = 3 * u;
      const cable = rect(u, p, nudge, low - p, t.foreground).loop("height", { from: low - p, to: high - p, ...lift });
      const brick = full(size).child(mark([[0, 9, 2, 1]], PROP.brick, u)).loop("top", { from: 0, to: high - low, ...lift });
      return { behind: [mast], front: [...pile, cable, brick, jib] };
    },
  },
  // Installing: an open box at its feet, the flaps out to the sides, and the package in it
  // popping up out of it and back.
  installing: {
    eyes: "open",
    cup: "top",
    build({ u, nudge, size, t, gaze, torso }) {
      const bob = { from: 0, to: -nudge, period: 1200 };
      torso.loop("top", bob);
      const hold = mark([[3, 9, 6, 1]], PROP.hold, u);
      // Up, it stands in row 8, over the face of a low-eyed creature: those eyes go again on top.
      const item = full(size).child(mark([[5, 8, 2, 2]], t.accent, u)).loop("top", { from: 0, to: 2 * u, period: 1200, easing: "ease-in" });
      const box = mark([[2, 9, 1, 1], [9, 9, 1, 1], [2, 10, 8, 2]], PROP.box, u);
      /** @type {(cells: Cells, from: number, to: number) => Element} A flap, waving out of the box's corner. */
      const flap = (cells, from, to) => full(size).child(mark(cells, PROP.flap, u)).loop("top", { from, to, period: 600 });
      return {
        behind: [],
        front: [hold, item, box, flap([[1, 8], [0, 7]], 0, -nudge), flap([[10, 8], [11, 7]], -nudge, 0), ...peek(gaze("open"), u, bob)],
      };
    },
  },
  // Working with git: a twig grows up its left side and branches out over its head, the
  // new branch leafing out a cell at a time.
  git: {
    eyes: "open",
    cup: "floor",
    build({ u, nudge, t, torso }) {
      torso.loop("top", { from: 0, to: -nudge, period: 1600 });
      // The stem in the two columns at the left edge, the branch in the rows over any eye.
      const stem = mark([[1, 2, 1, 10], [0, 7]], PROP.wood, u);
      /** @type {(cells: Cells, color: Color, easing: import("gpui-shell").MotionEasing) => Element} */
      const grow = (cells, color, easing) => mark(cells, color, u).loop("opacity", { from: 0.1, to: 1, period: 1600, easing });
      return {
        behind: [],
        front: [
          stem,
          mark([[1, 1], [0, 6]], t.working, u),
          // Same period, three easings: the branch grows out from the stem, its leaf last.
          grow([[2, 2]], PROP.wood, "ease-out"),
          grow([[3, 1]], PROP.wood, "linear"),
          grow([[4, 0]], t.working, "ease-in"),
        ],
      };
    },
  },
  // Compacting its context: a press between two rails comes down on its head and squishes
  // it a cell into its feet, then lifts.
  compacting: {
    eyes: "open",
    cup: "floor",
    build({ u, size, t, sprite, torso }) {
      // Ease-in: the press comes down slowly, then slams; it lifts fast, then slows.
      const press = { period: 1600, easing: /** @type {const} */ ("ease-in") };
      // The body sinks a cell over its feet: drawn after them, it hides them as it goes.
      torso.loop("top", { from: 0, to: u, ...press });
      const p = Math.round((2 * u) / 3);
      // At rest the plate sits just over the head, where no art is, and it moves with the
      // head, so it never covers the creature. The rod above it reels out as it comes down.
      const head = Math.min(...sprite.parts.body.map((r) => r.y)) * u;
      const rod = rect(size / 2 - p, 0, 2 * p, head - p, t.dim).loop("height", { from: head - p, to: head - p + u, ...press });
      const plate = full(size).child(rect(p, head - p, size - 2 * p, p, t.foreground)).loop("top", { from: 0, to: u, ...press });
      // The rails, in the empty columns at each edge.
      const rails = [rect(0, 0, p, size, t.dim), rect(size - p, 0, p, size, t.dim)];
      return { behind: [], front: [...rails, rod, plate] };
    },
  },
  // Starting a sub-agent: a megaphone held up over its head, calling its bees, the calls
  // pulsing out of its bell toward the right edge while the body bobs with each shout.
  delegating: {
    eyes: "open",
    cup: "floor",
    build({ u, nudge, size, t, torso }) {
      const call = { period: 900 };
      torso.loop("top", { from: 0, to: -nudge, ...call, easing: "ease-out" });
      // In the rows over any eye: a mouthpiece, a cone and a bell three cells tall at
      // column 9, pointing right. Its handle goes down behind the creature to the shoulder.
      /** @type {Cells} */
      const horn = [[8, 1], [9, 0, 1, 3]];
      const handle = mark([[8, 2, 1, 2]], t.dim, u);
      const megaphone = [
        mark([[7, 1]], t.dim, u),
        div().absolute().left(nudge).top(nudge).size(size).child(mark(horn, PROP.shadow, u)),
        mark(horn, t.foreground, u),
      ];
      // Same period, two easings: the inner call goes out before the outer one, at the edge.
      const inner = mark([[10, 1]], t.working, u).loop("opacity", { from: 0.3, to: 1, ...call, easing: "ease-out" });
      const outer = mark([[11, 0, 1, 3]], t.working, u).loop("opacity", { from: 0.3, to: 1, ...call, easing: "ease-in" });
      return { behind: [handle], front: [...megaphone, inner, outer] };
    },
  },
  // Writing its todo list or a plan: a clipboard held under the face, two items on its
  // sheet ticked off one after the other while the body bobs.
  planning: {
    eyes: "open",
    cup: "top",
    build({ u, nudge, size, t, gaze, torso }) {
      const tick = { period: 1200 };
      const bob = { from: 0, to: -nudge, ...tick };
      torso.loop("top", bob);
      // A board from row 8 down, a sheet on it under a clip, and on the sheet a box and a
      // line of text an item, the second line short.
      const board = mark([[2, 8, 8, 4]], PROP.wood, u);
      const sheet = mark([[3, 9, 6, 2]], PROP.page, u);
      const clip = mark([[5, 8, 2, 1]], t.dim, u);
      const mid = Math.floor((u - nudge) / 2);
      const text = full(size).children([rect(5 * u, 9 * u + mid, 3 * u, nudge, PROP.ink), rect(5 * u, 10 * u + mid, 2 * u, nudge, PROP.ink)]);
      // Same period, two easings: the first item is ticked before the second.
      const first = mark([[4, 9]], t.working, u).loop("opacity", { from: 0.1, to: 1, ...tick, easing: "ease-out" });
      const second = mark([[4, 10]], t.working, u).loop("opacity", { from: 0.1, to: 1, ...tick, easing: "ease-in" });
      return { behind: [], front: [board, sheet, clip, text, first, second, ...peek(gaze("open"), u, bob)] };
    },
  },
  // Calling an MCP tool: a plug held at its right, its cable hanging to the floor, pushed
  // into a socket at the right edge while sparks crackle at the socket.
  mcp: {
    eyes: "open",
    cup: "top",
    build({ u, nudge, size, t, torso }) {
      // Ease-in: the creature leans in slowly, then shoves the plug home.
      const push = { period: 900 };
      // All in the two columns at the right edge, where no kind has an eye. The plug rides in
      // the torso over a shadow, so it leans in with the body and slips behind the socket.
      const mid = Math.floor((u - nudge) / 2);
      torso
        .loop("left", { from: 0, to: nudge, ...push, easing: "ease-in" })
        .child(div().absolute().left(0).top(nudge).size(size).child(mark([[10, 7]], PROP.shadow, u)))
        .child(rect(10 * u + mid, 8 * u, nudge, 4 * u, t.dim))
        .child(mark([[10, 7]], t.foreground, u));
      const socket = mark([[11, 6, 1, 3]], t.dim, u);
      // Same period, two easings: the spark over the socket comes before the one under it.
      const over = mark([[11, 5]], t.working, u).loop("opacity", { from: 0.1, to: 1, ...push, easing: "ease-out" });
      const under = mark([[11, 9]], t.working, u).loop("opacity", { from: 0.1, to: 1, ...push, easing: "ease-in" });
      return { behind: [], front: [socket, over, under] };
    },
  },
  // Loading a skill: a scroll held under the face, which the creature reads as it unrolls to
  // the right and rolls up again, a rune glowing at its start while the body bobs.
  skill: {
    eyes: "look",
    cup: "top",
    build({ u, nudge, size, t, gaze, torso }) {
      // Ease-in-out: the roller slows at each end, open and rolled up.
      const roll = { period: 2400, easing: /** @type {const} */ ("ease-in-out") };
      const bob = { from: 0, to: -nudge, period: roll.period / 2 };
      torso.loop("top", bob);
      // A sheet two rows tall from column 2, a roller a row taller at each end of it. Open,
      // it reaches column 9; rolled up, its first two cells show, the rune and the text on
      // them, and the right roller rides its end.
      const sheet = rect(2 * u, 9 * u, 8 * u, 2 * u, PROP.page).loop("width", { from: 8 * u, to: 2 * u, ...roll });
      const rollers = [mark([[1, 8, 1, 4]], PROP.wood, u), full(size).child(mark([[10, 8, 1, 4]], PROP.wood, u)).loop("left", { from: 0, to: -6 * u, ...roll })];
      const mid = Math.floor((u - nudge) / 2);
      const text = full(size).children([rect(3 * u, 9 * u + mid, u, nudge, PROP.ink), rect(2 * u, 10 * u + mid, 2 * u, nudge, PROP.ink)]);
      const rune = mark([[2, 9]], t.working, u).loop("opacity", { from: 1, to: 0.3, ...roll });
      return { behind: [], front: [sheet, text, rune, ...rollers, ...peek(gaze("look"), u, bob)] };
    },
  },
};

/** Every way of working, by name. `walk` was the only one before the agents' hooks told more. */
export const WORKS = Object.freeze(Object.keys(WORK));

/**
 * The ways a creature can work on its own: the first seven. The ways for kinds of command
 * came later and show only when the hooks say, so every seed keeps the way it had.
 */
const OWN = WORKS.slice(0, 7);

/**
 * The creature's own way of working, for when its agent's hooks say nothing: the same for
 * the same seed. Hashed apart from the art, so the creature looks as it always did.
 * @param {Sprite} sprite
 * @returns {string} One of WORKS' first seven.
 */
export const ownWork = (sprite) => OWN[hashSeed(`${sprite.seed}\u0000work`) % OWN.length];

/**
 * How many layers a fidget nests, each swinging its opacity from 0 to 1 and back on the same
 * period. Opacity multiplies down the tree, so their product is a short spike: the fidget
 * shows near the middle of each period and the creature rests closed-eyed the rest of it.
 * Six keeps it over half strength for under a ninth of the period even if the easing were
 * linear; ease-in makes it shorter still.
 */
const DEPTH = 6;

/** The periods a creature's fidget can come round on, in ms: its rhythm. */
const RHYTHMS = [3600, 4400, 5200, 6200, 7400];

/**
 * One way of fidgeting while idle: what it shows for a moment, over the closed eyes.
 * @typedef {(parts: { u: number, nudge: number, t: Theme, sprite: Sprite }) => Element[]} Fidget
 */

/**
 * The creature's open eyes in a mood, over a patch of its own body where the closed lid is,
 * so no lid shows through eyes that leave its cells empty.
 * @type {(sprite: Sprite, mood: Mood, u: number) => Element}
 */
function peep(sprite, mood, u) {
  const { body, eyes } = sprite.parts;
  /** @type {Rect[]} */
  const patch = [];
  for (const lid of eyes.closed) {
    for (let y = lid.y; y < lid.y + lid.h; y++) {
      for (let x = lid.x; x < lid.x + lid.w; x++) {
        const under = body.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
        if (under) patch.push({ x, y, w: 1, h: 1, color: under.color });
      }
    }
  }
  return layer([...patch, ...eyes[mood]], u);
}

/**
 * The ways an idle creature fidgets, by name. Each shows only for a moment of its
 * period (see DEPTH), so almost every frame of an idle creature is closed-eyed.
 * @type {Record<string, Fidget>}
 */
const FIDGET = {
  // Opens its eyes and shuts them again.
  blink: ({ u, sprite }) => [peep(sprite, "open", u)],
  // Opens its eyes to glance aside, then shuts them again.
  look: ({ u, sprite }) => [peep(sprite, "look", u)],
  // Scratches its side, its eyes still shut: quick strokes in the empty column at its left,
  // clear of the time of day's props at the right.
  scratch: ({ u, nudge, t }) => [mark([[0, 5], [0, 7]], t.foreground, u).loop("top", { from: 0, to: nudge, period: 160 })],
};

/** Every way of fidgeting, by name. */
export const FIDGETS = Object.freeze(Object.keys(FIDGET));

/**
 * The creature's own fidget and its rhythm: the same for the same seed. Hashed apart from the
 * art and from its way of working, so the creature looks and works as it always did.
 * @param {Sprite} sprite
 * @returns {{ fidget: string, period: number }} One of FIDGETS, and one of RHYTHMS in ms.
 */
export function ownFidget(sprite) {
  const h = hashSeed(`${sprite.seed}\u0000fidget`);
  return { fidget: FIDGETS[h % FIDGETS.length], period: RHYTHMS[Math.floor(h / FIDGETS.length) % RHYTHMS.length] };
}

/**
 * The creature's fidget, nested in DEPTH layers that fade it in and out together.
 * @param {Sprite} sprite
 * @param {{ u: number, size: number, nudge: number, t: Theme }} parts
 * @returns {Element}
 */
function fidgeting(sprite, { u, size, nudge, t }) {
  const { fidget, period } = ownFidget(sprite);
  let out = full(size).children(FIDGET[fidget]({ u, nudge, t, sprite }));
  for (let i = 0; i < DEPTH; i++) out = full(size).child(out).loop("opacity", { from: 0, to: 1, period, easing: "ease-in" });
  return out;
}

/** @type {Partial<Record<Status, Mood>>} */
const EYES = { done: "happy", idle: "closed" };

/** @typedef {"night" | "morning"} Daytime A part of the day that has a prop. */

/**
 * The part of the day an hour of the local clock is in: night from 20:00 to 5:59, morning
 * from 6:00 to 10:59, and none the rest of the day.
 * @param {number} hour 0 to 23, as `Date#getHours` gives it.
 * @returns {Daytime | null}
 */
export const daytimeOf = (hour) => (hour >= 20 || hour < 6 ? "night" : hour < 11 ? "morning" : null);

/**
 * The colors of a long idle's dust: a pale cobweb and a dull dust. Their own: never SMOKE's,
 * DOUSE's, FIRE's or a status cue's.
 */
export const DUST = /** @type {const} */ ({ web: "#cdc8bd", dust: "#8a8478" });

/**
 * An idle creature's marks, as deep as its sleep's stage, all behind the creature, so they
 * show only where the art leaves room. At stage 0 a "z" fades in and out at the top right.
 * From stage 1 a snore bubble takes its place there, swelling and shrinking with the breath.
 * From stage 2 a cobweb hangs in the top left corner and dust lies on the floor at the
 * left, clear of the time of day's props at the lower right and the scratch at the left.
 * Every mark starts shown, so a single frame has it, and every stage keeps the theme's
 * idle cue.
 * @param {number} u
 * @param {number} stage How long the idle has held: 0, 1, or 2 and above.
 * @param {Theme} t
 * @returns {Element[]}
 */
function sleep(u, stage, t) {
  if (!(stage >= 1)) return [mark([[8, 0, 4, 1], [10, 1], [9, 2], [8, 3, 4, 1]], t.idle, u).loop("opacity", { from: 1, to: 0.3, period: 2600 })];
  const bubble = [
    mark([[9, 2, 2, 2]], t.idle, u).loop("opacity", { from: 1, to: 0.2, period: 2600 }),
    mark([[9, 0, 2, 1], [8, 1, 1, 2], [11, 1, 1, 2], [9, 3, 2, 1]], t.idle, u).loop("opacity", { from: 0.2, to: 1, period: 2600 }),
  ];
  if (!(stage >= 2)) return bubble;
  return [mark([[0, 0, 3, 1], [0, 1, 1, 2], [1, 1]], DUST.web, u), mark([[1, 11, 2, 1], [4, 11], [6, 11, 2, 1]], DUST.dust, u), ...bubble];
}

/** The colors of the time of day's props. Their own, like the sprite's art. */
const DAY = /** @type {const} */ ({
  iron: "#3b3f4c",
  glass: "#ffe6a0",
  flame: "#ff9e3d",
  mug: "#f2efe8",
  coffee: "#6b4226",
  steam: "#e9eef5",
});

/**
 * The props for the time of day, at a resting creature's lower right. They sit in rows 9 to
 * 11 and the right edge's column, where no kind has an eye in any mood: a happy eye reaches
 * column 10, but no lower than row 8.
 * @type {Record<Daytime, (u: number, nudge: number) => { behind: Element[], front: Element[] }>}
 */
const DAYTIME = {
  // A lantern standing on the floor, 2 by 3 cells: an iron frame round a lit window, a
  // flame flickering in it.
  night(u, nudge) {
    const glass = rect(10 * u + nudge, 9 * u + nudge, 2 * u - 2 * nudge, 2 * u - nudge, DAY.glass);
    const flame = rect(11 * u - Math.floor(nudge / 2), 10 * u - nudge, nudge, 2 * nudge, DAY.flame).loop("opacity", { from: 1, to: 0.35, period: 700 });
    return { behind: [], front: [mark([[10, 9, 2, 3]], DAY.iron, u), glass, flame] };
  },
  // A cup of coffee on a saucer, its handle toward the creature, and two thin wisps of steam
  // rising in turn along the right edge.
  morning(u, nudge) {
    const cup = [
      mark([[9, 11, 3, 1], [10, 9, 2, 2]], DAY.mug, u),
      rect(10 * u, 9 * u, 2 * u, nudge, DAY.coffee),
      rect(9 * u + nudge, 9 * u + nudge, u - nudge, u - nudge, DAY.mug),
    ];
    /** @type {(dx: number, from: number, to: number) => Element} A wisp in the right edge's column, rising a cell and fading. */
    const wisp = (dx, from, to) => full(GRID * u).child(rect(11 * u + dx, 7 * u, nudge, 2 * u - nudge, DAY.steam).loop("opacity", { from, to, period: 1800 }))
      .loop("top", { from: 0, to: -u, period: 1800 });
    return { behind: [], front: [...cup, wisp(0, 0.9, 0.1), wisp(u - nudge, 0.1, 0.8)] };
  },
};

/**
 * Which way a creature can face, and the step it takes that way, in cells.
 * @typedef {"left" | "right" | "up" | "down"} Facing
 * @type {Record<Facing, [dx: number, dy: number]>}
 */
const STEP = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const RIDE_MS = 800; // ms a sway takes, there and back

/** @type {(rects: Rect[]) => Rect[]} The same rectangles, left and right swapped. */
const mirrored = (rects) => rects.map((r) => ({ ...r, x: GRID - r.x - r.w }));

/**
 * Which way the "look" eyes glance against the open ones, by where their pupils move.
 * The pupils are the eyes' darkest color: round and big eyes fill their boxes, so only the
 * dark cells move, and the white ones move the other way.
 * @param {Record<Mood, Rect[]>} eyes
 * @returns {number} Above 0 for screen right, below 0 for left, 0 for neither.
 */
function glance(eyes) {
  const shade = (/** @type {string} */ hex) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
  const dark = eyes.open.reduce((d, r) => (shade(r.color) < shade(d) ? r.color : d), eyes.open[0].color);
  /** @type {(rects: Rect[]) => number} The pupils' cells' summed centers. */
  const pupils = (rects) => rects.reduce((s, r) => (r.color === dark ? s + (r.x + r.w / 2) * r.w * r.h : s), 0);
  return pupils(eyes.look) - pupils(eyes.open);
}

/**
 * The status's marks, drawn behind or in front of the creature.
 * @param {Status | null} status
 * @param {number} u
 * @param {number} stage How long the status has held (`STAGES`): how hot a fire burns, how
 *   deep an idle sleeps, how fast a done creature's sparkles twinkle.
 * @returns {{ behind: Element[], front: Element[] }}
 */
function accents(status, u, stage) {
  const t = /** @type {Theme} */ (theme());
  switch (status) {
    case "blocked": {
      // A badge over the top right corner: a theme-colored tile with a white "!". It goes
      // over the fire, which keeps its own colors: the badge carries the theme's cue.
      const badge = div().absolute().left(9 * u).top(0).w(3 * u).h(5 * u).rounded(u).bg(t.blocked)
        .child(div().absolute().left(u).top(Math.round(u / 2)).w(u).h(2 * u).bg("#ffffff"))
        .child(div().absolute().left(u).top(Math.round(3.25 * u)).w(u).h(u).bg("#ffffff"));
      const { behind, front } = fire(u, stage);
      return { behind, front: [...front, badge.loop("opacity", { from: 1, to: 0.35, period: 800 })] };
    }
    case "done": {
      /** @type {(x: number, y: number) => Cells} A plus sign centered on x, y. */
      const plus = (x, y) => [[x - 1, y, 3, 1], [x, y - 1, 1, 3]];
      // Calmed down, the same sparkles twinkle at a third of the speed.
      const period = stage >= 1 ? 2700 : 900;
      const a = mark(plus(1, 1), t.done, u).loop("opacity", { from: 1, to: 0.15, period });
      const b = mark(plus(10, 3), t.done, u).loop("opacity", { from: 0.15, to: 1, period });
      return { behind: [a, b], front: [] };
    }
    case "idle":
      return { behind: sleep(u, stage, t), front: [] };
    default:
      return { behind: [], front: [] };
  }
}

/**
 * A sprite as an element, with the look and motion of its agent's status.
 * @param {Sprite} sprite
 * @param {object} options
 * @param {string} options.id The element id: unique in the view and stable across renders.
 * @param {number} [options.px] Pixels per cell (default 3).
 * @param {Status | null} [options.status] The agent's status; null draws it still.
 * @param {string | null} [options.work] What a working agent is doing, as its hooks say:
 *   one of WORKS. Anything else, or null, is the creature's own way (`ownWork`).
 * @param {SpriteHit | null} [options.hit] A hit being shown, or null.
 * @param {SpriteTurn | null} [options.turn] A turn being played, or null. While it plays it
 *   takes the status's place: no status look, motion or way of working is drawn.
 * @param {number} [options.stage] How long the status has held, as the number of its
 *   STAGES reached (default 0, also when its start is unknown). Blocked, it sets how hot
 *   the fire burns; idle, how deep the creature sleeps; working, how tired it gets; done,
 *   whether it has calmed down: from stage 1 it stops hopping and twinkles slowly.
 * @param {boolean} [options.tube] Whether a testing creature holds its test tube (default
 *   true). The drawer takes it away while it shows how the tests came out.
 * @param {string | null} [options.daytime] The part of the day (`daytimeOf`): a done or idle
 *   creature keeps its prop. Anything else, or null, adds none.
 * @param {Facing | null} [options.face] The way the creature faces, or null to face out. It
 *   steps a cell that way with all it draws, and to a side its open or glancing eyes look
 *   that way; happy and closed eyes are a status's cue and stay.
 * @param {boolean} [options.ride] Whether the creature rides (default false): it sways from
 *   side to side with all it draws, two thirds of a cell each way, as a rider on a bus does.
 * @param {boolean} [options.doze] Whether the creature dozes, as the drawer has it while its
 *   window is away (default false). A working or done creature rests as idle does, at stage
 *   0; an idle one keeps its stage; a blocked one keeps burning. A turn still plays.
 * @returns {Element} GRID * px square.
 */
export function spriteElement(sprite, { id, px: u = 3, status = null, work = null, hit = null, turn = null, stage: held = 0, tube = true, daytime = null, face = null, ride = false, doze = false } = /** @type {any} */ ({})) {
  if (typeof id !== "string" || !id) throw new TypeError("spriteElement needs an id");
  const size = GRID * u;
  const { body, feet, eyes } = sprite.parts;
  const nudge = Math.max(1, Math.round(u / 3)); // a sub-cell move, at least one pixel
  // A turn takes the status's place until it is over: only a name of TURNS' own is one.
  const shot = turn && typeof turn.kind === "string" && Object.hasOwn(TURNS, turn.kind) ? TURNS[turn.kind] : null;
  // Dozing, it rests as idle does. A blocked one keeps burning: the person needs to see it
  // most while they are away. A doze is a nap's start, so a long work's stage is no dust.
  const dozing = doze === true && (status === "working" || status === "done");
  const look = shot ? null : dozing ? "idle" : status;
  const stage = dozing ? 0 : held;
  // To a side, the eyes glance that way: "look", or "look" mirrored when it glances the other
  // way (pip eyes glance left). Facing up or down keeps the eyes.
  const step = face ? STEP[face] : null;
  const side = step?.[0] ? (glance(eyes) * step[0] < 0 ? mirrored(eyes.look) : eyes.look) : null;
  /** @type {(mood: Mood) => Rect[]} */
  const gaze = (mood) => (side && (mood === "open" || mood === "look") ? side : eyes[mood]);
  // A label anyone can set picks it, so only a name of WORK's own counts ("__proto__" doesn't).
  const how = look === "working" ? WORK[typeof work === "string" && Object.hasOwn(WORK, work) ? work : ownWork(sprite)] : null;
  // A turn's eyes can change by step; a step it leaves out has open eyes.
  const turnEyes = !shot ? null : typeof shot.eyes === "string" ? shot.eyes : Object.hasOwn(shot.eyes, turn.step) ? shot.eyes[turn.step] : "open";

  const left = layer(feet[0], u);
  const right = layer(feet[1], u);
  const torso = div().absolute().left(0).top(0).size(size)
    .child(layer(body, u))
    .child(layer(gaze(how?.eyes ?? turnEyes ?? EYES[look] ?? "open"), u));
  const figure = div().absolute().left(0).top(0).size(size);

  // Working, the way of working moves the parts and draws its own marks; a turn, the same.
  /** @type {Parts} */
  const parts = { u, size, nudge, t: /** @type {Theme} */ (theme()), sprite, gaze, left, right, torso, tube };
  // A long work tires the creature, beside its way: sweat in the torso over the body, before
  // the way builds, so any prop it holds passes in front of it, and a cup beneath the way's
  // own marks, so eyes a prop draws again stay on top.
  const tired = how ? fatigue(parts, how.cup, stage) : null;
  for (const drop of tired?.sweat ?? []) torso.child(drop);
  const worked = shot ? shot.build({ ...parts, id: `${id}-${turn.kind}-${turn.n}`, step: turn.step }) : how?.build(parts);
  if (tired && worked) worked.front.unshift(...tired.cup);
  if (look === "done" && !(stage >= 1)) {
    // The hop, until it calms down; then it stands still on its feet.
    figure.loop("top", { from: 0, to: -u, period: 700, easing: "ease-out" });
  } else if (look === "idle") {
    // The fidget rides in the torso, so it breathes and dims with the body.
    torso.loop("top", { from: 0, to: nudge, period: 2600 }).child(fidgeting(sprite, parts));
    // Dimmed, and greyer still once the dust gathers.
    figure.opacity(stage >= 2 ? 0.5 : 0.75);
  }
  figure.child(left).child(right).child(torso);

  const { behind, front } = worked ?? accents(look, u, stage);
  // At rest, the time of day's prop. Working, a way's own props fill its corner; blocked, the fire does.
  const resting = look === "done" || look === "idle";
  const day = resting && typeof daytime === "string" && Object.hasOwn(DAYTIME, daytime) ? DAYTIME[/** @type {Daytime} */ (daytime)](u, nudge) : null;
  if (day) {
    behind.push(...day.behind);
    front.push(...day.front);
  }
  const drawn = [...behind, hit ? struck(figure, sprite, id, u, hit) : figure, ...front];
  // Facing a way, all of it steps as one, so every prop and mark keeps its place on the creature.
  // The step snaps, as a pixel creature turns round: no id, no transition.
  const shown = step ? [div().absolute().left(step[0] * u).top(step[1] * u).size(size).children(drawn)] : drawn;
  // Riding, it all sways as one around where it stands, facing a way or not. The sway has an
  // id of its own, so it runs on through every draw while the ride lasts.
  const sway = Math.max(1, Math.round((2 * u) / 3));
  const ridden = ride ? [div().id(`${id}-ride`).absolute().left(0).top(0).size(size).loop("left", { from: -sway, to: sway, period: RIDE_MS }).children(shown)] : shown;
  return div().id(id).relative().size(size).flex_none().children(ridden);
}

/** @typedef {"front" | "left" | "back" | "right"} Face A side the creature is seen from. */

/**
 * The creature still, seen from one side, as rectangles in px in its GRID * px square: from
 * the front in its open eyes, from the back with none, and turned to its left or its right
 * edge-on, a third as wide and centered, with only the eye on that side showing.
 * @param {Sprite} sprite
 * @param {Face} face
 * @param {number} [u] Pixels per cell (default 3).
 * @returns {{ x: number, y: number, w: number, h: number, color: Color }[]}
 */
export function faceRects({ parts: { body, feet, eyes } }, face, u = 3) {
  const edge = face === "left" || face === "right";
  const near = eyes.open.filter((r) => (face === "left" ? r.x < GRID / 2 : r.x >= GRID / 2));
  const rects = [...body, ...feet[0], ...feet[1], ...(face === "front" ? eyes.open : edge ? near : [])];
  const across = edge ? u / 3 : u;
  const x0 = (GRID * (u - across)) / 2;
  return rects.map((r) => ({ x: x0 + r.x * across, y: r.y * u, w: r.w * across, h: r.h * u, color: r.color }));
}

/**
 * The figure taking a hit: knocked out of place under a flash of its silhouette.
 * The ids carry the hit's number, so a new hit starts over rather than easing from the last.
 * @param {Element} figure
 * @param {Sprite} sprite
 * @param {string} id
 * @param {number} u
 * @param {SpriteHit} hit
 * @returns {Element}
 */
function struck(figure, sprite, id, u, hit) {
  const { body, feet } = sprite.parts;
  const color = hit.damage ? HIT.removed : HIT.added;
  const { flash: strength, fade } = STRIKE[hit.size ?? "hit"];
  const knock = hit.size === "tick" ? Math.max(1, Math.round(u / 3)) : u; // a tick nudges by a sub-cell
  const flash = layer([...body, ...feet[0], ...feet[1]].map((r) => ({ ...r, color })), u)
    .id(`${id}-flash-${hit.n}`)
    .opacity(hit.live ? strength : 0)
    .transition("opacity", { duration: fade, easing: "ease-out" });
  return div()
    .id(`${id}-knock-${hit.n}`)
    .absolute()
    .left(hit.live && hit.damage ? -knock : 0)
    .top(hit.live && !hit.damage ? -knock : 0)
    .size(GRID * u)
    .transition("left", { duration: 220, easing: "ease-out" })
    .transition("top", { duration: 220, easing: "ease-out" })
    .child(figure)
    .child(flash);
}
