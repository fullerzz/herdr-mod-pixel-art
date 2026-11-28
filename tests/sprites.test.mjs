// Sprites: a seed always draws the same creature, inside its box, in hex colors, and the
// view gives every agent status its own look, in a single frame as well as in motion.

import assert from "node:assert/strict";
import { test } from "node:test";
import { theme } from "herdr";
import { div } from "gpui-kit";
import { GRID, hashSeed, makeSprite, randomSeed } from "../mods/pixel-party/sprites.js";
import { CONFETTI, DOUSE, FIDGETS, FIRE, HIT, SMOKE, STAGES, TURNS, WORKS, faceRects, ownFidget, ownWork, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, nodeOf, walk } from "./mocks/gpui.mjs";

const STATUSES = [null, "working", "blocked", "done", "idle"];
const SEEDS = ["", "t1", "t7", "vps/t3", "knight7", "abc123", "-", "a".repeat(200), "🐙 ünïcode", ...Array.from({ length: 64 }, (_, i) => `t${i}`)];
const HEX = /^#[0-9a-f]{6}$/;

const last = (node, name) => calls(node, name).at(-1)?.[0];

/**
 * The still frame of an element drawn at 1 px per cell, as a GRID by GRID board of colors
 * (null where nothing is drawn). Loops are ignored, but for one: this is the pose before
 * motion, so a layer whose opacity swings up from 0 is hidden. With `peak`, every opacity
 * loop is at its far end instead, as at the middle of its period.
 * Fails if anything is drawn outside the box.
 */
function raster(el, { peak = false } = {}) {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  const paint = (child, ox, oy) => {
    const node = nodeOf(child);
    if (!node) return;
    const fade = calls(node, "loop").find(([property]) => property === "opacity")?.[1];
    if (fade && (peak ? fade.to : fade.from) === 0) return;
    const x = ox + (last(node, "left") ?? 0);
    const y = oy + (last(node, "top") ?? 0);
    const bg = last(node, "bg");
    if (bg) {
      const w = last(node, "w") ?? last(node, "size");
      const h = last(node, "h") ?? last(node, "size");
      assert.ok(x >= 0 && y >= 0 && x + w <= GRID && y + h <= GRID, `drawn outside the box at ${x},${y} ${w}x${h}`);
      for (let j = Math.floor(y); j < Math.ceil(y + h); j++) for (let i = Math.floor(x); i < Math.ceil(x + w); i++) board[j][i] = bg;
    }
    for (const c of node.children) paint(c, x, y);
  };
  for (const c of nodeOf(el).children) paint(c, 0, 0);
  return board;
}

const still = (seed, status = null) => raster(spriteElement(makeSprite(seed), { id: "s", px: 1, status }));
const pixels = (el) => walk(el).filter((node) => calls(node, "bg").length > 0);

test("the same seed draws the same sprite", () => {
  for (const seed of SEEDS) {
    assert.deepEqual(makeSprite(seed), makeSprite(seed));
    assert.deepEqual(still(seed), still(seed));
  }
});

test("hashSeed is a uint32 that is stable across runs", () => {
  for (const seed of SEEDS) {
    const h = hashSeed(seed);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
  assert.equal(hashSeed("t1"), hashSeed("t1"));
  assert.equal(hashSeed("knight7"), 2670120491);
  assert.notEqual(hashSeed("t1"), hashSeed("t2"));
});

test("any string is a seed, including an address, the empty string and odd text", () => {
  for (const seed of ["", "vps/t3", "t12", "machine-a/t999", " ", "\n", "a".repeat(1000), "🐙"]) {
    const sprite = makeSprite(seed);
    for (const status of STATUSES) check(spriteElement(sprite, { id: "x", status }));
  }
});

test("art stays in the inner 10 by 10 cells and leaves the outer ring empty", () => {
  for (const seed of SEEDS) {
    const board = still(seed);
    for (let i = 0; i < GRID; i++) {
      for (const [x, y] of [[i, 0], [i, GRID - 1], [0, i], [GRID - 1, i]]) {
        assert.equal(board[y][x], null, `seed ${JSON.stringify(seed)} draws on the ring at ${x},${y}`);
      }
    }
  }
});

test("every color in every status is a #rrggbb literal", () => {
  for (const seed of SEEDS) {
    for (const status of STATUSES) {
      for (const node of pixels(spriteElement(makeSprite(seed), { id: "s", status }))) {
        assert.match(last(node, "bg"), /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
    for (const row of still(seed)) for (const c of row) if (c) assert.match(c, HEX);
  }
});

test("a sprite draws with at most 96 rectangles, runs merged", () => {
  for (const seed of [...SEEDS, ...Array.from({ length: 300 }, (_, i) => `s${i}`)]) {
    const el = spriteElement(makeSprite(seed), { id: "s", px: 1 });
    const rects = pixels(el);
    assert.ok(rects.length <= 96, `seed ${seed}: ${rects.length} rectangles`);
    const cells = still(seed).flat().filter(Boolean).length;
    assert.ok(rects.length < cells, `seed ${seed}: no runs were merged`);
  }
});

test("a sprite is a creature: symmetric, one connected body, an outline, two tones and eyes", () => {
  for (const seed of SEEDS) {
    const board = still(seed);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) assert.equal(board[y][x], board[y][GRID - 1 - x], `seed ${seed} at ${x},${y}`);

    // One 4-connected piece.
    const filled = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (board[y][x]) filled.push(`${x},${y}`);
    const seen = new Set([filled[0]]);
    const queue = [filled[0]];
    while (queue.length) {
      const [x, y] = queue.pop().split(",").map(Number);
      for (const [i, j] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const key = `${i},${j}`;
        if (board[j]?.[i] && !seen.has(key)) seen.add(key) && queue.push(key);
      }
    }
    assert.equal(seen.size, filled.length, `seed ${seed} is in pieces`);

    // An outline color, at least two body tones, and something darker or lighter for eyes.
    assert.ok(new Set(filled.map((k) => board[k.split(",")[1]][k.split(",")[0]])).size >= 4, `seed ${seed} has too few colors`);

    // Eyes: closing them changes pixels inside the art.
    const idle = still(seed, "idle");
    const changed = filled.filter((k) => {
      const [x, y] = k.split(",").map(Number);
      return idle[y][x] !== board[y][x] && x > 0 && x < GRID - 1;
    });
    assert.ok(changed.length >= 2, `seed ${seed} has no eyes that close`);
  }
});

test("at least 200 of 256 seeds give different sprites", () => {
  const addresses = new Set(Array.from({ length: 256 }, (_, i) => JSON.stringify(still(`t${i}`))));
  assert.ok(addresses.size >= 200, `${addresses.size} different of 256 addresses`);
  let n = 1;
  const rand = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const random = new Set(Array.from({ length: 256 }, () => JSON.stringify(still(randomSeed(rand)))));
  assert.ok(random.size >= 200, `${random.size} different of 256 random seeds`);
});

test("seeds differ in silhouette and palette, not only in detail", () => {
  const shapes = new Set();
  const palettes = new Set();
  for (let i = 0; i < 64; i++) {
    const board = still(`t${i}`);
    shapes.add(board.map((row) => row.map((c) => (c ? 1 : 0)).join("")).join("/"));
    palettes.add(board[6].find(Boolean) ?? "");
  }
  assert.ok(shapes.size >= 32, `${shapes.size} silhouettes in 64 seeds`);
  assert.ok(palettes.size >= 8, `${palettes.size} outline colors in 64 seeds`);
});

test("randomSeed gives 6 characters of [a-z0-9], from the given rand", () => {
  for (let i = 0; i < 200; i++) assert.match(randomSeed(), /^[a-z0-9]{6}$/);
  assert.equal(randomSeed(() => 0), "aaaaaa");
  assert.equal(randomSeed(() => 0.9999999), "999999");
  assert.match(randomSeed(() => 1), /^[a-z0-9]{6}$/);
  let n = 3;
  const rand = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  const a = randomSeed(rand);
  n = 3;
  assert.equal(randomSeed(rand), a);
});

test("spriteElement is a GRID * px square that does not shrink, for every status", () => {
  const sprite = makeSprite("t1");
  for (const px of [1, 2, 3, 4]) {
    for (const status of STATUSES) {
      const root = nodeOf(spriteElement(sprite, { id: "spr", px, status }));
      assert.equal(root.id, "spr");
      assert.deepEqual(calls(root, "size"), [[GRID * px]]);
      assert.equal(calls(root, "flex_none").length, 1);
      assert.equal(calls(root, "relative").length, 1);
    }
  }
  assert.deepEqual(calls(nodeOf(spriteElement(sprite, { id: "d" })), "size"), [[GRID * 3]], "px defaults to 3");
});

test("spriteElement needs an id, and any id inside starts with it", () => {
  assert.throws(() => spriteElement(makeSprite("t1"), {}), /id/);
  for (const status of STATUSES) {
    const nodes = check(spriteElement(makeSprite("t1"), { id: "spr-a", status }));
    for (const node of nodes.slice(1)) if (node.id !== null) assert.ok(node.id.startsWith("spr-a-"));
  }
});

test("every status renders through the stand-ins, and only statuses move", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    for (const status of [...STATUSES, "unknown"]) {
      const nodes = check(spriteElement(makeSprite(seed), { id: "s", status }));
      const moves = nodes.reduce((n, node) => n + calls(node, "loop").length, 0);
      if (status === null || status === "unknown") assert.equal(moves, 0, `${status} should be still`);
      else assert.ok(moves > 0, `${status} should move`);
      for (const node of nodes) for (const [, policy] of calls(node, "loop")) assert.ok(policy.period >= 100);
    }
  }
});

test("each status has its own tree and its own still frame", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const sprite = makeSprite(seed);
    const shape = (node) => [node.kind, node.calls.filter(([name]) => name !== "child" && name !== "children")];
    const trees = STATUSES.map((status) => JSON.stringify(walk(spriteElement(sprite, { id: "s", status })).map(shape)));
    assert.equal(new Set(trees).size, STATUSES.length, `seed ${seed}: statuses share a tree`);
    const frames = STATUSES.map((status) => JSON.stringify(still(seed, status)));
    assert.equal(new Set(frames).size, STATUSES.length, `seed ${seed}: statuses share a still frame`);
  }
});

