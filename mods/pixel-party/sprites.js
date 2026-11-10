// Seed to sprite: a small symmetric pixel creature. Pure: no imports, runs under plain node.
// Contract: docs/DESIGN.md, "Contract: sprites.js".
//
// A creature is drawn on a GRID by GRID board, art only in the inner 10 by 10 cells. The
// left half (columns 1..5) is built from an archetype plus features, then mirrored onto
// columns 6..10 (x -> 11 - x). Every mask cell next to an empty cell becomes outline; the
// interior gets a three-tone ramp. Eyes are drawn by `sprite-view.js` from the variants here.
//
// Sprite shape, read only by sprite-view.js:
//   { seed, grid, kind, top,
//     parts: { body: Rect[], feet: [Rect[], Rect[]],
//              eyes: { open: Rect[], look: Rect[], closed: Rect[], happy: Rect[] } } }
// Rect is { x, y, w, h, color } in cells. `feet[0]` is the creature's left foot (screen
// left), `feet[1]` the right one. `top` is the first row with art.

/** @typedef {`#${string}`} Hex A `#rrggbb` color. */
/** @typedef {{ x: number, y: number, w: number, h: number, color: Hex }} Rect In cells. */
/** @typedef {"open" | "look" | "closed" | "happy"} Mood */
/**
 * @typedef {object} Sprite
 * @property {string} seed
 * @property {number} grid
 * @property {string} kind The archetype, e.g. "blob".
 * @property {number} top The first row with art.
 * @property {{ body: Rect[], feet: [Rect[], Rect[]], eyes: Record<Mood, Rect[]> }} parts
 */
/** @typedef {() => number} Rng Returns a number in [0, 1), like `Math.random`. */

export const GRID = 12;
const MID = 5; // last column of the left half
const MAX_RECTS = 96;

/**
 * FNV-1a over the seed's string form, then a final avalanche.
 * @param {unknown} seed
 * @returns {number} An unsigned 32-bit hash.
 */
