// Swaps: an agent that gets a new creature (its pixel.avatar label changes, by the picker, a
// key command or `hc label`) swaps it in its cell: the old creature shrinks a pixel size at a
// time into a puff of smoke, and the new one pops out of it, small, and grows back.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

const last = (node, name) => calls(node, name).at(-1)?.[0];
const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const swapOf = (tree, address) => walk(tree).find((n) => /^pp-swap-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-swap-${address}-`)) ?? null;
const trickOf = (tree, address) => walk(tree).find((n) => /^pp-trick-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-trick-${address}-`)) ?? null;
const exitOf = (tree, address) => walk(tree).find((n) => /^pp-exit-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-exit-${address}-`)) ?? null;
const clouds = (node) => walk(node).filter((n) => /-cloud-\d+$/.test(n.id ?? ""));
const sprite = (tree, address) => find(tree, `pp-spr-${address}`);
const colors = (node) => walk(node).flatMap((n) => calls(n, "bg").map(([c]) => c));
const sizeOf = (tree, address) => last(sprite(tree, address), "size");
const label = (address, value) => {
  mock.state.terminals = mock.state.terminals.map((x) => (x.address === address ? { ...x, labels: { ...x.labels, "pixel.avatar": value } } : x));
};
/** The colors a creature of this seed draws with: a fresh drawer's first draw, which plays nothing. */
const creature = (address, seed) => {
  const saved = mock.state.terminals;
  label(address, seed);
  const out = colors(sprite(new Drawer().render(context()), address));
  mock.state.terminals = saved;
  return out;
};

/** The px a node's left and top add up to, from the root of `tree`, or null outside it. */
function placeOf(tree, target) {
  const visit = (node, x, y) => {
    const nx = x + (last(node, "left") ?? 0);
    const ny = y + (last(node, "top") ?? 0);
    if (node === target) return [nx, ny];
    for (const child of node.children) {
      const found = typeof child === "object" && visit(walk(child)[0], nx, ny);
      if (found) return found;
    }
    return null;
  };
  return visit(walk(tree)[0], 0, 0);
}

beforeEach(() => mock.reset());

test("a new creature: the old one shrinks into a puff and the new one pops out of it and grows", () => {
  mock.agent("t1");
  mock.agent("t2");
  label("t1", "knight7");
  const old = creature("t1", "knight7");
  const now = creature("t1", "wizard");
  assert.notDeepEqual(old, now, "the two seeds draw different creatures");
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.equal(swapOf(tree, "t1"), null, "no swap on the first draw");
  assert.equal(sizeOf(tree, "t1"), 36);

  label("t1", "wizard");
  tree = draw(drawer, cx);
  assert.equal(swapOf(tree, "t2"), null, "the other agent swaps nothing");
  assert.equal(trickOf(tree, "t1"), null, "a swap is no arrival");
  assert.deepEqual(colors(sprite(tree, "t1")), old, "shrink: still the old creature");
  assert.equal(sizeOf(tree, "t1"), 24, "shrink: a pixel size smaller");
  assert.equal(swapOf(tree, "t1"), null, "no puff yet");

  cx.run(100);
  tree = draw(drawer, cx);
  assert.deepEqual(colors(sprite(tree, "t1")), old, "small: still the old creature");
  assert.equal(sizeOf(tree, "t1"), 12, "small: smaller again");

  cx.run(200);
  tree = draw(drawer, cx);
  const gathered = clouds(swapOf(tree, "t1"));
  assert.ok(gathered.length >= 3 && gathered.every((n) => last(n, "opacity") === 1), "poof: the puff is up");
  assert.equal(last(sprite(tree, "t1"), "opacity"), 0, "poof: the creature is gone into it");

  cx.run(450);
  tree = draw(drawer, cx);
  assert.deepEqual(colors(sprite(tree, "t1")), now, "pop: the new creature");
  assert.equal(last(sprite(tree, "t1"), "opacity"), 1, "pop: it is out");
  assert.equal(sizeOf(tree, "t1"), 12, "pop: small");
  const cleared = clouds(swapOf(tree, "t1"));
  assert.ok(cleared.every((n) => last(n, "opacity") === 0), "pop: the puff clears");
  assert.deepEqual(cleared.map((n) => n.id), gathered.map((n) => n.id), "the same clouds, so they drift rather than jump");

  cx.run(550);
  assert.equal(sizeOf(draw(drawer, cx), "t1"), 24, "grow");
  cx.run(650);
  tree = draw(drawer, cx);
  assert.equal(sizeOf(tree, "t1"), 36, "out: full size");
  assert.deepEqual(colors(sprite(tree, "t1")), now);
  // Everything the swap draws stays inside the 48 by 44 cell: Herdr clips the rest.
  for (const node of walk(swapOf(tree, "t1")).filter((n) => last(n, "bg"))) {
    const [x, y] = placeOf(find(tree, "pp-box-t1"), node);
    const [w, h] = [last(node, "w") ?? last(node, "size"), last(node, "h") ?? last(node, "size")];
    assert.ok(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 44, `${node.id ?? "a pixel"} at ${x},${y} ${w}x${h} is outside the cell`);
  }

  cx.run(1100);
  tree = draw(drawer, cx);
  assert.equal(swapOf(tree, "t1"), null, "the swap is over");
  assert.equal(sizeOf(tree, "t1"), 36);
  assert.deepEqual(colors(sprite(tree, "t1")), now);
  assert.equal(swapOf(draw(drawer, cx), "t1"), null, "a redraw plays no other");
});

test("reroll and reset from the keys swap the creature, and the row still answers clicks", () => {
  mock.agent("t1");
  mock.state.focused = { space: "sp1", tab: "tb1", pane: "p-t1", terminal: "t1", shown: null, agent: "t1", cwd: null };
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  drawer.command("reroll", cx);
  let tree = draw(drawer, cx);
  assert.ok(sizeOf(tree, "t1") < 36, "a reroll swaps");
  assert.deepEqual(Object.keys(find(tree, "pp-row-t1").handlers).sort(), ["on_click", "on_mouse_down:right"], "the row still clicks and opens the picker");
  cx.run(1100);
  draw(drawer, cx);

  drawer.command("reset", cx);
  assert.ok(sizeOf(draw(drawer, cx), "t1") < 36, "a reset swaps back");
  cx.run(1100);
  draw(drawer, cx);
  drawer.command("reset", cx);
  assert.equal(sizeOf(draw(drawer, cx), "t1"), 36, "a reset with no label to clear changes no creature, and swaps nothing");
});

test("a label that is no seed changes no creature, and swaps nothing", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "Not A Seed!");
  assert.equal(sizeOf(draw(drawer, cx), "t1"), 36);
});

test("a new seed while arriving plays only the arrival: its trick shows the new creature", () => {
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.agent("t1");
  assert.ok(trickOf(draw(drawer, cx), "t1"));
  label("t1", "wizard");
  const tree = draw(drawer, cx);
  assert.ok(trickOf(tree, "t1"), "the trick goes on");
  assert.equal(swapOf(tree, "t1"), null, "no swap besides");
  assert.equal(sizeOf(tree, "t1"), 36);
  assert.deepEqual(colors(sprite(tree, "t1")), creature("t1", "wizard"));
});

test("a second new seed mid-swap starts over, from the creature drawn last, and lands on the last seed", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "knight7");
  draw(drawer, cx);
  cx.run(450);
  const first = swapOf(draw(drawer, cx), "t1");
  label("t1", "wizard");
  let tree = draw(drawer, cx);
  assert.equal(sizeOf(tree, "t1"), 24, "the new swap starts at its first step");
  assert.deepEqual(colors(sprite(tree, "t1")), creature("t1", "knight7"), "it shrinks the creature it just drew");
  cx.run(200);
  tree = draw(drawer, cx);
  assert.notEqual(swapOf(tree, "t1").id, first.id, "a new swap gets new ids");
  cx.run(1100);
  tree = draw(drawer, cx);
  assert.equal(swapOf(tree, "t1"), null);
  assert.deepEqual(colors(sprite(tree, "t1")), creature("t1", "wizard"));
});

test("a second new seed before the pop shrinks on from the old creature, never the one between", () => {
  mock.agent("t1");
  label("t1", "knight7");
  const old = creature("t1", "knight7");
  const between = creature("t1", "wizard");
  const end = creature("t1", "dragon3");
  assert.notDeepEqual(old, between);
  assert.notDeepEqual(between, end);
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "wizard");
  assert.deepEqual(colors(sprite(draw(drawer, cx), "t1")), old);
  cx.run(50);
  label("t1", "dragon3");
  let tree = draw(drawer, cx);
  assert.equal(sizeOf(tree, "t1"), 24, "the new swap starts at its first step");
  assert.deepEqual(colors(sprite(tree, "t1")), old, "shrink: still the old creature");
  cx.run(100);
  assert.deepEqual(colors(sprite(draw(drawer, cx), "t1")), old, "small: still the old creature");
  cx.run(450);
  assert.deepEqual(colors(sprite(draw(drawer, cx), "t1")), end, "pop: the last seed's creature");
  cx.run(1100);
  tree = draw(drawer, cx);
  assert.equal(swapOf(tree, "t1"), null);
  assert.deepEqual(colors(sprite(tree, "t1")), end);
});

test("an agent that leaves mid-swap only leaves", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "knight7");
  draw(drawer, cx);
  mock.state.agents = [];
  mock.state.terminals = [];
  const tree = draw(drawer, cx);
  assert.ok(exitOf(tree, "t1"), "it leaves by its exit");
  assert.equal(swapOf(tree, "t1"), null, "with no swap");
  assert.equal(sizeOf(tree, "t1"), 36, "its creature at full size");
});