test("a blocked creature is on fire: a still bed of flames at its feet, tongues that flicker, and its badge", () => {
  const flames = new Set(Object.values(FIRE));
  const fireIn = (board) => board.flat().filter((c) => flames.has(c)).length;
  for (const seed of SEEDS.slice(0, 20)) {
    const board = still(seed, "blocked");
    // The bed shows in a single frame, along the bottom row, under the creature's feet.
    assert.ok(board[GRID - 1].slice(1, GRID - 1).every((c) => flames.has(c)), `seed ${seed}: no fire bed`);
    assert.ok(board.slice(0, 5).flat().includes(theme().blocked), "the badge still shows, in the theme's blocked color");
    for (const status of STATUSES.filter((s) => s !== "blocked")) assert.equal(fireIn(still(seed, status)), 0, `${status} is not on fire`);

    // The tongues flicker in turn, and the tall ones lick up by one cell at most.
    const nodes = walk(spriteElement(makeSprite(seed), { id: "s", px: 3, status: "blocked" }));
    const flickers = nodes.filter((n) => calls(n, "loop").some(([p]) => p === "opacity") && walk(n).some((c) => flames.has(last(c, "bg"))));
    assert.ok(flickers.length >= 2, "at least two flickering flame layers");
    assert.ok(flickers.some((n) => calls(n, "loop")[0][1].from > calls(n, "loop")[0][1].to) && flickers.some((n) => calls(n, "loop")[0][1].from < calls(n, "loop")[0][1].to), "flames flicker in turn");
    const licks = nodes.flatMap((n) => calls(n, "loop").filter(([p]) => p === "top").map(([, policy]) => policy));
    assert.ok(licks.length >= 1 && licks.every(({ from, to }) => from === 0 && to === -3), "tongues lick up by one cell");
  }
});

test("a long block burns hotter: small flames, bigger after a minute, smoke and embers after five", () => {
  assert.deepEqual(STAGES.blocked, [60_000, 300_000]);
  const flames = new Set(Object.values(FIRE));
  const ash = new Set(Object.values(SMOKE));
  const count = (board, colors) => board.flat().filter((c) => colors.has(c)).length;
  for (const seed of SEEDS.slice(0, 20)) {
    const sprite = makeSprite(seed);
    const blocked = (stage, px = 1) => spriteElement(sprite, { id: "s", px, status: "blocked", stage });
    const [small, big, hot] = [0, 1, 2].map((stage) => raster(blocked(stage)));
    for (const [stage, board] of [small, big, hot].entries()) {
      // Every stage is a fire in a single frame, under its badge: blocked stays the loudest.
      assert.ok(board[GRID - 1].slice(1, GRID - 1).every((c) => flames.has(c)), `seed ${seed}, stage ${stage}: no fire bed`);
      assert.ok(board.slice(0, 5).flat().includes(theme().blocked), `seed ${seed}, stage ${stage}: no badge`);
      raster(blocked(stage), { peak: true });
      for (const px of [1, 3, 8]) {
        for (const r of reach(nodeOf(blocked(stage, px)))) {
          assert.ok(r.x[0] >= 0 && r.y[0] >= 0 && r.x[1] <= GRID * px && r.y[1] <= GRID * px, `stage ${stage} at ${px} px reaches x ${r.x}, y ${r.y}`);
        }
      }
    }
    assert.ok(count(small, flames) < count(big, flames), `seed ${seed}: a minute in, the flames grow`);
    assert.ok(count(big, flames) < count(hot, flames), `seed ${seed}: five minutes in, embers fly`);
    assert.equal(count(small, ash) + count(big, ash), 0, "no smoke before five minutes");
    assert.ok(count(hot, ash) > 0, `seed ${seed}: five minutes in, it smokes, in a single frame`);
    assert.deepEqual(raster(blocked(7)), hot, "past the last stage, as hot as the last");
    for (const junk of [-1, NaN, 0.5]) assert.deepEqual(raster(blocked(junk)), small, `stage ${junk} burns small`);
  }
});

test("a fire's smoke has its own colors, and stage changes no other status", () => {
  const taken = new Set([...Object.values(HIT), ...Object.values(FIRE), ...Object.values(DOUSE), ...Object.values(CONFETTI), theme().blocked, theme().done, theme().idle, theme().working].map((c) => c.toLowerCase()));
  for (const color of Object.values(SMOKE)) {
    assert.match(color, HEX);
    assert.ok(!taken.has(color), `${color} means something else`);
  }
  const sprite = makeSprite("t1");
  for (const status of STATUSES.filter((s) => s !== "blocked")) {
    assert.equal(tree(spriteElement(sprite, { id: "s", status, stage: 2 })), tree(spriteElement(sprite, { id: "s", status })), `${status} at stage 2`);
  }
});

// ---- ways of working ----

/** One seed of each kind of creature, the first found. */
const KINDS = (() => {
  const byKind = new Map();
  for (let i = 0; byKind.size < 10 && i < 2000; i++) {
    const sprite = makeSprite(`k${i}`);
    if (!byKind.has(sprite.kind)) byKind.set(sprite.kind, sprite);
  }
  return [...byKind.values()];
})();

/** Every value a property takes on a node: its own value and both ends of its loop. */
function values(node, props) {
  const out = [];
  for (const [name, args] of node.calls) {
    if (props.includes(name) || (name === "size" && (props.includes("w") || props.includes("h")))) out.push(args[0]);
    if (name === "loop" && props.includes(args[0])) out.push(args[1].from, args[1].to);
  }
  return out.length ? out : [0];
}

/** Where each drawn rectangle reaches over its whole motion, in px from the sprite's corner. */
function reach(node, x0 = [0, 0], y0 = [0, 0], out = []) {
  const ls = values(node, ["left"]);
  const ts = values(node, ["top"]);
  const x = [x0[0] + Math.min(...ls), x0[1] + Math.max(...ls)];
  const y = [y0[0] + Math.min(...ts), y0[1] + Math.max(...ts)];
  if (calls(node, "bg").length) out.push({ x: [x[0], x[1] + Math.max(...values(node, ["w", "width"]))], y: [y[0], y[1] + Math.max(...values(node, ["h", "height"]))] });
  for (const child of node.children) if (nodeOf(child)) reach(nodeOf(child), x, y, out);
  return out;
}

const working = (sprite, work, px = 3) => spriteElement(sprite, { id: "s", px, status: "working", work });
/** An element's whole tree as text: every node's kind and calls, children aside. */
const tree = (el) => JSON.stringify(walk(el).map((node) => [node.kind, node.calls.filter(([name]) => name !== "child" && name !== "children")]));

test("there are thirteen ways of working, walk among them, and the test covers every kind", () => {
  assert.deepEqual([...WORKS].sort(), ["building", "compacting", "delegating", "git", "hammering", "installing", "reading", "searching", "signal", "testing", "thinking", "typing", "walk"]);
  assert.equal(KINDS.length, 10);
});