export function hashSeed(seed) {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // Final avalanche so seeds that differ in one character land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A seeded generator (mulberry32): the same seed gives the same sequence.
 * @param {number} a
 * @returns {Rng}
 */
function rng(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Six characters from `a-z0-9`: a seed a label can hold.
 * @param {Rng} [rand]
 * @returns {string}
 */
export function randomSeed(rand = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.min(35, Math.floor(rand() * 36))];
  return s;
}

/** @typedef {[outline: Hex, shade: Hex, base: Hex, light: Hex]} Ramp */

// Ramps run dark (outline) to light: [outline, shade, base, light].
/** @type {Ramp[]} */
const RAMPS = [
  ["#4a1a24", "#b8404c", "#e8665c", "#ffa892"], // tomato
  ["#4d2410", "#c4622d", "#f2954b", "#ffd08a"], // tangerine
  ["#4a3a12", "#c79a26", "#f5cf48", "#fff2a6"], // lemon
  ["#223d14", "#5c9c2e", "#94d04a", "#d4f59a"], // lime
  ["#103b30", "#2c8c6a", "#4ccf9c", "#b4f4d6"], // mint
  ["#0e3540", "#22808e", "#3ec0c8", "#a6eef0"], // teal
  ["#172a52", "#3768c4", "#5aa2f0", "#b6dcff"], // sky
  ["#231a4d", "#5146b0", "#7e74e8", "#c4bdff"], // iris
  ["#3a1848", "#8a3fa6", "#c070dd", "#ecc0ff"], // grape
  ["#4d1736", "#c2457f", "#f27eb4", "#ffc8e2"], // bubblegum
  ["#2e1c12", "#7a4a2c", "#b07a4c", "#e6c08e"], // cocoa
  ["#1f2430", "#5b6578", "#93a0b4", "#d8e0ea"], // steel
  ["#2a2a46", "#9298c4", "#d8ddf2", "#ffffff"], // pearl
  ["#4a2620", "#d07a62", "#f7b096", "#ffe0d2"], // peach
  ["#3b2a10", "#9a7a2a", "#cfb455", "#f2e6a0"], // olive gold
  ["#3d1020", "#94304e", "#d65a7a", "#f7a8bc"], // berry
];

const INK = "#16141f";
const WHITE = "#ffffff";
const BLUSH = "#ff8fa8";

/**
 * @template T
 * @param {Rng} r
 * @param {readonly T[]} list
 * @returns {T}
 */
const pick = (r, list) => list[Math.floor(r() * list.length)];
/** @type {(r: Rng, p: number) => boolean} */
const chance = (r, p) => r() < p;

// ---- the left half ----
// A board of labels, GRID by GRID, only columns 0..MID written; mirrored later.

/**
 * What a cell of the board is: "b" body, "f" foot, the rest accents and features.
 * @typedef {"b" | "f" | "acc" | "ear" | "horn" | "tip" | "stalk" | "leaf" | "hat" | "cap" | "beak"} Label
 */
/** @typedef {(Label | null)[][]} Board Rows of labels, indexed `b[y][x]`. */
/** @typedef {(Hex | null)[][]} Colors Rows of colors, indexed `colors[y][x]`. */

/** @returns {any[][]} GRID rows of GRID nulls: an empty {@link Board} or {@link Colors}. */
function board() {
  return Array.from({ length: GRID }, () => Array(GRID).fill(null));
}

/**
 * Fills columns x0..MID (the span to the center) of row y with a label.
 * @param {Board} b
 * @param {number} y
 * @param {number} x0
 * @param {Label} [label]
 * @param {number} [x1] The last column, if short of the center.
 */
function span(b, y, x0, label = "b", x1 = MID) {
  if (y < 1 || y > 10) return;
  for (let x = Math.max(1, x0); x <= Math.min(MID, x1); x++) b[y][x] = label;
}

/** @type {(b: Board, x: number, y: number, label: Label | null) => void} */
const put = (b, x, y, label) => {
  if (x >= 1 && x <= MID && y >= 1 && y <= 10) b[y][x] = label;
};

/**
 * Where an archetype put things; see ARCHETYPES.
 * @typedef {object} Anatomy
 * @property {number} top
 * @property {number} eyeY
 * @property {number} eyeX
 * @property {boolean} [square] Robot head: square eyes only.
 * @property {boolean} [cap] Mushroom cap: no features on top.
 * @property {boolean} [narrow] Too narrow for two eye boxes.
 * @property {boolean} [beak]
 */

// Each archetype fills the left half and returns where things go:
// top (first body row), eyeY (top row of the 2-tall eye box), eyeX (left column of the left
// eye box), and whether it has room for features above `top`.
/** @type {Record<string, (b: Board, r: Rng) => Anatomy>} */
const ARCHETYPES = {
  blob(b, r) {
    const top = pick(r, [3, 4, 4, 5]);
    const wide = chance(r, 0.6) ? 1 : 2;
    span(b, top, wide === 1 ? 3 : 4);
    span(b, top + 1, wide + 1);
    for (let y = top + 2; y <= 8; y++) span(b, y, wide);
    span(b, 9, wide + 1);
    const foot = pick(r, [2, 3]);
    span(b, 10, foot, "f", foot + 1);
    return { top, eyeY: top + 2, eyeX: wide === 1 ? pick(r, [2, 3, 3]) : 3 };
  },
  biped(b, r) {
    const top = pick(r, [2, 3, 3]);
    const head = top + 3; // last head row
    span(b, top, 3);
    for (let y = top + 1; y <= head; y++) span(b, y, chance(r, 0.5) && y === top + 1 ? 2 : 2);
    span(b, head, 2);
    if (chance(r, 0.4)) put(b, 1, top + 2, "b"); // cheek puff
    for (let y = head + 1; y <= 8; y++) span(b, y, 3);
    // arms
    span(b, head + 1, 1, "b", 2);
    if (head + 2 <= 8) put(b, 1, head + 2, "b");
    const leg = pick(r, [3, 4]);
    span(b, 9, leg, "f", leg === 3 ? 4 : 4);
    span(b, 10, leg === 3 ? 2 : 3, "f", 4);
    return { top, eyeY: top + 1, eyeX: 3 };
  },
  ghost(b, r) {
    const top = pick(r, [2, 3, 3, 4]);
    span(b, top, 3);
    span(b, top + 1, 2);
    for (let y = top + 2; y <= 9; y++) span(b, y, top + 2 >= 5 ? 2 : 1);
    if (top <= 3) put(b, 1, top + 2, null);
    // little arms
    if (chance(r, 0.5)) put(b, 1, 7, "b");
    // fringe: the "feet"
    const style = pick(r, [0, 1]);
    if (style === 0) {
      put(b, 1, 10, "f");
      put(b, 2, 10, "f");
      put(b, 4, 10, "f");
      put(b, 5, 10, "f");
    } else {
      put(b, 2, 10, "f");
      put(b, 3, 10, "f");
      put(b, 5, 10, "f");
    }
    return { top, eyeY: top + 2, eyeX: 3 };
  },
  robot(b, r) {
    const top = pick(r, [2, 3]);
    const head = top + 3;
    for (let y = top; y <= head; y++) span(b, y, 2);
    if (chance(r, 0.5)) {
      put(b, 1, top + 1, "acc"); // ear bolts
      put(b, 1, top + 2, "acc");
    }
    const bodyX = pick(r, [2, 3]);
    for (let y = head + 1; y <= 9; y++) span(b, y, bodyX);
    put(b, bodyX - 1, head + 2, "b"); // arm
    if (bodyX === 3) put(b, 1, head + 2, "b");
    span(b, 10, 2, "f", 3);
    return { top, eyeY: top + 1, eyeX: 3, square: true };
  },
  critter(b, r) {
    const top = pick(r, [4, 4, 5]);
    span(b, top, 2);
    for (let y = top + 1; y <= 8; y++) span(b, y, 1);
    span(b, 9, 2, "b", 4);
    span(b, 9, 5);
    put(b, 2, 10, "f");
    put(b, 4, 10, "f");
    return { top, eyeY: top + 1, eyeX: 2 };
  },
  shroom(b, r) {
    const top = pick(r, [2, 3]);
    span(b, top, 3, "cap");
    span(b, top + 1, 2, "cap");
    span(b, top + 2, 1, "cap");
    span(b, top + 3, 1, "cap");
    for (let y = top + 4; y <= 9; y++) span(b, y, 3);
    span(b, 10, 3, "f", 4);
    return { top, eyeY: top + 4, eyeX: 4, cap: true, narrow: true };
  },
  slime(b, r) {
    const top = pick(r, [3, 4, 4]);
    span(b, top, 4);
    span(b, top + 1, 3);
    span(b, top + 2, 2);
    for (let y = top + 3; y <= 9; y++) span(b, y, 1);
    // the base spreads; it is the slime's "feet"
    span(b, 10, 2, "f", 3);
    put(b, 5, 10, "f");
    return { top, eyeY: top + 2, eyeX: 3 };
  },
  squid(b, r) {
    const top = pick(r, [2, 3]);
    span(b, top, 3);
    span(b, top + 1, 2);
    for (let y = top + 2; y <= top + 4; y++) span(b, y, 2);
    span(b, top + 5, 2);
    for (let y = top + 6; y <= 9; y++) {
      put(b, 2, y, "b");
      put(b, 4, y, "b");
    }
    if (top + 6 <= 9) put(b, 3, top + 6, "b");
    put(b, 2, 10, "f");
    put(b, 4, 10, "f");
    return { top, eyeY: top + 2, eyeX: 3 };
  },
  tall(b, r) {
    const top = pick(r, [2, 3]);
    span(b, top, 4);
    for (let y = top + 1; y <= 8; y++) span(b, y, 3);
    span(b, top + 4, 2); // arms
    put(b, 2, top + 5, "b");
    span(b, 9, 4);
    span(b, 10, 3, "f", 4);
    return { top, eyeY: top + 1, eyeX: 4, narrow: true };
  },
  bird(b, r) {
    const top = pick(r, [3, 3, 4]);
    span(b, top, 3);
    for (let y = top + 1; y <= 8; y++) span(b, y, 2);
    // wings
    for (let y = top + 3; y <= 7; y++) put(b, 1, y, "b");
    span(b, 9, 3);
    put(b, 3, 10, "f");
    put(b, 4, 10, "f");
    return { top, eyeY: top + 1, eyeX: 3, beak: true };
  },
};

const KINDS = Object.keys(ARCHETYPES);

// Features above the body. Each takes the board, the body's top row, the leftmost column
// of that row (so a feature always stands on the head), and the rng.
/** @type {(r: Rng, lo: number, hi: number) => number} An integer in lo..hi, or lo when hi < lo. */
const from = (r, lo, hi) => lo + Math.floor(r() * (Math.max(lo, hi) - lo + 1));
/** @type {Record<string, (b: Board, top: number, hx: number, r: Rng) => void>} */
const FEATURES = {
  ears(b, top, hx, r) {
    const x = from(r, Math.max(2, hx - 1), 3);
    put(b, x, top - 1, "b");
    put(b, x, top - 2, "b");
    put(b, x + 1, top - 1, "ear");
  },
  horns(b, top, hx, r) {
    const x = from(r, Math.max(2, hx - 1), 3);
    put(b, x + 1, top - 1, "horn");
    put(b, x, top - 1, "horn");
    put(b, x, top - 2, "tip");
  },
  antenna(b, top, hx, r) {
    const x = from(r, Math.max(3, hx), 5);
    put(b, x, top - 1, "stalk");
    put(b, x, top - 2, "tip");
  },
  hat(b, top) {
    span(b, top - 1, 2, "hat");
    span(b, top - 2, 3, "hat");
    span(b, top - 3, 3, "hat");
  },
  sprout(b, top) {
    put(b, 5, top - 1, "stalk");
    put(b, 5, top - 2, "leaf");
    put(b, 4, top - 2, "leaf");
  },
};

/**
 * The features that fit above a body starting at `top`.
 * @param {Rng} r
 * @param {Anatomy} info
 * @param {string} kind
 * @returns {string | null} A FEATURES key, or null for none.
 */
function featureFor(r, info, kind) {
  const room = info.top - 1; // rows above the body
  if (info.cap) return null;
  const options = [];
  if (room >= 2) options.push("ears", "horns", "antenna", "sprout", "antenna");
  if (room >= 3 && kind !== "ghost") options.push("hat");
  if (kind === "robot" && room >= 2) options.push("antenna", "antenna");
  if (options.length === 0 || chance(r, 0.15)) return null;
  return pick(r, options);
}

// ---- mirrored board, outline and tones ----

/** @param {Board} b Copies columns 1..MID onto their mirror columns, in place. */
function mirror(b) {
  for (let y = 0; y < GRID; y++) for (let x = 1; x <= MID; x++) b[y][GRID - 1 - x] = b[y][x];
}

/** @type {(b: Board, x: number, y: number) => boolean} Whether the cell is on the board and has art. */
const inMask = (b, x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && b[y][x] !== null;
/** @type {(b: Board, x: number, y: number) => boolean} Whether a side of the cell has no art: an outline cell. */
const isEdge = (b, x, y) => !inMask(b, x - 1, y) || !inMask(b, x + 1, y) || !inMask(b, x, y - 1) || !inMask(b, x, y + 1);

/**
 * Colors every labeled cell: outline, the body ramp and its pattern, accents from `acc`.
 * @param {Board} b The mirrored board.
 * @param {Anatomy} info
 * @param {Rng} r
 * @param {Ramp} ramp The body's colors.
 * @param {Ramp} acc The accents' colors.
 * @returns {Colors}
 */
function paint(b, info, r, ramp, acc) {
  const colors = board();
  const [dark, shade, base, light] = ramp;
  const pattern = pick(r, ["plain", "plain", "belly", "belly", "stripes", "spots", "mask"]);
  const glossy = chance(r, 0.7);
  const capDots = info.cap && chance(r, 0.8);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const label = b[y][x];
      if (label === null) continue;
      const edge = isEdge(b, x, y);
      const half = x <= MID ? x : GRID - 1 - x; // 1..5, 5 is beside the center line
      /** @type {Hex} */
      let c;
      switch (label) {
        case "f":
          c = edge ? dark : shade;
          break;
        case "horn":
          c = acc[3];
          break;
        case "tip":
          c = acc[2];
          break;
        case "stalk":
          c = shade;
          break;
        case "acc":
          c = acc[1];
          break;
        case "ear":
          c = BLUSH;
          break;
        case "leaf":
          c = half === 5 ? "#7bd04e" : "#4a9a35";
          break;
        case "hat": {
          // Too thin for an outline: a dark crown, a light band, a mid brim, dark ends.
          const end = !inMask(b, x - 1, y) || !inMask(b, x + 1, y);
          c = end ? acc[0] : y === info.top - 2 ? acc[3] : acc[1];
          break;
        }
        case "cap": {
          const cr = acc;
          if (edge) c = cr[0];
          else if (capDots && ((half + y) % 3 === 0)) c = WHITE;
          else c = !inMask(b, x, y - 1) || isEdge(b, x, y - 1) ? cr[3] : cr[2];
          if (!edge && b[y + 1]?.[x] !== "cap") c = cr[1];
          break;
        }
        default: {
          if (edge) {
            c = dark;
            break;
          }
          const below = isEdge(b, x, y + 1) || !inMask(b, x, y + 1);
          const above = isEdge(b, x, y - 1);
          c = below ? shade : glossy && above ? light : base;
          if (pattern === "belly" && half >= 4 && y >= info.eyeY + 3 && !below) c = light;
          if (pattern === "stripes" && half <= 3 && y > info.eyeY + 2 && y % 2 === 0) c = shade;
          if (pattern === "spots" && y > info.eyeY + 2 && (half * 3 + y) % 5 === 0) c = light;
          if (pattern === "mask" && y >= info.eyeY - 1 && y <= info.eyeY + 2 && half >= info.eyeX - 1) c = shade;
        }
      }
      colors[y][x] = c;
    }
  }
  return colors;
}

