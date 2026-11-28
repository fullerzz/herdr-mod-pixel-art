// Results: what an agent's hooks say a tool came to, in its terminal's `pixel.result` label,
// and the one-shot each plays. A failed command makes the creature cough black smoke; tests
// that passed get a thumbs up, and tests that failed make it drop its test tube.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

const last = (node, name) => calls(node, name).at(-1)?.[0];
const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const sootOf = (tree, address) => walk(tree).find((n) => /^pp-soot-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-soot-${address}-`)) ?? null;
const clouds = (node) => walk(node).filter((n) => /-cloud-\d+$/.test(n.id ?? ""));
const sprite = (tree, address) => find(tree, `pp-spr-${address}`);
const label = (address, value) => {
  const terminal = mock.state.terminals.find((x) => x.address === address);
  terminal.labels = value === null ? {} : { "pixel.result": value };
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

/** Every cloud of t1's smoke in `tree` is inside its 48 by 44 cell. */
function inCell(tree) {
  const clouds = walk(sootOf(tree, "t1")).filter((n) => last(n, "bg"));
  assert.ok(clouds.length);
  for (const node of clouds) {
    const [x, y] = placeOf(tree, node);
    const d = last(node, "size");
    assert.ok(x >= 0 && y >= 0 && x + d <= 48 && y + d <= 44, `${node.id} at ${x},${y} ${d}x${d} is outside the cell`);
  }
}

beforeEach(() => mock.reset());

test("a new result is reported on the next draw, once; the first draw, a new agent and a label taken away report none", () => {
  mock.agent("t1", { status: "working" });
  label("t1", "failed.100");
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [], "a label there before the drawer looked is old news");
  assert.equal(sootOf(tree, "t1"), null);

  label("t1", "failed.101");
  tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "failed" }]);
  assert.ok(sootOf(tree, "t1"), "a failed command: black smoke");
  draw(drawer, cx);
  assert.deepEqual(drawer.reports, [], "a redraw with nothing new reports nothing");

  label("t1", null);
  draw(drawer, cx);
  assert.deepEqual(drawer.reports, [], "a label taken away is no result");
  label("t1", "failed.102");
  draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "failed" }], "the next failure after it is");

  mock.agent("t2", { status: "working" });
  label("t2", "failed.103");
  draw(drawer, cx);
  assert.deepEqual(drawer.reports, [], "a new agent's label is older than the drawer's look at it");
});

test("a failed command: the creature coughs, and black smoke goes up from its face and clears, inside the cell", () => {
  mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  assert.equal(calls(sprite(draw(drawer, cx), "t1"), "top").length, 0, "no cough: the creature stands as usual");

  label("t1", "failed.200");
  let tree = draw(drawer, cx);
  const gathered = clouds(sootOf(tree, "t1"));
  assert.ok(gathered.length >= 3 && gathered.every((n) => last(n, "opacity") === 1), "cough: the smoke is out");
  assert.equal(walk(sootOf(tree, "t1")).filter((n) => /-spark-\d+$/.test(n.id ?? "")).length, 0, "no sparkles: it is no magic");
  const front = gathered.at(-1);
  assert.equal(last(front, "bg"), "#141418", "the smoke is black");
  assert.ok(gathered.some((n) => last(n, "bg") !== "#141418"), "with lighter clouds behind, for a dark theme");
  assert.equal(last(sprite(tree, "t1"), "top"), 2, "the creature lurches with the cough");
  const before = gathered.map((n) => placeOf(tree, n)[1]);

  cx.run(250);
  tree = draw(drawer, cx);
  const risen = clouds(sootOf(tree, "t1"));
  assert.deepEqual(risen.map((n) => n.id), gathered.map((n) => n.id), "the same clouds, so they drift rather than jump");
  assert.ok(risen.every((n) => last(n, "opacity") === 0), "rise: the smoke fades");
  const after = risen.map((n) => placeOf(tree, n)[1]);
  assert.ok(after.every((y, i) => y < before[i]), `rise: every cloud goes up (${before} to ${after})`);
  assert.equal(last(sprite(tree, "t1"), "top"), 0, "and the creature comes back up");
  assert.ok(calls(sprite(tree, "t1"), "transition").some(([p]) => p === "top"));
  // Herdr clips a floating mod to its frame: the smoke stays in the 48 by 44 cell.
  inCell(tree);

  cx.run(1000);
  tree = draw(drawer, cx);
  assert.equal(sootOf(tree, "t1"), null, "the smoke is gone");
  assert.equal(calls(sprite(tree, "t1"), "top").length, 0, "the creature is drawn as usual");
});

test("the gathered smoke stays in the cell too, and a second failure in a row starts over", () => {
  mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "failed.300");
  let tree = draw(drawer, cx);
  const first = sootOf(tree, "t1");
  inCell(tree);
  assert.equal(sootOf(draw(drawer, cx), "t1").id, first.id, "drawn again, the same smoke");

  cx.run(250);
  label("t1", "failed.301");
  tree = draw(drawer, cx);
  const second = sootOf(tree, "t1");
  assert.notEqual(second.id, first.id, "new ids: it starts over rather than easing on");
  assert.ok(clouds(second).every((n) => last(n, "opacity") === 1), "gathered again");
});

test("a result of another kind is reported but plays nothing yet, and a cough never moves the box", () => {
  mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "built.400");
  const tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "built" }]);
  assert.equal(sootOf(tree, "t1"), null);
  assert.equal(verdictOf(tree, "t1"), null);
  label("t1", "failed.401");
  assert.equal(calls(find(draw(drawer, cx), "pp-box-t1"), "top").length, 0, "the cough moves the creature, never the box");
});

// How tests came out. The creature is testing, so it holds its tube: glass over liquid in its
// two columns at the right edge. The 36 px sprite sits in the middle of its 48 by 44 cell, at
// 6, 4, so its tube is at 36..42 by 19..40 in the cell.
const GLASS = "#cfe3ea";
const verdictOf = (tree, address) => walk(tree).find((n) => new RegExp(`^pp-verdict-${address}-\\d+$`).test(n.id ?? "")) ?? null;
const testing = (address, result) => {
  const terminal = mock.state.terminals.find((x) => x.address === address);
  terminal.labels = { "pixel.work": "testing", ...(result ? { "pixel.result": result } : {}) };
};
const holdsTube = (tree, address) => walk(sprite(tree, address)).some((n) => last(n, "bg") === GLASS);
/** Every drawn pixel of the verdict in `tree`, as [x, y, w, h] in its cell. */
const pixelsOf = (tree, node) =>
  walk(node).filter((n) => last(n, "bg") && last(n, "w") !== undefined).map((n) => [...placeOf(tree, n), last(n, "w"), last(n, "h")]);
/** The layer of `node` that shows: the one with opacity 1. */
const shown = (node) => walk(node).filter((n) => /-(hold|tip|fall|spill)$/.test(n.id ?? "") && last(n, "opacity") === 1).map((n) => n.id.split("-").at(-1));
function inside(tree, node) {
  const px = pixelsOf(tree, node);
  assert.ok(px.length);
  for (const [x, y, w, h] of px) assert.ok(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 44, `a pixel at ${x},${y} ${w}x${h} is outside the cell`);
}

test("tests that passed: the creature puts its tube down and a thumbs up pops up beside it, holds and fades", () => {
  mock.agent("t1", { status: "working" });
  testing("t1", null);
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.ok(holdsTube(tree, "t1"), "testing, it holds its tube");

  testing("t1", "tests-passed.500");
  tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "tests-passed" }]);
  assert.equal(sootOf(tree, "t1"), null, "no smoke: nothing failed");
  let thumb = verdictOf(tree, "t1");
  assert.ok(thumb, "a thumbs up");
  assert.ok(!holdsTube(tree, "t1"), "its hand is free for it");
  assert.equal(last(thumb, "opacity"), 0, "unseen at first");
  const low = last(thumb, "top");
  inside(tree, thumb);

  cx.run(30);
  tree = draw(drawer, cx);
  thumb = verdictOf(tree, "t1");
  assert.equal(last(thumb, "opacity"), 1);
  assert.ok(last(thumb, "top") < low, "it pops up");
  assert.ok(calls(thumb, "transition").some(([p]) => p === "top"), "and moves there rather than jumps");
  const hand = walk(thumb).filter((n) => last(n, "bg") && last(n, "bg") !== "#101016").map((n) => [...placeOf(tree, n), last(n, "w")]);
  assert.equal(Math.max(...hand.map(([x, , w]) => x + w)), 42, "beside the creature's right, its edge where the tube's was");
  inside(tree, thumb);

  cx.run(1400);
  tree = draw(drawer, cx);
  assert.equal(last(verdictOf(tree, "t1"), "opacity"), 0, "it fades");
  cx.run(2000);
  tree = draw(drawer, cx);
  assert.equal(verdictOf(tree, "t1"), null, "and is gone");
  assert.ok(holdsTube(tree, "t1"), "the creature, still testing, holds its tube again");
});

test("tests that failed: the creature drops its tube, which tips over, lands on its side and spills, all inside the cell", () => {
  mock.agent("t1", { status: "working" });
  testing("t1", null);
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  testing("t1", "tests-failed.600");
  let tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "tests-failed" }]);
  assert.equal(sootOf(tree, "t1"), null, "failed tests drop the tube instead of coughing smoke");
  assert.equal(calls(sprite(tree, "t1"), "top").length, 0, "and the creature does not lurch");
  const drop = verdictOf(tree, "t1");
  assert.ok(drop);
  assert.ok(!holdsTube(tree, "t1"), "the tube has left the creature's hand");
  assert.deepEqual(shown(drop), ["hold"], "drawn first where the creature held it");
  const hold = find(drop, `${drop.id}-hold`);
  const glass = walk(hold).filter((n) => last(n, "bg") === GLASS).map((n) => [...placeOf(tree, n), last(n, "w")]);
  assert.deepEqual(glass, [[36, 19, 6], [36, 22, 6], [36, 25, 6]], "three rows of glass, just where the sprite's own tube stood");
  inside(tree, drop);

  /** @type {Record<string, number>} The lowest pixel of each frame, the outline aside. */
  const floor = {};
  for (const [ms, step] of [[80, "tip"], [180, "fall"], [480, "spill"]]) {
    cx.run(ms);
    tree = draw(drawer, cx);
    const now = verdictOf(tree, "t1");
    assert.equal(now.id, drop.id, "the same tube, frame after frame");
    assert.deepEqual(shown(now), [step], `at ${ms} ms`);
    assert.equal(last(now, "opacity"), 1);
    inside(tree, now);
    const frame = find(now, `${now.id}-${step}`);
    floor[step] = Math.max(...walk(frame).filter((n) => last(n, "bg") && last(n, "bg") !== "#101016").map((n) => placeOf(tree, n)[1] + last(n, "h")));
  }
  const fallen = find(verdictOf(tree, "t1"), `${drop.id}-fall`);
  const widths = walk(fallen).filter((n) => last(n, "bg") === GLASS).map((n) => last(n, "w"));
  assert.ok(widths.every((w) => w > 6), "on its side, the glass lies long");
  assert.ok(floor.fall > floor.tip, "it lands lower than it tipped");
  const spill = find(verdictOf(tree, "t1"), `${drop.id}-spill`);
  const puddle = walk(spill).filter((n) => last(n, "bg") === theme().accent);
  const [px] = puddle.map((n) => placeOf(tree, n));
  assert.ok(px && px[0] < 21, "the liquid runs out to the left of the tube's mouth");

  cx.run(1700);
  tree = draw(drawer, cx);
  assert.equal(last(verdictOf(tree, "t1"), "opacity"), 0, "it fades");
  assert.ok(calls(verdictOf(tree, "t1"), "transition").some(([p]) => p === "opacity"));
  cx.run(2300);
  tree = draw(drawer, cx);
  assert.equal(verdictOf(tree, "t1"), null, "and is gone");
  assert.ok(holdsTube(tree, "t1"), "a creature still testing holds a tube again");
});

test("the next tests start over, whatever came before, and a failed command still coughs", () => {
  mock.agent("t1", { status: "working" });
  testing("t1", null);
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  testing("t1", "tests-failed.700");
  const first = verdictOf(draw(drawer, cx), "t1");
  cx.run(180);
  testing("t1", "tests-passed.701");
  let tree = draw(drawer, cx);
  const second = verdictOf(tree, "t1");
  assert.notEqual(second.id, first.id, "new ids: it starts over");
  assert.equal(walk(tree).filter((n) => /^pp-verdict-/.test(n.id ?? "")).length, 1, "one verdict at a time");
  assert.equal(shown(second).length, 0, "a thumbs up now, not a tube");
  testing("t1", "failed.702");
  tree = draw(drawer, cx);
  assert.ok(sootOf(tree, "t1"), "a command that failed otherwise still smokes");
  assert.ok(verdictOf(tree, "t1"), "beside the thumbs up still showing");
});