test("every way of working, on every kind, at every size, stays in its box through all its motion", () => {
  for (const sprite of KINDS) {
    for (const work of WORKS) {
      for (const px of [1, 2, 3, 4, 8]) {
        const size = GRID * px;
        for (const r of reach(nodeOf(working(sprite, work, px)))) {
          assert.ok(r.x[0] >= 0 && r.y[0] >= 0 && r.x[1] <= size && r.y[1] <= size, `${work} on a ${sprite.kind} at ${px} px reaches x ${r.x}, y ${r.y}`);
        }
      }
    }
  }
});

test("every way of working renders through the stand-ins in its own colors, and moves", () => {
  // Colors that mean something else: a hit, the fire, and the other statuses' cues.
  const taken = new Set([...Object.values(HIT), ...Object.values(FIRE), theme().blocked, theme().done, theme().idle].map((c) => c.toLowerCase()));
  for (const sprite of KINDS) {
    for (const work of WORKS) {
      const nodes = check(working(sprite, work));
      for (const node of nodes.slice(1)) assert.equal(node.id, null, "no ids inside");
      for (const node of nodes) {
        for (const [color] of calls(node, "bg")) {
          assert.match(color, HEX, `${work}: ${color}`);
          assert.ok(!taken.has(color), `${work} uses ${color}, which means something else`);
        }
        for (const [opacity] of calls(node, "opacity")) assert.ok(opacity >= 0 && opacity <= 1);
        for (const [property, { from, to, period }] of calls(node, "loop")) {
          assert.ok(period >= 100);
          if (property === "opacity") assert.ok(from >= 0 && from <= 1 && to >= 0 && to <= 1);
          if (property === "width" || property === "height") assert.ok(from >= 0 && to >= 0);
        }
        // One loop per property on an element: a part that moves two ways nests a layer.
        const looped = calls(node, "loop").map(([property]) => property);
        assert.equal(new Set(looped).size, looped.length, `${work}: one element loops ${looped}`);
      }
      assert.ok(nodes.some((node) => calls(node, "loop").length), `${work} should move`);
    }
  }
});

test("each way of working has its own tree and its own still frame", () => {
  for (const sprite of KINDS) {
    const trees = WORKS.map((work) => tree(working(sprite, work)));
    assert.equal(new Set(trees).size, WORKS.length, `${sprite.kind}: ways of working share a tree`);
    const frames = WORKS.map((work) => JSON.stringify(raster(working(sprite, work, 1))));
    assert.equal(new Set(frames).size, WORKS.length, `${sprite.kind}: ways of working share a still frame`);
  }
});

// ---- fidgets ----

const idle = (sprite, px = 3) => spriteElement(sprite, { id: "s", px, status: "idle" });
/** A layer that swings its opacity up from 0 and back: one layer of a fidget. */
const fades = (node) => calls(node, "loop").some(([property, { from, to }]) => property === "opacity" && from === 0 && to === 1);
/** A creature's fidget: the opacity loops of its nested layers, outermost first, and what they hold. */
function fidgetIn(el) {
  let node = walk(el).find(fades);
  if (!node) return null;
  const layers = [];
  while (fades(node)) {
    layers.push(calls(node, "loop").find(([property]) => property === "opacity")[1]);
    node = nodeOf(node.children[0]);
  }
  return { layers, inner: node };
}
/** The body's color at a cell, or null. */
const bodyAt = (sprite, x, y) => sprite.parts.body.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)?.color ?? null;
const cellsOf = (rects) => rects.flatMap((r) => Array.from({ length: r.w * r.h }, (_, i) => ({ x: r.x + (i % r.w), y: r.y + Math.floor(i / r.w), color: r.color })));

/** For each kind and each fidget, a seed that has both. */
const FIDGETERS = (() => {
  const out = new Map();
  for (let i = 0; out.size < KINDS.length * FIDGETS.length && i < 5000; i++) {
    const sprite = makeSprite(`f${i}`);
    const key = `${sprite.kind} ${ownFidget(sprite).fidget}`;
    if (!out.has(key)) out.set(key, sprite);
  }
  return [...out.values()];
})();

test("an idle creature's own fidget and rhythm come from its seed, apart from its look and its way of working", () => {
  assert.deepEqual([...FIDGETS].sort(), ["blink", "look", "scratch"]);
  assert.equal(FIDGETERS.length, KINDS.length * FIDGETS.length, "every kind fidgets every way, for some seed");
  const fidgets = new Set();
  const rhythms = new Set();
  for (const seed of SEEDS) {
    const own = ownFidget(makeSprite(seed));
    assert.equal(own.fidget, FIDGETS[hashSeed(`${seed}\u0000fidget`) % FIDGETS.length], `seed ${seed}: its own salt`);
    assert.deepEqual(ownFidget(makeSprite(seed)), own);
    assert.equal(fidgetIn(idle(makeSprite(seed))).layers[0].period, own.period, `seed ${seed} fidgets at its own rhythm`);
    fidgets.add(own.fidget);
    rhythms.add(own.period);
  }
  assert.deepEqual([...fidgets].sort(), [...FIDGETS].sort(), "every fidget is some seed's");
  assert.ok(rhythms.size >= 3, "seeds fidget at different rhythms");
});

test("only an idle creature fidgets", () => {
  // Two nested layers fading up from 0 together: a fidget. Hammering's sparks fade alone.
  const nested = (el) => walk(el).some((node) => fades(node) && node.children.some((c) => fades(nodeOf(c))));
  for (const seed of SEEDS.slice(0, 20)) {
    for (const status of STATUSES) assert.equal(nested(spriteElement(makeSprite(seed), { id: "s", status })), status === "idle", `seed ${seed}, ${status}`);
    for (const work of WORKS) assert.ok(!nested(working(makeSprite(seed), work)), `${work} fidgets`);
  }
});

test("a fidget is brief: its layers line up into a short spike, so almost every frame is closed-eyed", () => {
  for (const seed of SEEDS) {
    const { layers } = fidgetIn(idle(makeSprite(seed)));
    assert.ok(layers.length >= 2, `seed ${seed}: one layer is a plain pulse, shown half the time`);
    // One period and one easing for all, so their peaks meet.
    assert.equal(new Set(layers.map((p) => p.period)).size, 1);
    assert.ok(layers.every((p) => p.easing === "ease-in"));
    // Opacity multiplies down the tree. Model each loop as linear there and back: ease-in
    // stays under that line, so this is the longest the fidget could show.
    const steps = 1000;
    let shown = 0;
    let top = 0;
    for (let i = 0; i < steps; i++) {
      const phase = 1 - Math.abs(1 - (2 * i) / steps); // 0 at the start, 1 at the middle
      const opacity = layers.reduce((product, { from, to }) => product * (from + (to - from) * phase), 1);
      if (opacity > 0.5) shown++;
      top = Math.max(top, opacity);
    }
    assert.ok(shown / steps < 0.15, `seed ${seed}: shows over half strength for ${shown / steps} of its period`);
    assert.equal(top, 1, "at its peak it shows in full");
  }
});

test("a fidget at its peak: a blink opens the eyes, a look glances aside, a scratch strokes its side with the eyes shut", () => {
  for (const sprite of FIDGETERS) {
    const { fidget } = ownFidget(sprite);
    const rest = raster(idle(sprite, 1));
    const peak = raster(idle(sprite, 1), { peak: true });
    const lids = cellsOf(sprite.parts.eyes.closed);
    const label = `${sprite.kind} ${sprite.seed} ${fidget}`;
    // At rest, every fidget is shut: the closed eyes show.
    for (const { x, y, color } of lids) assert.equal(rest[y][x], color, `${label}: shut at rest`);
    if (fidget === "scratch") {
      for (const { x, y, color } of lids) assert.equal(peak[y][x], color, `${label}: still shut`);
      const strokes = (board) => board.filter((row) => row[0] === theme().foreground).length;
      assert.equal(strokes(rest), 0, `${label}: no strokes at rest`);
      assert.ok(strokes(peak) >= 2, `${label}: strokes at its left side`);
    } else {
      const eyes = cellsOf(sprite.parts.eyes[fidget === "blink" ? "open" : "look"]);
      for (const { x, y, color } of eyes) assert.equal(peak[y][x], color, `${label}: eye at ${x},${y}`);
      // Where the lid was and no eye is, the body shows: no lid through an open eye.
      for (const { x, y } of lids.filter((l) => !eyes.some((e) => e.x === l.x && e.y === l.y))) {
        assert.equal(peak[y][x], bodyAt(sprite, x, y), `${label}: lid shows at ${x},${y}`);
      }
      // A blink's face is the creature's own open-eyed face.
      if (fidget === "blink") {
        const awake = still(sprite.seed);
        for (const { x, y } of [...lids, ...eyes]) assert.equal(peak[y][x], awake[y][x], `${label}: not its open face at ${x},${y}`);
      }
    }
  }
});