// ---- rectangles ----

/**
 * Merges runs of equal cells into rectangles: rows first, then equal runs downward.
 * @param {Colors} colors
 * @param {(x: number, y: number) => boolean} [keep] Which cells to include; all by default.
 * @returns {Rect[]}
 */
function rects(colors, keep = () => true) {
  /** @type {Map<string, Rect>} */
  const open = new Map(); // "x,w,color" -> rect still growing downward
  /** @type {Rect[]} */
  const out = [];
  for (let y = 0; y < GRID; y++) {
    const runs = [];
    for (let x = 0; x < GRID; ) {
      const c = colors[y][x];
      if (c === null || !keep(x, y)) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < GRID && colors[y][x + w] === c && keep(x + w, y)) w++;
      runs.push(`${x},${w},${c}`);
      x += w;
    }
    const next = new Map();
    for (const key of runs) {
      const grow = open.get(key);
      if (grow && grow.y + grow.h === y) {
        grow.h++;
        next.set(key, grow);
      } else {
        const [x, w, color] = key.split(",");
        const rect = { x: Number(x), y, w: Number(w), h: 1, color: /** @type {Hex} */ (color) };
        out.push(rect);
        next.set(key, rect);
      }
    }
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  return out;
}

// ---- eyes ----
// Each eye style draws a 2 by 2 box per eye. The left box's columns are eyeX (dx 0, the
// outer one) and eyeX + 1 (dx 1, the inner one); the right eye mirrors it. Cells are
// [dx, dy, color]. Moods: open (still), look (both eyes glance to screen right: the
// left eye's open pattern copied, not mirrored, into the right box), closed (a lid line)
// and happy (a ^ caret one cell wider than the box, reaching outward).

