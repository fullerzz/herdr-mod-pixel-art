// Results: what an agent's hooks say a tool came to, in its terminal's `pixel.result` label,
// and the one-shot each plays. A failed command makes the creature cough black smoke.

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

test("a result of another kind is reported but plays no smoke yet, and a cough never moves the box", () => {
  mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  label("t1", "passed.400");
  const tree = draw(drawer, cx);
  assert.deepEqual(drawer.reports, [{ address: "t1", kind: "passed" }]);
  assert.equal(sootOf(tree, "t1"), null);
  label("t1", "failed.401");
  assert.equal(calls(find(draw(drawer, cx), "pp-box-t1"), "top").length, 0, "the cough moves the creature, never the box");
});