test("every fidget, on every kind, at every size, stays in its box and moves each property once", () => {
  for (const sprite of FIDGETERS) {
    for (const px of [1, 2, 3, 4, 8]) {
      const size = GRID * px;
      for (const r of reach(nodeOf(idle(sprite, px)))) {
        assert.ok(r.x[0] >= 0 && r.y[0] >= 0 && r.x[1] <= size && r.y[1] <= size, `${ownFidget(sprite).fidget} on a ${sprite.kind} at ${px} px reaches x ${r.x}, y ${r.y}`);
      }
    }
    for (const node of check(idle(sprite))) {
      for (const [color] of calls(node, "bg")) assert.match(color, HEX);
      const looped = calls(node, "loop").map(([property]) => property);
      assert.equal(new Set(looped).size, looped.length);
    }
  }
});

test("a creature's own way of working comes from its seed, and every way it had is someone's", () => {
  // The seven ways from before the kinds of command, in their order then.
  const OWN = ["walk", "typing", "reading", "hammering", "searching", "thinking", "signal"];
  const seen = new Set();
  for (const seed of SEEDS) {
    const own = ownWork(makeSprite(seed));
    assert.equal(own, OWN[hashSeed(`${seed}\u0000work`) % OWN.length], `seed ${seed} keeps the way it had`);
    assert.equal(ownWork(makeSprite(seed)), own);
    seen.add(own);
  }
  assert.deepEqual([...seen].sort(), [...OWN].sort(), "every one of the seven is some seed's own, and only they are");
});

test("the ways for kinds of command move their props: bubbles light in turn, the brick rises on its cable, the package pops, the branch grows", () => {
  const t = theme();
  /** Every loop in a way's tree, with the color it moves: the node's own or its first drawn child's. */
  const loops = (el) =>
    walk(el).flatMap((node) => calls(node, "loop").map(([property, policy]) => ({ property, ...policy, color: last(node, "bg") ?? walk(node).map((c) => last(c, "bg")).find(Boolean) })));
  for (const sprite of KINDS) {
    const testing = loops(working(sprite, "testing")).filter((l) => l.property === "opacity" && l.color === "#ffffff");
    assert.deepEqual(testing.map((l) => l.easing), ["ease-out", "linear", "ease-in"], "three bubbles light from the bottom up");
    const tube = raster(working(sprite, "testing", 1)).slice(5).map((row) => row.slice(10));
    assert.ok(tube.slice(3).flat().every((c) => c === t.accent || c === "#ffffff"), "liquid with bubbles in it fills the tube's foot, at the right edge");
    assert.ok(tube.slice(0, 3).flat().every((c) => c !== null && c !== t.accent), "glass over it");

    // While the drawer shows how the tests came out, the creature has put its tube down.
    const empty = spriteElement(sprite, { id: "s", px: 1, status: "working", work: "testing", tube: false });
    const bare = raster(empty).slice(5).map((row) => row.slice(10));
    assert.ok(bare.flat().every((c) => c !== "#cfe3ea" && c !== t.accent), "no tube without it");
    assert.ok(!loops(empty).some((l) => l.color === "#ffffff"), "and no bubbles");
    assert.ok(loops(empty).some((l) => l.property === "top"), "it still bobs as it watches");
    assert.equal(tree(spriteElement(sprite, { id: "s", status: "working", work: "testing", tube: true })), tree(working(sprite, "testing")), "it holds the tube by default");
    assert.equal(tree(spriteElement(sprite, { id: "s", status: "working", work: "reading", tube: false })), tree(working(sprite, "reading")), "only testing has a tube to put down");

    const building = loops(working(sprite, "building"));
    const rise = building.find((l) => l.property === "top" && l.color === "#a4553a");
    const reel = building.find((l) => l.property === "height");
    assert.ok(rise && rise.to < rise.from, "the brick rises");
    assert.ok(reel && reel.from - reel.to === rise.from - rise.to && reel.period === rise.period && reel.easing === rise.easing, "the cable reels in with it");

    const pop = loops(working(sprite, "installing")).find((l) => l.property === "top" && l.color === t.accent);
    assert.ok(pop && pop.from === 0 && pop.to > 0, "the package stands up out of the box, and sinks back in");

    const grow = loops(working(sprite, "git")).filter((l) => l.property === "opacity");
    assert.deepEqual(grow.map((l) => l.easing), ["ease-out", "linear", "ease-in"], "the branch grows a cell at a time");
    assert.equal(grow.at(-1).color, t.working, "its leaf comes last");
  }
});

test("compacting, a press comes down on the creature's head and squishes it a cell into its feet, in step", () => {
  const t = theme();
  for (const sprite of KINDS) {
    for (const px of [1, 3, 8]) {
      const root = nodeOf(working(sprite, "compacting", px));
      const figure = nodeOf(root.children.find((c) => nodeOf(c).children.length === 3));
      const [left, right, torso] = figure.children.map(nodeOf);
      assert.deepEqual([calls(left, "loop"), calls(right, "loop")], [[], []], "the feet stay put");
      const [[property, sink]] = calls(torso, "loop");
      assert.deepEqual([property, sink.from, sink.to], ["top", 0, px], "the body sinks one cell");

      // The plate: a layer that moves with the body, holding one bar across the box.
      const plate = root.children.map(nodeOf).find((n) => calls(n, "loop").some(([p]) => p === "top"));
      assert.deepEqual(calls(plate, "loop"), [["top", sink]], "the plate comes down with the head, in step");
      const bar = nodeOf(plate.children[0]);
      assert.equal(last(bar, "bg"), t.foreground);
      const head = Math.min(...sprite.parts.body.map((r) => r.y)) * px;
      assert.equal(last(bar, "top") + last(bar, "h"), head, "it rests on the head, clear of the art");
      const rod = root.children.map(nodeOf).find((n) => calls(n, "loop").some(([p]) => p === "height"));
      const [[, reel]] = calls(rod, "loop");
      assert.ok(reel.to - reel.from === px && reel.period === sink.period && reel.easing === sink.easing, "the rod reels out with it");
    }
    // The press and its rails show in a single frame, at the edges and over the head.
    const board = raster(working(sprite, "compacting", 1));
    assert.ok(board.every((row) => row[0] === t.dim && row[GRID - 1] === t.dim), `${sprite.kind}: rails at both edges`);
  }
});

test("delegating, a megaphone held up over the head calls out toward the right edge, in step with the body", () => {
  const t = theme();
  for (const sprite of KINDS) {
    // The megaphone and its calls show in a single frame, in the rows over any eye.
    const board = raster(working(sprite, "delegating", 1));
    assert.deepEqual([0, 1, 2].map((y) => board[y][9]), Array(3).fill(t.foreground), `${sprite.kind}: the bell, three cells tall`);
    assert.equal(board[1][8], t.foreground, `${sprite.kind}: the cone`);
    assert.equal(board[1][7], t.dim, `${sprite.kind}: the mouthpiece`);
    assert.deepEqual([board[1][10], ...[0, 1, 2].map((y) => board[y][11])], Array(4).fill(t.working), `${sprite.kind}: two calls out of the bell`);

    // The calls pulse out in turn, the inner first, once a shout of the body.
    const root = nodeOf(working(sprite, "delegating"));
    const calling = walk(root).filter((node) => calls(node, "loop").some(([p]) => p === "opacity")).map((node) => ({ color: walk(node).map((c) => last(c, "bg")).find(Boolean), ...calls(node, "loop")[0][1] }));
    assert.deepEqual(calling.map((c) => [c.color, c.easing]), [[t.working, "ease-out"], [t.working, "ease-in"]]);
    const figure = nodeOf(root.children.find((c) => nodeOf(c).children.length === 3));
    const [[property, shout]] = calls(nodeOf(figure.children[2]), "loop");
    assert.equal(property, "top");
    assert.ok(shout.to < shout.from && calling.every((c) => c.period === shout.period), "the body bobs with each call");
  }
});

test("without a known way from its hooks, a working creature works its own way", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const sprite = makeSprite(seed);
    const own = tree(working(sprite, ownWork(sprite)));
    for (const work of [null, undefined, "", "dancing", "__proto__", "constructor", "toString", 7]) {
      assert.equal(tree(working(sprite, work)), own, `work ${String(work)}`);
    }
  }
});