/** @typedef {[dx: number, dy: number, color: Hex]} EyeCell */

/** @type {EyeCell[]} */
const CLOSED = [[0, 1, INK], [1, 1, INK]];
/** @type {EyeCell[]} */
const HAPPY = [[-1, 1, INK], [0, 0, INK], [1, 1, INK]];
/** @type {Record<string, EyeCell[]>} */
const EYES = {
  round: [[0, 0, WHITE], [1, 0, WHITE], [0, 1, WHITE], [1, 1, INK]], // white, pupil inner bottom
  bead: [[1, 0, INK], [1, 1, INK]], // a tall dark bead on the inner column
  pip: [[0, 0, INK], [0, 1, INK]], // a bead on the outer column, for heads too narrow for two boxes
  big: [[0, 0, WHITE], [1, 0, INK], [0, 1, INK], [1, 1, INK]], // dark, glint outer top
};

/**
 * Both eyes in one mood, as rectangles.
 * @param {string} style An EYES key.
 * @param {Mood} mood
 * @param {number} eyeX The left eye box's left column.
 * @param {number} eyeY The eye boxes' top row.
 * @returns {Rect[]}
 */
function eyeRects(style, mood, eyeX, eyeY) {
  const cells = mood === "closed" ? CLOSED : mood === "happy" ? HAPPY : EYES[style];
  const out = [];
  for (const [dx, dy, color] of cells) {
    const y = eyeY + dy;
    const right = mood === "look" ? GRID - 2 - eyeX + dx : GRID - 1 - eyeX - dx;
    out.push({ x: eyeX + dx, y, w: 1, h: 1, color }, { x: right, y, w: 1, h: 1, color });
  }
  return mergeCells(out);
}

