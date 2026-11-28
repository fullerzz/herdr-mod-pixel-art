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
//            creature's own way of working, picked by its seed. See WORK below.
//   blocked  open eyes, still, on fire: a bed of flames at its feet, tongues licking up its
//            sides, and a blinking "!" badge in the top right corner
//   done     happy ^ ^ eyes, hops, two sparkles twinkle in turn
//   idle     closed eyes, dimmed, breathes slowly, a fading "z"
//
// A hit (lines its agent added or removed) adds, on top of any status, a flash of the
// creature's silhouette and a knock: up for added lines, sideways for removed ones. Both
// start at full strength and ease back with `.transition`, so the caller renders a hit
// twice: `live` first, then settled.

import { div } from "gpui-kit";
import { theme } from "herdr";
import { GRID, hashSeed } from "./sprites.js";

/** @import { Color, Element } from "gpui-kit" */
/** @import { Status } from "herdr" */
/** @import { Mood, Rect, Sprite } from "./sprites.js" */

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
 * clock of each agent's status and redraws when the next one is reached. No look uses a
 * stage yet, so every list is empty: a look that changes with time adds its times here.
 * @type {Record<Status, number[]>}
 */
export const STAGES = { working: [], blocked: [], done: [], idle: [] };

/** The colors of hits: added lines heal, removed lines hurt. */
export const HIT = /** @type {const} */ ({ added: "#3ddc6a", removed: "#ff4d5e" });

/**
 * A hit as the sprite shows it.
 * @typedef {object} SpriteHit
 * @property {number} n The hit's number: a new number is a new hit, drawn from the start.
 * @property {boolean} damage Lines were removed: a red flash and a sideways knock.
 * @property {boolean} live Its first frame, at full strength. Settled, it eases back.
 */

/** The colors of a blocked creature's fire, from its edge in to its core. */
export const FIRE = /** @type {const} */ ({ red: "#e5381f", orange: "#ff8c1a", yellow: "#ffd447" });

/**
 * A blocked creature on fire. The bed at its feet holds still, so a single frame shows the
 * fire; the tongues flicker in turn over it and up both sides. The tall tongues go behind
 * the creature, so they show only where the art leaves room, and lick up by a cell.
 * @param {number} u
 * @returns {{ behind: Element[], front: Element[] }}
 */
function fire(u) {
  /** @type {(cells: Cells, color: Color, from: number, to: number, period: number) => Element} */
  const flicker = (cells, color, from, to, period) => mark(cells, color, u).loop("opacity", { from, to, period });
  /** @type {(el: Element, period: number) => Element} Licks up by a cell and back. */
  const lick = (el, period) => div().absolute().left(0).top(0).size(GRID * u).child(el).loop("top", { from: 0, to: -u, period });
  const bed = [
    mark([[1, 11, 10, 1], [1, 10], [10, 10]], FIRE.red, u),
    mark([[3, 11, 6, 1], [2, 10], [9, 10]], FIRE.orange, u),
    mark([[5, 11, 2, 1]], FIRE.yellow, u),
  ];
  return {
    behind: [
      lick(flicker([[0, 6, 1, 4], [1, 8, 1, 2], [11, 8, 1, 2]], FIRE.red, 1, 0.3, 420), 300),
      lick(flicker([[11, 5, 1, 3], [10, 8, 1, 2], [0, 9]], FIRE.orange, 0.3, 1, 420), 360),
    ],
    front: [
      ...bed,
      flicker([[3, 10], [6, 10], [8, 10]], FIRE.orange, 1, 0.2, 260),
      flicker([[4, 10], [5, 9], [7, 10]], FIRE.yellow, 0.2, 1, 260),
    ],
  };
}

/** @type {(size: number) => Element} An empty full-size layer, to move what it holds as one. */
const full = (size) => div().absolute().left(0).top(0).size(size);
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
 */