test("only a working creature shows its way of working", () => {
  const sprite = makeSprite("t1");
  for (const status of STATUSES.filter((s) => s !== "working")) {
    const plain = tree(spriteElement(sprite, { id: "s", status }));
    for (const work of WORKS) assert.equal(tree(spriteElement(sprite, { id: "s", status, work })), plain, `${status} with ${work}`);
  }
});

test("no way of working hides the creature's eyes, whichever way it faces: a prop over a low face draws them again, bobbing with it", () => {
  const px = 3;
  /** The still frame at `px`, a board of GRID * px square of colors. */
  const board = (el) => {
    const size = GRID * px;
    const out = Array.from({ length: size }, () => Array(size).fill(null));
    const paint = (child, ox, oy) => {
      const node = nodeOf(child);
      if (!node) return;
      const x = ox + (last(node, "left") ?? 0);
      const y = oy + (last(node, "top") ?? 0);
      const bg = last(node, "bg");
      if (bg) {
        const w = last(node, "w") ?? last(node, "size");
        const h = last(node, "h") ?? last(node, "size");
        for (let j = Math.max(0, y); j < Math.min(size, y + h); j++) for (let i = Math.max(0, x); i < Math.min(size, x + w); i++) out[j][i] = bg;
      }
      for (const c of node.children) paint(c, x, y);
    };
    for (const c of nodeOf(el).children) paint(c, 0, 0);
    return out;
  };
  let low = 0;
  for (let i = 0; i < 300; i++) {
    const sprite = makeSprite(`t${i}`);
    for (const work of WORKS) {
      // Facing a way, the whole drawing steps a cell inside one layer, and the eyes look that way.
      for (const [face, [dx, dy]] of [[null, [0, 0]], ...Object.entries(FACES)]) {
        const el = spriteElement(sprite, { id: "s", px, status: "working", work, face });
        const root = face ? nodeOf(nodeOf(el).children[0]) : nodeOf(el);
        // The eyes this way draws: the torso's eye layer, its last child.
        const torso = nodeOf(root.children.find((c) => nodeOf(c).children.length === 3)).children[2];
        const eyes = nodeOf(nodeOf(torso).children[1]).children.map((c) => nodeOf(c));
        const b = board(el);
        for (const e of eyes) {
          const [x, y, w, h, color] = ["left", "top", "w", "h", "bg"].map((k) => last(e, k));
          for (let j = y; j < y + h; j++) {
            for (let k = x; k < x + w; k++) assert.equal(b[j + dy * px][k + dx * px], color, `${work} facing ${face} hides an eye of t${i} (${sprite.kind}) at ${k},${j}`);
          }
        }
      }
    }
    if (sprite.parts.eyes.look.some((r) => r.y + r.h > 8)) {
      low++;
      for (const work of ["typing", "reading"]) {
        const root = nodeOf(working(sprite, work, px));
        const torso = nodeOf(nodeOf(root.children[0]).children[2]);
        assert.deepEqual(calls(nodeOf(root.children.at(-1)), "loop"), calls(torso, "loop"), `${work}: the eyes over the prop bob with the body`);
      }
    }
  }
  assert.ok(low > 0, "some creatures have eyes low enough to test");
});

test("a thought bubble's tail leads to the head: a short one, beside the art, clear of it and of the cell's edges", () => {
  for (const px of [3, 8]) {
    for (let i = 0; i < 600; i++) {
      const sprite = makeSprite(`t${i}`);
      const art = new Set();
      for (const r of [...sprite.parts.body, ...sprite.parts.eyes.open]) {
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) art.add(y * GRID + x);
      }
      const on = (x, y) => art.has(y * GRID + x);
      const front = nodeOf(working(sprite, "thinking", px)).children.map(nodeOf).filter((n) => calls(n, "rounded").length);
      // The bubble is the round mark sized by width and height; the puffs, by size.
      const bubble = front.find((n) => last(n, "w") !== undefined);
      const puffs = front.filter((n) => last(n, "size") !== undefined).map((n) => ({ x: last(n, "left"), y: last(n, "top"), s: last(n, "size") }));
      assert.ok(puffs.length === 1 || puffs.length === 2, `t${i}: one or two puffs`);
      if (puffs.length === 2) assert.ok(puffs[0].s > puffs[1].s, `t${i}: the puffs shrink toward the head`);
      for (const p of puffs) {
        for (let y = p.y; y < p.y + p.s; y++) {
          for (let x = p.x; x < p.x + p.s; x++) assert.ok(!on(Math.floor(x / px), Math.floor(y / px)), `t${i} (${sprite.kind}) at ${px} px: a puff covers the art at ${x},${y}`);
        }
      }
      const near = puffs.at(-1);
      const cx = Math.floor((near.x + near.s / 2) / px);
      const cy = Math.floor((near.y + near.s / 2) / px);
      assert.ok(cx >= 2 && cy >= 1, `t${i} (${sprite.kind}): the tail ends at cell ${cx},${cy}, on the cell's edge`);
      assert.ok([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => on(cx + dx, cy + dy))), `t${i} (${sprite.kind}): the tail ends beside the head, at cell ${cx},${cy}`);
      const gap = Math.hypot(Math.max(0, cx + 0.5 - last(bubble, "w") / px), Math.max(0, cy + 0.5 - last(bubble, "h") / px));
      assert.ok(gap <= 2.5, `t${i} (${sprite.kind}): the tail runs ${gap} cells from the bubble`);
    }
  }
});

// ---- turns ----

/** A creature having its fire put out, at one step of the douse. */
const doused = (sprite, step, { px = 3, n = 1 } = {}) =>
  spriteElement(sprite, { id: "s", px, status: "working", work: "typing", turn: { kind: "douse", n, step } });
const DOUSE_STEPS = ["pour", "splash", "steam"];

test("a blocked agent going on plays a douse: from blocked to working, in steps that end", () => {
  const { from, to, first, steps } = TURNS.douse;
  assert.deepEqual([from, to, first], ["blocked", "working", "pour"]);
  assert.deepEqual(steps.map(([, step]) => step), ["splash", "steam", null]);
  assert.ok(steps.every(([ms], i) => i === 0 || ms > steps[i - 1][0]), "each step after the last");
  assert.ok(steps.at(-1)[0] >= 1200, "slow enough to follow");
});

test("a douse: the fire burns under hanging water, dies as the water falls on it, and steam rises off the bed", () => {
  const flames = new Set(Object.values(FIRE));
  for (const sprite of KINDS) {
    const part = (el, name) => walk(el).find((n) => n.id === `s-douse-1-${name}`);
    const [pour, splash, steam] = DOUSE_STEPS.map((step) => doused(sprite, step));
    for (const el of [pour, splash, steam]) check(el);

    // Poured: the creature still stands in its fire, in a single frame, and water hangs over it.
    const board = raster(doused(sprite, "pour", { px: 1 }));
    assert.ok(board[GRID - 1].slice(1, GRID - 1).every((c) => flames.has(c)), `${sprite.kind}: the fire still burns`);
    assert.ok(board.slice(0, 3).flat().includes(DOUSE.water), "water over the creature");
    assert.equal(last(part(pour, "fire"), "opacity"), 1);
    assert.equal(last(part(pour, "embers"), "opacity"), 1, "the tongues behind it too");
    assert.equal(last(part(pour, "steam"), "opacity"), 0, "no steam yet");

    // Splashed: the water falls onto the bed, faster as it falls, and the fire dies as it lands.
    assert.ok(last(part(splash, "water"), "top") > last(part(pour, "water"), "top"), "the water falls");
    assert.equal(Object.fromEntries(calls(part(splash, "water"), "transition")).top.easing, "ease-in");
    for (const name of ["fire", "embers"]) {
      assert.equal(last(part(splash, name), "opacity"), 0, `the ${name} go out`);
      assert.ok(Object.fromEntries(calls(part(splash, name), "transition")).opacity.delay > 0, "as the water lands, not before");
    }
    assert.equal(last(part(splash, "spray"), "opacity"), 1, "spray flies off the bed");
    assert.ok(last(part(splash, "steam"), "opacity") > 0, "steam gathers on the bed");

    // Steamed: the water is gone and the steam rises and fades, slowly enough to see.
    assert.equal(last(part(steam, "water"), "opacity"), 0);
    assert.equal(last(part(steam, "fire"), "opacity"), 0, "the fire stays out");
    assert.ok(last(part(steam, "steam"), "top") < last(part(splash, "steam"), "top"), "the steam rises");
    assert.equal(last(part(steam, "steam"), "opacity"), 0);
    assert.ok(Object.fromEntries(calls(part(steam, "steam"), "transition")).top.duration >= 600);

    // Every step stays in the box: `raster` fails on anything outside it.
    for (const step of DOUSE_STEPS) raster(doused(sprite, step, { px: 1 }));
  }
});