/**
 * @param {Rect[]} cells One-cell rectangles.
 * @returns {Rect[]} The same cells, equal neighbors merged.
 */
function mergeCells(cells) {
  const colors = board();
  for (const c of cells) colors[c.y][c.x] = c.color;
  return rects(colors);
}

// ---- the creature ----

/**
 * @param {string} seed
 * @param {boolean} simple Leaves out the feature, mouth and blush: fewer rectangles.
 * @returns {Sprite}
 */
function build(seed, simple) {
  const r = rng(hashSeed(seed));
  const kind = KINDS[Math.floor(r() * KINDS.length)];
  const b = board();
  const info = ARCHETYPES[kind](b, r);
  const feature = simple ? null : featureFor(r, info, kind);
  if (feature) FEATURES[feature](b, info.top, b[info.top].findIndex((c, x) => x >= 1 && c !== null), r);
  if (info.beak) put(b, MID, info.eyeY + 2, "beak");
  mirror(b);

  const ramp = pick(r, RAMPS);
  let acc = pick(r, RAMPS);
  if (acc === ramp) acc = RAMPS[(RAMPS.indexOf(ramp) + 5) % RAMPS.length];
  const colors = paint(b, info, r, ramp, acc);

  // Face extras, painted symmetrically onto interior body cells only.
  /** @type {(x: number, y: number) => boolean} */
  const skin = (x, y) => y >= 1 && y <= 10 && ["b", "beak"].includes(b[y][x]) && !isEdge(b, x, y);
  /**
   * Paints the cells and their mirrors, only if all of them are skin.
   * @param {[x: number, y: number][]} cells
   * @param {Hex} color
   * @returns {boolean} Whether it painted.
   */
  const dab = (cells, color) => {
    if (!cells.every(([x, y]) => skin(x, y) && skin(GRID - 1 - x, y))) return false;
    for (const [x, y] of cells) colors[y][x] = colors[y][GRID - 1 - x] = color;
    return true;
  };
  const my = info.eyeY + 2;
  if (info.beak) dab([[MID, my]], acc[2]);
  else if (!simple && chance(r, 0.6)) {
    const mouth = pick(r, ["small", "smile", "smile", "teeth"]);
    if (mouth === "smile") dab([[MID - 1, my], [MID, my + 1]], INK) || dab([[MID, my]], INK);
    else if (mouth === "teeth") dab([[MID - 1, my], [MID, my]], INK) && dab([[MID, my + 1]], WHITE);
    else dab([[MID, my]], INK);
  }
  if (!simple && chance(r, 0.35)) dab([[info.eyeX - 1, my - 1]], BLUSH) || dab([[info.eyeX - 1, my]], BLUSH);

  /** @type {(x: number, y: number) => boolean} */
  const isFoot = (x, y) => b[y][x] === "f";
  const body = rects(colors, (x, y) => !isFoot(x, y));
  /** @type {[Rect[], Rect[]]} */
  const feet = [
    rects(colors, (x, y) => isFoot(x, y) && x <= MID),
    rects(colors, (x, y) => isFoot(x, y) && x > MID),
  ];
  const style = info.narrow ? "pip" : info.square ? pick(r, ["round", "big"]) : pick(r, ["round", "round", "bead", "big"]);
  const eyes = /** @type {Record<Mood, Rect[]>} */ ({});
  for (const mood of /** @type {Mood[]} */ (["open", "look", "closed", "happy"])) eyes[mood] = eyeRects(style, mood, info.eyeX, info.eyeY);

  let top = GRID;
  for (let y = 0; y < GRID && top === GRID; y++) if (b[y].some((c) => c !== null)) top = y;
  return { seed: String(seed), grid: GRID, kind, top, parts: { body, feet, eyes } };
}

/**
 * Rectangles drawn at once in the busiest pose: body, feet and the largest eye mood.
 * @param {Sprite} sprite
 * @returns {number}
 */
export function rectCount(sprite) {
  const { body, feet, eyes } = sprite.parts;
  return body.length + feet[0].length + feet[1].length + Math.max(...Object.values(eyes).map((e) => e.length));
}

/**
 * The creature for a seed: the same one every time. A creature that would draw more than
 * MAX_RECTS rectangles is made again without its extras.
 * @param {unknown} seed Any value; its string form is used, and null or undefined as "".
 * @returns {Sprite}
 */
export function makeSprite(seed) {
  const s = typeof seed === "string" ? seed : String(seed ?? "");
  const sprite = build(s, false);
  return rectCount(sprite) <= MAX_RECTS ? sprite : build(s, true);
}
