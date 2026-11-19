// Arrivals: a new agent appears in the drawer by a magic trick, and a new helper's bee flies
// out of a puff of smoke. What was there when the drawer first drew gets neither.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { calls, check, context, find, text, walk } from "./mocks/gpui.mjs";

const last = (node, name) => calls(node, name).at(-1)?.[0];
const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const trickOf = (tree, address) => walk(tree).find((n) => /^pp-trick-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-trick-${address}-`)) ?? null;
const puffOf = (tree, address) => walk(tree).find((n) => /^pp-puff-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-puff-${address}-`)) ?? null;
const clouds = (node) => walk(node).filter((n) => /-cloud-\d+$/.test(n.id ?? ""));
const sprite = (tree, address) => find(tree, `pp-spr-${address}`);

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

test("the agents there at the first draw get no trick, and an agent that comes later does", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.equal(trickOf(tree, "t1"), null);
  assert.ok(!text(tree).includes("Abracadabra!"));

  mock.agent("t2", { status: "working" });
  tree = draw(drawer, cx);
  assert.equal(trickOf(tree, "t1"), null, "an agent already there gets no trick");
  assert.ok(trickOf(tree, "t2"), "a new agent arrives by a trick");
  assert.ok(text(tree).includes("Abracadabra!"), "its status line says the word");
  assert.equal(last(sprite(tree, "t2"), "opacity"), 0, "the creature is not there yet");
});

test("the trick: the wand shows and taps, smoke goes up, and it clears to show the creature", () => {
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.agent("t1", { status: "working" });

  let tree = draw(drawer, cx);
  const wandAt = (tree) => find(tree, `${trickOf(tree, "t1").id}-wand`);
  assert.equal(last(wandAt(tree), "opacity"), 1, "wand: the wand shows");
  assert.equal(clouds(trickOf(tree, "t1")).length, 0, "no smoke yet");
  const raised = [last(wandAt(tree), "left"), last(wandAt(tree), "top")];

  cx.run(240);
  tree = draw(drawer, cx);
  const tapped = [last(wandAt(tree), "left"), last(wandAt(tree), "top")];
  assert.ok(tapped[0] < raised[0] && tapped[1] > raised[1], "tap: the wand dips toward the middle");

  cx.run(440);
  tree = draw(drawer, cx);
  assert.equal(last(wandAt(tree), "opacity"), 0, "poof: the wand fades");
  const gathered = clouds(trickOf(tree, "t1"));
  assert.ok(gathered.length >= 3 && gathered.every((n) => last(n, "opacity") === 1), "poof: the smoke is up");
  assert.equal(last(sprite(tree, "t1"), "opacity"), 0, "poof: the creature is still unseen");

  cx.run(760);
  tree = draw(drawer, cx);
  const cleared = clouds(trickOf(tree, "t1"));
  assert.ok(cleared.every((n) => last(n, "opacity") === 0), "reveal: the smoke fades");
  assert.deepEqual(cleared.map((n) => n.id), gathered.map((n) => n.id), "the same clouds, so they drift rather than jump");
  assert.equal(last(sprite(tree, "t1"), "opacity"), 1, "reveal: the creature fades in");
  assert.ok(calls(sprite(tree, "t1"), "transition").some(([p]) => p === "opacity"));
  // Everything the trick draws stays inside the 48 by 44 cell: Herdr clips the rest.
  for (const node of walk(trickOf(tree, "t1")).filter((n) => last(n, "bg"))) {
    const [x, y] = placeOf(tree, node);
    const [w, h] = [last(node, "w") ?? last(node, "size"), last(node, "h") ?? last(node, "size")];
    assert.ok(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 44, `${node.id ?? "a pixel"} at ${x},${y} ${w}x${h} is outside the cell`);
  }

  cx.run(1500);
  tree = draw(drawer, cx);
  assert.equal(trickOf(tree, "t1"), null, "the trick is over");
  assert.ok(!text(tree).includes("Abracadabra!"), "the status line is back");
  assert.equal(calls(sprite(tree, "t1"), "opacity").length, 0, "the creature is drawn as usual");
});

test("an agent that leaves and comes back arrives by a trick again, even when the drawer was empty", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.state.agents = [];
  draw(drawer, cx);
  mock.agent("t1");
  assert.ok(trickOf(draw(drawer, cx), "t1"));
});

test("a new creature for the same agent is no arrival: a reroll plays no trick", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.state.terminals[0].labels = { "pixel.avatar": "knight7" };
  assert.equal(trickOf(draw(drawer, cx), "t1"), null);
});

test("a new helper's bee flies out of a puff of smoke in the middle of the creature, once", () => {
  mock.agent("t1");
  mock.state.terminals.push({ address: "t3", parent: "t1", state: "live", labels: {} });
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.equal(puffOf(tree, "t1"), null, "helpers running at the first draw come out with no puff");
  cx.run(1000);

  mock.state.terminals.push({ address: "t4", parent: "t1", state: "live", labels: {} });
  tree = draw(drawer, cx);
  const puff = puffOf(tree, "t1");
  assert.ok(puff, "a new helper: a puff");
  assert.ok(clouds(puff).every((n) => last(n, "opacity") === 1), "gathered over the spot the bee leaves from");
  const middle = clouds(puff).at(-1);
  const [x, y] = placeOf(tree, middle);
  const d = last(middle, "size");
  assert.deepEqual([x + d / 2, y + d / 2], [24, 22], "centered on the creature's box");
  assert.equal(puffOf(draw(drawer, cx), "t1").id, puff.id, "drawn again before it flies, the same puff");

  cx.run(60);
  tree = draw(drawer, cx);
  assert.ok(clouds(puffOf(tree, "t1")).every((n) => last(n, "opacity") === 0), "it clears as the bee flies out");
  cx.run(800);
  tree = draw(drawer, cx);
  assert.equal(puffOf(tree, "t1"), null);

  mock.state.terminals.push({ address: "t5", parent: "t1", state: "live", labels: {} });
  assert.notEqual(puffOf(draw(drawer, cx), "t1")?.id ?? null, puff.id, "the next helper gets a puff of its own");
});