test("a douse holds the creature still, with no badge, in water and steam of their own colors", () => {
  const taken = new Set([...Object.values(HIT), ...Object.values(FIRE), theme().blocked, theme().done, theme().idle, theme().working].map((c) => c.toLowerCase()));
  for (const c of Object.values(DOUSE)) assert.ok(!taken.has(c.toLowerCase()), `${c} means something else`);
  for (const sprite of KINDS) {
    for (const step of DOUSE_STEPS) {
      const el = doused(sprite, step);
      const nodes = walk(el);
      assert.ok(!nodes.some((n) => calls(n, "bg").some(([c]) => c === theme().blocked)), `${step}: no "Needs you" badge`);
      assert.ok(!nodes.some((n) => calls(n, "bg").some(([c]) => c === theme().working)), `${step}: not working yet`);
      // Only the turn's own parts move: the creature holds still until it is over.
      const own = new Set(nodes.filter((n) => n.id?.startsWith("s-douse-1-")).flatMap((n) => walk(n)));
      assert.ok(nodes.filter((n) => !own.has(n)).every((n) => calls(n, "loop").length === 0), `${step}: the creature moves`);
      for (const name of ["water", "spray", "steam"]) {
        const colors = walk(nodes.find((n) => n.id === `s-douse-1-${name}`)).flatMap((n) => calls(n, "bg").map(([c]) => c));
        assert.ok(colors.length && colors.every((c) => Object.values(DOUSE).includes(c)), `${name} in DOUSE's colors`);
      }
      for (const node of nodes) if (node.id !== null && node !== nodes[0]) assert.ok(node.id.startsWith("s-"), node.id);
    }
  }
});

test("a new douse has new ids, and a turn of no known kind is no turn", () => {
  const sprite = makeSprite("t1");
  const ids = (el) => walk(el).map((n) => n.id).filter(Boolean);
  assert.ok(ids(doused(sprite, "pour", { n: 7 })).includes("s-douse-7-water"));
  assert.ok(!ids(doused(sprite, "pour", { n: 7 })).includes("s-douse-1-water"));
  const plain = tree(working(sprite, "typing"));
  for (const kind of ["splash", "__proto__", "toString", 5]) {
    assert.equal(tree(spriteElement(sprite, { id: "s", px: 3, status: "working", work: "typing", turn: { kind, n: 1, step: "pour" } })), plain, String(kind));
  }
});

/** A creature waking up for work, at one step of the stretch. */
const stretched = (sprite, step, { px = 3, n = 1 } = {}) =>
  spriteElement(sprite, { id: "s", px, status: "working", work: "typing", turn: { kind: "stretch", n, step } });
const STRETCH_STEPS = ["yawn", "stretch", "wake"];
/** A spread of creatures: one of each kind, and seeds with their eyes high and low. */
const WAKERS = [...KINDS, ...Array.from({ length: 120 }, (_, i) => makeSprite(`w${i}`))];

test("an idle or finished agent starting work plays a stretch: to working from any status but blocked, in steps that end", () => {
  const { from, to, first, steps } = TURNS.stretch;
  assert.deepEqual([from, to, first], [null, "working", "yawn"]);
  const kinds = Object.keys(TURNS);
  assert.ok(kinds.indexOf("douse") < kinds.indexOf("stretch"), "the douse comes first, so blocked to working still puts the fire out");
  assert.deepEqual(steps.map(([, step]) => step), ["stretch", "wake", null]);
  assert.ok(steps.every(([ms], i) => i === 0 || ms > steps[i - 1][0]), "each step after the last");
  assert.ok(steps.at(-1)[0] >= 1200 && steps.at(-1)[0] <= 2000, "slow enough to follow, short enough not to hold up the work");
});

test("a stretch: the creature yawns with its eyes shut, reaches up a cell, and drops back with its eyes open", () => {
  const ink = "#16141f";
  for (const sprite of WAKERS) {
    const { body, eyes } = sprite.parts;
    const on = (x, y) => body.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const torso = (el) => walk(el).find((n) => n.id === "s-stretch-1-body");
    const [yawn, reach, wake] = STRETCH_STEPS.map((step) => stretched(sprite, step));
    for (const el of [yawn, reach, wake]) check(el);
    // The torso holds the body, then the eyes: the eyes it draws are the step's.
    const eyesOf = (el) => nodeOf(torso(el).children[1]).children.map((c) => `${last(nodeOf(c), "left") / 3},${last(nodeOf(c), "top") / 3}`);
    const cells = (mood) => eyes[mood].map((r) => `${r.x},${r.y}`);

    // Yawning: it slumps a little, eyes shut, its mouth open under them, on its body only.
    assert.ok(last(torso(yawn), "top") > 0, `${sprite.kind}: it slumps`);
    assert.deepEqual(eyesOf(yawn), cells("closed"), `${sprite.kind}: eyes shut`);
    const mouth = walk(yawn).find((n) => n.id === "s-stretch-1-mouth");
    assert.ok(mouth, `${sprite.kind}: a mouth`);
    for (const n of walk(mouth).filter((n) => calls(n, "bg").length)) {
      assert.equal(last(n, "bg"), ink);
      const x = last(n, "left") / 3;
      const y = last(n, "top") / 3;
      assert.ok(on(x, y), `${sprite.kind}: the mouth at ${x},${y} is on the body`);
      assert.ok(!eyes.open.some((r) => r.x === x && r.y === y), "and not on an eye");
    }

    // Stretching: the mouth shuts and the body reaches up a cell, slowing, over its feet.
    assert.equal(last(torso(reach), "top"), -3, `${sprite.kind}: up a cell`);
    assert.equal(Object.fromEntries(calls(torso(reach), "transition")).top.easing, "ease-out");
    assert.deepEqual(eyesOf(reach), cells("closed"));
    assert.ok(!walk(reach).some((n) => n.id === "s-stretch-1-mouth"), "the mouth shuts");

    // Woken: back in place with open eyes, the creature as it stands still, ticks behind it.
    assert.equal(last(torso(wake), "top"), 0);
    assert.deepEqual(eyesOf(wake), cells("open"), `${sprite.kind}: eyes popped open`);
    const plain = still(sprite.seed);
    const board = raster(stretched(sprite, "wake", { px: 1 }));
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (plain[y][x] !== null) assert.equal(board[y][x], plain[y][x], `${sprite.kind}: ${x},${y} as it stands`);
        else assert.ok(board[y][x] === null || board[y][x] === theme().foreground, `${sprite.kind}: ${x},${y} empty or a tick`);
      }
    }

    // Every step stays in the box: `raster` fails on anything outside it.
    for (const step of STRETCH_STEPS) raster(stretched(sprite, step, { px: 1 }));
  }
});

test("a stretch is one move, not a loop: nothing of the creature's work or rest shows until it is over", () => {
  for (const sprite of KINDS) {
    for (const step of STRETCH_STEPS) {
      const nodes = walk(stretched(sprite, step));
      assert.ok(nodes.every((n) => calls(n, "loop").length === 0), `${sprite.kind} ${step}: nothing loops`);
      assert.ok(!nodes.some((n) => calls(n, "bg").some(([c]) => [theme().working, theme().idle, theme().done].includes(c))), `${step}: no status cue`);
      for (const node of nodes) if (node.id !== null && node !== nodes[0]) assert.ok(node.id.startsWith("s-stretch-1-"), node.id);
    }
  }
});

/** A creature startled into a block, at one step of the jolt. */
const jolted = (sprite, step, { px = 3, n = 1 } = {}) => spriteElement(sprite, { id: "s", px, status: "blocked", turn: { kind: "jolt", n, step } });
const JOLT_STEPS = ["jump", "land", "catch"];

test("an agent becoming blocked plays a jolt: to blocked from any status, the only turn that does, in steps that end soon", () => {
  const { from, to, first, steps, eyes } = TURNS.jolt;
  assert.deepEqual([from, to, first, eyes], [null, "blocked", "jump", "open"]);
  assert.deepEqual(Object.keys(TURNS).filter((k) => TURNS[k].to === "blocked" || TURNS[k].to === null), ["jolt"]);
  assert.deepEqual(steps.map(([, step]) => step), ["land", "catch", null]);
  assert.ok(steps.every(([ms], i) => i === 0 || ms > steps[i - 1][0]), "each step after the last");
  assert.ok(steps.at(-1)[0] >= 600 && steps.at(-1)[0] <= 1200, "long enough to see, short enough to show the block soon");
});