/**
 * One way of working: its eyes, and what it moves and draws.
 * @typedef {object} Work
 * @property {Mood} eyes
 * @property {(parts: Parts) => { behind: Element[], front: Element[] }} build
 */

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
    build({ u, nudge, size, t, sprite, torso }) {
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
          ...peek(sprite.parts.eyes.open, u, bob),
        ],
      };
    },
  },
  // Reading files: an open book under the face. A leaf turns across the spine and a
  // highlight runs along a line, while the body sways slowly.
  reading: {
    eyes: "look",
    build({ u, nudge, size, t, sprite, torso }) {
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
      return { behind: [], front: [cover, pages, highlight, text, leafR, leafL, spine, ...peek(sprite.parts.eyes.look, u, bob)] };
    },
  },
  // Running commands: a hammer held up at the top left slams down on an
  // anvil, sparks flick at each blow, and the body dips with it.
  hammering: {
    eyes: "open",
    build({ u, size, nudge, t, sprite, torso }) {
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
      torso.loop("top", { from: 0, to: nudge, ...blow }).child(hammer).child(layer(sprite.parts.eyes.open, u));
      const anvil = mark([[0, 10, 3, 1], [1, 11]], t.dim, u);
      const sparks = mark([[2, 9], [3, 10]], t.working, u).loop("opacity", { from: 0, to: 1, ...blow });
      return { behind: [], front: [anvil, sparks] };
    },
  },
  // Searching code: a lens wanders across the creature, which shows through its tinted
  // glass, and a glint twinkles on it.
  searching: {
    eyes: "look",
    build({ u, size, nudge, t, sprite, torso }) {
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
      torso.child(sweep).child(layer(sprite.parts.eyes.look, u));
      return { behind: [], front: [] };
    },
  },
  // Thinking between tools: a thought bubble in the top left corner, its dots lighting one
  // after another, like "...", and a tail of one or two puffs leading from it to the head,
  // while the creature leans slowly.
  thinking: {
    eyes: "open",
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
  // up and out of it, which the creature watches.
  testing: {
    eyes: "look",
    build({ u, nudge, t, torso }) {
      torso.loop("top", { from: 0, to: -nudge, period: 900 });
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
    build({ u, nudge, size, t, sprite, torso }) {
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
        front: [hold, item, box, flap([[1, 8], [0, 7]], 0, -nudge), flap([[10, 8], [11, 7]], -nudge, 0), ...peek(sprite.parts.eyes.open, u, bob)],
      };
    },
  },
  // Working with git: a twig grows up its left side and branches out over its head, the
  // new branch leafing out a cell at a time.
  git: {
    eyes: "open",
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

/** @type {Partial<Record<Status, Mood>>} */
const EYES = { done: "happy", idle: "closed" };

/**
 * The status's marks, drawn behind or in front of the creature.
 * @param {Status | null} status
 * @param {number} u
 * @returns {{ behind: Element[], front: Element[] }}
 */
function accents(status, u) {
  const t = /** @type {Theme} */ (theme());
  switch (status) {
    case "blocked": {
      // A badge over the top right corner: a theme-colored tile with a white "!". It goes
      // over the fire, which keeps its own colors: the badge carries the theme's cue.
      const badge = div().absolute().left(9 * u).top(0).w(3 * u).h(5 * u).rounded(u).bg(t.blocked)
        .child(div().absolute().left(u).top(Math.round(u / 2)).w(u).h(2 * u).bg("#ffffff"))
        .child(div().absolute().left(u).top(Math.round(3.25 * u)).w(u).h(u).bg("#ffffff"));
      const { behind, front } = fire(u);
      return { behind, front: [...front, badge.loop("opacity", { from: 1, to: 0.35, period: 800 })] };
    }
    case "done": {
      /** @type {(x: number, y: number) => Cells} A plus sign centered on x, y. */
      const plus = (x, y) => [[x - 1, y, 3, 1], [x, y - 1, 1, 3]];
      const a = mark(plus(1, 1), t.done, u).loop("opacity", { from: 1, to: 0.15, period: 900 });
      const b = mark(plus(10, 3), t.done, u).loop("opacity", { from: 0.15, to: 1, period: 900 });
      return { behind: [a, b], front: [] };
    }
    case "idle": {
      // Behind the creature, so it shows only where the art leaves room.
      const z = mark([[8, 0, 4, 1], [10, 1], [9, 2], [8, 3, 4, 1]], t.idle, u);
      return { behind: [z.loop("opacity", { from: 1, to: 0.3, period: 2600 })], front: [] };
    }
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
 * @param {number} [options.stage] How long the status has held, as the number of its
 *   STAGES reached (default 0, also when its start is unknown). No look uses it yet.
 * @returns {Element} GRID * px square.
 */
export function spriteElement(sprite, { id, px: u = 3, status = null, work = null, hit = null, stage: _stage = 0 } = /** @type {any} */ ({})) {
  if (typeof id !== "string" || !id) throw new TypeError("spriteElement needs an id");
  const size = GRID * u;
  const { body, feet, eyes } = sprite.parts;
  const nudge = Math.max(1, Math.round(u / 3)); // a sub-cell move, at least one pixel
  // A label anyone can set picks it, so only a name of WORK's own counts ("__proto__" doesn't).
  const how = status === "working" ? WORK[typeof work === "string" && Object.hasOwn(WORK, work) ? work : ownWork(sprite)] : null;

  const left = layer(feet[0], u);
  const right = layer(feet[1], u);
  const torso = div().absolute().left(0).top(0).size(size)
    .child(layer(body, u))
    .child(layer(eyes[how?.eyes ?? EYES[status] ?? "open"], u));
  const figure = div().absolute().left(0).top(0).size(size);

  // Working, the way of working moves the parts and draws its own marks.
  const worked = how?.build({ u, size, nudge, t: /** @type {Theme} */ (theme()), sprite, left, right, torso });
  if (status === "done") {
    figure.loop("top", { from: 0, to: -u, period: 700, easing: "ease-out" });
  } else if (status === "idle") {
    torso.loop("top", { from: 0, to: nudge, period: 2600 });
    figure.opacity(0.75);
  }
  figure.child(left).child(right).child(torso);

  const { behind, front } = worked ?? accents(status, u);
  return div().id(id).relative().size(size).flex_none().children([...behind, hit ? struck(figure, sprite, id, u, hit) : figure, ...front]);
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
  const flash = layer([...body, ...feet[0], ...feet[1]].map((r) => ({ ...r, color })), u)
    .id(`${id}-flash-${hit.n}`)
    .opacity(hit.live ? 0.9 : 0)
    .transition("opacity", { duration: 320, easing: "ease-out" });
  return div()
    .id(`${id}-knock-${hit.n}`)
    .absolute()
    .left(hit.live && hit.damage ? -u : 0)
    .top(hit.live && !hit.damage ? -u : 0)
    .size(GRID * u)
    .transition("left", { duration: 220, easing: "ease-out" })
    .transition("top", { duration: 220, easing: "ease-out" })
    .child(figure)
    .child(flash);
}
