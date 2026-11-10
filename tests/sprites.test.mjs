// Sprites: a seed always draws the same creature, inside its box, in hex colors, and the
// view gives every agent status its own look, in a single frame as well as in motion.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GRID, hashSeed, makeSprite, randomSeed } from "../mods/pixel-party/sprites.js";
import { spriteElement } from "../mods/pixel-party/sprite-view.js";
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