test("a jolt: the creature jumps up a cell at once, drops back, and the fire catches at its feet", () => {
  for (const sprite of KINDS) {
    const [jump, land, catching] = JOLT_STEPS.map((step) => jolted(sprite, step));
    for (const el of [jump, land, catching]) check(el);
    const part = (el, name) => walk(el).find((n) => n.id === `s-jolt-1-${name}`);
    const moving = ["left", "right", "body"];

    // Jumped: feet and body a cell up, over dashes on the floor it left; the fire not there yet.
    for (const name of moving) assert.equal(last(part(jump, name), "top"), -3, `${sprite.kind}: the ${name} jumps a cell`);
    assert.ok(part(jump, "lift"), "dashes where it jumped from");
    for (const name of ["fire", "embers"]) assert.equal(last(part(jump, name), "opacity"), 0, `no ${name} yet`);

    // Landed: back in place, faster as it falls, and still no fire.
    for (const name of moving) {
      assert.equal(last(part(land, name), "top"), 0, `${sprite.kind}: the ${name} lands`);
      assert.equal(Object.fromEntries(calls(part(land, name), "transition")).top.easing, "ease-in");
    }
    assert.ok(!part(land, "lift"));
    for (const name of ["fire", "embers"]) assert.equal(last(part(land, name), "opacity"), 0);

    // Caught: the fire fades in, its bed at the creature's feet, the creature in place.
    for (const name of ["fire", "embers"]) {
      assert.equal(last(part(catching, name), "opacity"), 1, `the ${name} catches`);
      assert.ok(Object.fromEntries(calls(part(catching, name), "transition")).opacity.duration > 0, "fading in, not at once");
    }
    const flames = new Set(Object.values(FIRE));
    const board = raster(jolted(sprite, "catch", { px: 1 }));
    assert.ok(board[GRID - 1].slice(1, GRID - 1).every((c) => flames.has(c)), `${sprite.kind}: the bed at its feet`);
    for (const name of moving) assert.equal(last(part(catching, name), "top"), 0);

    // Every step stays in the box, a cell up too: `raster` fails on anything outside it.
    for (const step of JOLT_STEPS) raster(jolted(sprite, step, { px: 1 }));
  }
});

test("a jolt draws no badge and no \"!\": the blocked look brings its one badge when it is over", () => {
  const badges = (el) => walk(el).filter((n) => calls(n, "bg").some(([c]) => c === theme().blocked)).length;
  for (const sprite of KINDS) {
    for (const step of JOLT_STEPS) {
      const nodes = walk(jolted(sprite, step));
      assert.equal(badges(jolted(sprite, step)), 0, `${sprite.kind} ${step}: no badge yet`);
      // Only the fire moves: the creature's own parts hold still but for the jump.
      const fire = new Set(nodes.filter((n) => n.id === "s-jolt-1-fire" || n.id === "s-jolt-1-embers").flatMap((n) => walk(n)));
      assert.ok(nodes.filter((n) => !fire.has(n)).every((n) => calls(n, "loop").length === 0), `${step}: nothing else loops`);
      for (const node of nodes) if (node.id !== null && node !== nodes[0]) assert.ok(node.id.startsWith("s-jolt-1-"), node.id);
    }
    assert.equal(badges(spriteElement(sprite, { id: "s", status: "blocked" })), 1, "the blocked look has the badge");
  }
});

test("a turn is given the creature's parts and moves them as a way of working does", () => {
  const sprite = makeSprite("t1");
  TURNS.jig = { from: null, to: null, first: "up", steps: [[100, null]], eyes: "closed",
    build: ({ torso, nudge, id, step }) => (torso.loop("top", { from: 0, to: -nudge, period: 200 }), { behind: [], front: [div().id(`${id}-${step}`)] }) };
  try {
    const el = spriteElement(sprite, { id: "s", px: 3, status: "blocked", turn: { kind: "jig", n: 4, step: "up" } });
    const nodes = check(el);
    assert.ok(nodes.some((n) => n.id === "s-jig-4-up"), "its id and step");
    const torso = nodeOf(nodeOf(nodeOf(el).children[0]).children[2]);
    assert.deepEqual(calls(torso, "loop"), [["top", { from: 0, to: -1, period: 200 }]], "the torso moves");
    assert.ok(!nodes.some((n) => calls(n, "bg").some(([c]) => Object.values(FIRE).includes(c))), "in place of the status's look");
  } finally {
    delete TURNS.jig;
  }
});

test("a creature seen from each side: its front in open eyes, its back without, edge-on a third as wide with the near eye", () => {
  /** @type {(rects: object[]) => Set<string>} */
  const keys = (rects) => new Set(rects.map(({ x, y, w, h, color }) => [x, y, w, h, color].join(",")));
  const mirror = (rects) => rects.map((r) => ({ ...r, x: GRID * 3 - r.x - r.w }));
  const width = (rects) => Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x));
  for (const seed of SEEDS) {
    const sprite = makeSprite(seed);
    const [front, left, back, right] = ["front", "left", "back", "right"].map((face) => faceRects(sprite, face));
    const { body, feet, eyes } = sprite.parts;
    assert.equal(front.length, body.length + feet[0].length + feet[1].length + eyes.open.length, seed);
    assert.ok([...keys(back)].every((k) => keys(front).has(k)) && back.length === front.length - eyes.open.length, `${seed}: the back is the front without its eyes`);
    assert.ok(width(left) * 3 === width(front) && width(right) === width(left), `${seed}: edge-on, a third as wide`);
    const [l, r] = [keys(left), keys(right)];
    assert.ok([...l].some((k) => !r.has(k)), `${seed}: turned left and right differ`);
    assert.deepEqual(keys(mirror(left)), r, `${seed}: each shows the eye on its own side`);
    for (const rect of [...front, ...left]) {
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= GRID * 3 && rect.y + rect.h <= GRID * 3, `${seed}: inside the box`);
      assert.match(rect.color, HEX);
    }
  }
  assert.ok(faceRects(makeSprite("t1"), "left", 6).every((r) => Number.isInteger(r.x) && r.w >= 2), "px follows the size");
});

/** A creature that just finished, at one step of its cheer. */
const cheered = (sprite, step, { px = 3, n = 1 } = {}) => spriteElement(sprite, { id: "s", px, status: "done", turn: { kind: "cheer", n, step } });
const CHEER_STEPS = ["pop", "burst", "fall"];
/** The bits of confetti in a cheer, by id. */
const bitsOf = (el) => walk(el).filter((n) => /^s-cheer-\d+-bit-\d+$/.test(n.id ?? ""));

test("an agent that finishes plays a cheer: from working to done, in steps that end before a calm-down would", () => {
  const { from, to, first, steps, eyes } = TURNS.cheer;
  assert.deepEqual([from, to, first, eyes], ["working", "done", "pop", "happy"]);
  assert.deepEqual(steps.map(([, step]) => step), ["burst", "fall", null]);
  assert.ok(steps.every(([ms], i) => i === 0 || ms > steps[i - 1][0]), "each step after the last");
  assert.ok(steps.at(-1)[0] >= 1000 && steps.at(-1)[0] <= 2000, "slow enough to see, over in under two seconds");
});

test("a cheer: confetti bursts out from behind the creature, flies to the top and the edges, then falls and fades", () => {
  for (const sprite of KINDS) {
    const [pop, burst, fall] = CHEER_STEPS.map((step) => cheered(sprite, step));
    for (const el of [pop, burst, fall]) check(el);
    const ids = (el) => bitsOf(el).map((n) => n.id);
    assert.ok(ids(pop).length >= 6, "a burst of bits");
    assert.deepEqual(ids(burst), ids(pop), "each bit keeps its id, so it eases from step to step");
    assert.deepEqual(ids(fall), ids(pop));

    // Each bit is drawn behind the creature, so it never covers a face.
    assert.deepEqual(nodeOf(pop).children.slice(0, bitsOf(pop).length).map(nodeOf), bitsOf(pop), "behind");

    for (const [i, bit] of bitsOf(pop).entries()) {
      const b = bitsOf(burst)[i];
      const f = bitsOf(fall)[i];
      assert.equal(last(bit, "opacity"), 0, "popped: unseen");
      assert.ok(last(bit, "left") !== 0 || last(bit, "top") !== 0, "popped: gathered where it bursts from");
      assert.deepEqual([last(b, "left"), last(b, "top"), last(b, "opacity")], [0, 0, 1], "burst: out where it lands");
      assert.equal(Object.fromEntries(calls(b, "transition")).top.easing, "ease-out", "slowing as it flies");
      assert.ok(last(f, "top") > 0, "fallen: it drifts down");
      assert.equal(last(f, "opacity"), 0, "and fades");
      assert.equal(Object.fromEntries(calls(f, "transition")).top.easing, "ease-in", "faster as it falls");
    }

    // Landed, the confetti shows at the top and the edges, where the art leaves room.
    const board = raster(cheered(sprite, "burst", { px: 1 }));
    const confetti = new Set(Object.values(CONFETTI));
    assert.ok(board.flat().filter((c) => confetti.has(c)).length >= 6, `${sprite.kind}: the confetti shows`);
    // Every step stays in the box: `raster` fails on anything outside it.
    for (const step of CHEER_STEPS) raster(cheered(sprite, step, { px: 1 }));
  }
});

