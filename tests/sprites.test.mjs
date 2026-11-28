// Sprites: a seed always draws the same creature, inside its box, in hex colors, and the
// view gives every agent status its own look, in a single frame as well as in motion.

import assert from "node:assert/strict";
import { test } from "node:test";
import { theme } from "herdr";
import { div } from "gpui-kit";
import { GRID, hashSeed, makeSprite, randomSeed } from "../mods/pixel-party/sprites.js";
import { DOUSE, FIRE, HIT, TURNS, WORKS, ownWork, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, nodeOf, walk } from "./mocks/gpui.mjs";

const STATUSES = [null, "working", "blocked", "done", "idle"];
const SEEDS = ["", "t1", "t7", "vps/t3", "knight7", "abc123", "-", "a".repeat(200), "🐙 ünïcode", ...Array.from({ length: 64 }, (_, i) => `t${i}`)];
const HEX = /^#[0-9a-f]{6}$/;

const last = (node, name) => calls(node, name).at(-1)?.[0];

/**
 * The still frame of an element drawn at 1 px per cell, as a GRID by GRID board of colors
 * (null where nothing is drawn). Loops are ignored: this is the pose before motion.
 * Fails if anything is drawn outside the box.
 */
function raster(el) {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  const paint = (child, ox, oy) => {
    const node = nodeOf(child);
    if (!node) return;
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

test("there are eleven ways of working, walk among them, and the test covers every kind", () => {
  assert.deepEqual([...WORKS].sort(), ["building", "git", "hammering", "installing", "reading", "searching", "signal", "testing", "thinking", "typing", "walk"]);
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

test("no way of working hides the creature's eyes: a prop over a low face draws them again, bobbing with it", () => {
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
      const el = working(sprite, work, px);
      // The eyes this way draws: the torso's eye layer, its last child.
      const torso = nodeOf(nodeOf(el).children.find((c) => nodeOf(c).children.length === 3)).children[2];
      const eyes = nodeOf(nodeOf(torso).children[1]).children.map((c) => nodeOf(c));
      const b = board(el);
      for (const e of eyes) {
        const [x, y, w, h, color] = ["left", "top", "w", "h", "bg"].map((k) => last(e, k));
        for (let j = y; j < y + h; j++) for (let k = x; k < x + w; k++) assert.equal(b[j][k], color, `${work} hides an eye of t${i} (${sprite.kind}) at ${k},${j}`);
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