test("a cheer hops the creature with happy eyes, in confetti of its own colors, with no done sparkles yet", () => {
  const taken = new Set([...Object.values(HIT), ...Object.values(FIRE), ...Object.values(DOUSE), theme().blocked, theme().done, theme().idle, theme().working].map((c) => c.toLowerCase()));
  for (const c of Object.values(CONFETTI)) assert.ok(!taken.has(c.toLowerCase()), `${c} means something else`);
  /** A layer's rectangles at 1 px a cell. */
  const rects = (node) => node.children.map((c) => nodeOf(c)).map((n) => [last(n, "left"), last(n, "top"), last(n, "w"), last(n, "h"), last(n, "bg")]);
  for (const sprite of KINDS) {
    for (const step of CHEER_STEPS) {
      const el = cheered(sprite, step, { px: 1 });
      const nodes = walk(el);
      const happy = sprite.parts.eyes.happy.map((r) => [r.x, r.y, r.w, r.h, r.color]);
      assert.ok(nodes.some((n) => n.children.length === happy.length && JSON.stringify(rects(n)) === JSON.stringify(happy)), `${step}: happy eyes`);
      const hops = nodes.flatMap((n) => calls(n, "loop")).filter(([p]) => p === "top");
      assert.ok(hops.length >= 3 && hops.every(([, { from, to, period }]) => from === 0 && to === -1 && period === 700), `${step}: it hops as done does`);
      assert.ok(!nodes.some((n) => calls(n, "bg").some(([c]) => c === theme().done)), `${step}: the done sparkles wait until it is over`);
      const colors = bitsOf(el).flatMap((n) => walk(n)).flatMap((n) => calls(n, "bg").map(([c]) => c));
      assert.ok(colors.length && colors.every((c) => Object.values(CONFETTI).includes(c)), "confetti in CONFETTI's colors");
      for (const node of nodes) if (node.id !== null && node !== nodes[0]) assert.ok(node.id.startsWith("s-"), node.id);
    }
  }
  assert.ok(walk(cheered(makeSprite("t1"), "pop", { n: 7 })).some((n) => n.id === "s-cheer-7-bit-0"), "a new cheer has new ids");
});

// ---- facing a way ----

const FACES = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/** The rectangles with left and right swapped: it glances the other way from them. */
const mirror = (rects) => rects.map((r) => ({ ...r, x: GRID - r.x - r.w }));
/**
 * Where eyes' pupils sit against the open eyes' (moved by dx cells): above 0 to screen
 * right, below 0 to left. The pupils are the dark cells; white ones fill round and big boxes.
 */
const glance = (rects, open, dx = 0) => {
  const pupils = (rs) => rs.reduce((s, r) => (r.color === "#ffffff" ? s : s + (r.x + r.w / 2) * r.w * r.h), 0);
  return pupils(rects) - pupils(open.map((r) => ({ ...r, x: r.x + dx })));
};
/** The glancing eyes that look toward dx: "look" or its mirror. Pip eyes' "look" glances left. */
const toward = ({ open, look }, dx) => (Math.sign(glance(look, open)) === dx ? look : mirror(look));
/** Rectangles painted on an empty GRID by GRID board, moved by (dx, dy) cells. */
function painted(rects, dx = 0, dy = 0) {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) board[y + dy][x + dx] = r.color;
  return board;
}

test("facing a way, a still creature steps a cell that way, and to a side its eyes look that way", () => {
  for (const seed of SEEDS) {
    const sprite = makeSprite(seed);
    const { body, feet, eyes } = sprite.parts;
    const gaze = { left: toward(eyes, -1), right: toward(eyes, 1), up: eyes.open, down: eyes.open };
    for (const [face, [dx, dy]] of Object.entries(FACES)) {
      const frame = raster(spriteElement(sprite, { id: "s", px: 1, face }));
      assert.deepEqual(frame, painted([...body, ...feet[0], ...feet[1], ...gaze[face]], dx, dy), `${seed}: facing ${face}`);
    }
    assert.deepEqual(raster(spriteElement(sprite, { id: "s", px: 1, face: null })), still(seed), "null faces out");
  }
});

test("facing a side, the eyes a creature draws look that way, pip eyes too", () => {
  let pips = 0;
  for (let i = 0; i < 64; i++) {
    const sprite = makeSprite(`t${i}`);
    const { open, look } = sprite.parts.eyes;
    if (glance(look, open) < 0) pips++;
    for (const status of [null, "blocked"]) {
      for (const [face, dx] of [["left", -1], ["right", 1]]) {
        // Step layer, figure, torso, then the torso's eye layer: its rectangles, in cells.
        const step = nodeOf(nodeOf(spriteElement(sprite, { id: "s", px: 1, status, face })).children[0]);
        const torso = nodeOf(step.children.find((c) => nodeOf(c).children.length === 3)).children[2];
        const drawn = nodeOf(nodeOf(torso).children[1]).children.map((c) => {
          const [x, y, w, h, color] = ["left", "top", "w", "h", "bg"].map((k) => last(nodeOf(c), k));
          return { x: x + dx, y, w, h, color };
        });
        assert.equal(Math.sign(glance(drawn, open, dx)), dx, `t${i} (${status}) facing ${face}: its eyes look the other way`);
      }
    }
  }
  assert.ok(pips > 0, "some creatures' own glance is to the left");
});

test("facing a way, everything the sprite draws steps as one, and happy and closed eyes stay", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const sprite = makeSprite(seed);
    for (const status of STATUSES) {
      const out = nodeOf(spriteElement(sprite, { id: "s", status })).children;
      for (const [face, [dx, dy]] of Object.entries(FACES)) {
        const faced = nodeOf(spriteElement(sprite, { id: "s", status, face })).children;
        assert.equal(faced.length, 1, `${status} facing ${face}: one step layer`);
        const step = nodeOf(faced[0]);
        assert.deepEqual([calls(step, "left"), calls(step, "top")], [[[dx * 3]], [[dy * 3]]], `${status} steps ${face}`);
        assert.equal(step.children.length, out.length);
        // Happy and closed eyes are the status's cue, and up or down no eyes change: the
        // same drawing, a cell over.
        if (status === "done" || status === "idle" || !dx) {
          step.children.forEach((c, i) => assert.equal(tree(c), tree(out[i]), `${seed}: ${status} facing ${face}`));
        }
      }
    }
  }
});

test("a way of working facing a side has one gaze: every copy of the eyes looks that way", () => {
  const px = 3;
  /** A layer's rectangles in cells, as the view draws them. */
  const rectsOf = (node) => node.children.map((c) => {
    const [x, y, w, h, color] = ["left", "top", "w", "h", "bg"].map((k) => last(nodeOf(c), k));
    return JSON.stringify({ x: x / px, y: y / px, w: w / px, h: h / px, color });
  });
  const set = (rects) => new Set(rects.map((r) => JSON.stringify({ x: r.x, y: r.y, w: r.w, h: r.h, color: r.color })));
  let copies = 0;
  for (let i = 0; i < 100; i++) {
    const sprite = makeSprite(`t${i}`);
    const { eyes } = sprite.parts;
    const any = new Set([...set(eyes.open), ...set(eyes.look), ...set(mirror(eyes.look))]);
    for (const [face, want] of [["left", set(toward(eyes, -1))], ["right", set(toward(eyes, 1))]]) {
      for (const work of WORKS) {
        const nodes = walk(spriteElement(sprite, { id: "s", px, status: "working", work, face }));
        // A layer of eyes: rectangles all of which are eyes in some mood.
        const layers = nodes.map(rectsOf).filter((rs) => rs.length && rs.every((r) => any.has(r)));
        assert.ok(layers.length >= 1, `${work}: draws eyes`);
        for (const rs of layers) for (const r of rs) assert.ok(want.has(r), `${work} on t${i} facing ${face}: an eye looks the other way at ${r}`);
        copies += layers.length - 1;
      }
    }
  }
  assert.ok(copies > 0, "some ways draw the eyes again");
});
