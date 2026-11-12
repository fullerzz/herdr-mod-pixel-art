// Worker bees: which helpers an agent has, how a bee is drawn, and how the drawer shows
// them beside the agent's sprite.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { BEE_H, BEE_W, beeElement, beesOf } from "../mods/pixel-party/bees.js";
import { calls, check, context, find, nodeOf, text, walk } from "./mocks/gpui.mjs";

const t = theme();

/** A terminal an agent started with `hc run`, as `terminals()` gives it. */
const helper = (address, parent, fields = {}) => {
  mock.state.terminals.push({ address, parent, state: "live", labels: {}, ...fields });
};
const label = (address, key, value = "1") => {
  mock.state.terminals = mock.state.terminals.map((x) => (x.address === address ? { ...x, labels: { ...x.labels, [key]: value } } : x));
};
const keys = (address, rows) => beesOf(address, rows).map((b) => b.key);

const beesIn = (tree, address) => walk(tree).filter((n) => (n.id ?? "").startsWith(`pp-bee-${address}-`));
const last = (node, name) => calls(node, name).at(-1)?.[0];
// The drawer once its new bees have flown out to their places.
const settled = () => {
  const drawer = new Drawer();
  const cx = context();
  drawer.render(cx);
  cx.run(1000);
  return drawer.render(cx);
};
const loops = (el) => walk(el).flatMap((n) => calls(n, "loop").map(([property]) => property));

beforeEach(() => mock.reset());

test("an agent without helpers has no bees, and no lane for them", () => {
  mock.agent("t1");
  assert.deepEqual(beesOf("t1"), []);
  const tree = new Drawer().render(context());
  assert.deepEqual(beesIn(tree, "t1"), []);
  const box = walk(tree).find((n) => n.children.some((c) => nodeOf(c)?.id === "pp-spr-t1"));
  const cell = walk(tree).find((n) => n.children.some((c) => nodeOf(c) === box));
  assert.equal(last(cell, "h"), last(box, "h"));
});

test("each live terminal the agent started is a bee, and so is each of theirs", () => {
  mock.agent("t1");
  mock.agent("t2");
  helper("t3", "t1");
  helper("t4", "t1");
  helper("t5", "t3");
  helper("t6", "t2");
  helper("t7", "t1", { state: "finished" });
  assert.deepEqual(keys("t1"), ["t3", "t5", "t4"]);
  assert.deepEqual(keys("t2"), ["t6"]);
});

test("a live helper stays a bee when the helper that started it has ended", () => {
  mock.agent("t1");
  helper("t3", "t1", { state: "finished" });
  helper("t5", "t3");
  helper("t6", "t5", { state: "finished" });
  helper("t7", "t6");
  assert.deepEqual(keys("t1"), ["t5", "t7"]);
});

test("a helper with a row of its own is its parent's bee, and keeps its own helpers", () => {
  mock.agent("t1");
  mock.agent("t3");
  mock.state.terminals.at(-1).parent = "t1";
  helper("t5", "t3");
  const rows = new Set(["t1", "t3"]);
  assert.deepEqual(keys("t1", rows), ["t3"]);
  assert.deepEqual(keys("t3", rows), ["t5"]);
});

test("a parent loop in the data ends", () => {
  mock.agent("t1");
  mock.state.terminals[0].parent = "t2";
  helper("t2", "t1");
  assert.deepEqual(keys("t1"), ["t2"]);
});

test("a helper on another machine is found by its machine's address", () => {
  mock.agent("vps/t1");
  helper("vps/t2", "vps/t1");
  helper("t2", "t1");
  assert.deepEqual(keys("vps/t1"), ["vps/t2"]);
});

test("each pixel.bee.<id> label on the agent's terminal is a bee, after its hc helpers", () => {
  mock.agent("t1");
  mock.agent("t2");
  label("t1", "pixel.bee.b2");
  label("t1", "pixel.bee.a1");
  label("t1", "pixel.avatar", "knight7");
  label("t1", "pixel.bee.");
  label("t1", "pixel.bee.gone", "");
  helper("t3", "t1");
  assert.deepEqual(keys("t1"), ["t3", "pixel.bee.a1", "pixel.bee.b2"]);
  assert.deepEqual(keys("t2"), []);
});

test("a bee's status follows its helper: a plain command works, a finished agent rests", () => {
  mock.agent("t1");
  for (const [address, status] of [["t2", undefined], ["t3", "working"], ["t4", "blocked"], ["t5", "error"], ["t6", "idle"], ["t7", "done"]]) {
    helper(address, "t1", { status });
  }
  label("t1", "pixel.bee.a1");
  assert.deepEqual(beesOf("t1").map((b) => b.status), ["working", "working", "blocked", "blocked", "idle", "idle", "working"]);
});

test("a bee is a small hex-colored figure inside its box, the same one mirrored when it faces left", () => {
  for (const px of [1, 2, 3]) {
    const shapes = [false, true].map((flip) => {
      const el = beeElement({ px, flip, status: "idle" });
      assert.deepEqual([last(nodeOf(el), "w"), last(nodeOf(el), "h")], [BEE_W * px, BEE_H * px]);
      const cells = walk(el).filter((n) => last(n, "bg")).map((n) => [last(n, "left") / px, last(n, "top") / px, last(n, "w") / px, last(n, "h") / px, last(n, "bg")]);
      for (const [x, y, w, h] of cells) assert.ok(x >= 0 && y >= 0 && x + w <= BEE_W && y + h <= BEE_H, `outside the box at ${x},${y}`);
      return cells;
    });
    assert.deepEqual(shapes[1].map(([x, y, w, h, c]) => [BEE_W - x - w, y, w, h, c]), shapes[0]);
    assert.ok(new Set(shapes[0].map((c) => c[4])).size >= 3, "wings, amber and dark stripes");
  }
});

test("every status has its own look: flying, asking, resting", () => {
  assert.deepEqual(loops(beeElement({ status: "working" })).sort(), ["opacity", "top"]);
  const blocked = beeElement({ status: "blocked" });
  assert.deepEqual(loops(blocked), ["opacity"]);
  assert.ok(walk(blocked).some((n) => last(n, "bg") === t.blocked));
  assert.deepEqual(loops(beeElement({ status: "idle" })), []);
});

test("the drawer draws an agent's bees under its sprite's box, on every edge, with unique ids", () => {
  mock.agent("t1");
  mock.agent("vps/t2");
  helper("t3", "t1");
  label("t1", "pixel.bee.a1");
  helper("vps/t4", "vps/t2");
  for (const edge of ["top", "right", "bottom", "left", null]) {
    mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
    const tree = settled();
    check(tree);
    assert.deepEqual(beesIn(tree, "t1").map((n) => n.id), ["pp-bee-t1-t3", "pp-bee-t1-pixel.bee.a1"], String(edge));
    assert.equal(beesIn(tree, "vps/t2").length, 1);
    const box = walk(tree).find((n) => n.children.some((c) => nodeOf(c)?.id === "pp-spr-t1"));
    const cell = walk(tree).find((n) => n.children.some((c) => nodeOf(c) === box));
    assert.ok(!walk(box).some((n) => n.id === "pp-bee-t1-t3"), "no bee in the sprite's box");
    assert.ok(cell.children.some((c) => nodeOf(c)?.id === "pp-bee-t1-t3"), "the bee is beside the box, in the cell");
    const [boxH, cellH] = [last(box, "h"), last(cell, "h")];
    assert.ok(cellH > boxH, "the cell grows for the lane");
    for (const bee of beesIn(tree, "t1")) {
      assert.ok(last(bee, "left") >= 0 && last(bee, "left") + BEE_W * 2 <= 48, "inside the 48 px strip a closed drawer shows");
      // A flying bee lifts by one of its cells (2 px), and still clears the box.
      assert.ok(last(bee, "top") - 2 >= boxH && last(bee, "top") + BEE_H * 2 <= cellH, "under the box, inside the lane");
    }
    const alone = walk(tree).find((n) => n.children.some((c) => nodeOf(c)?.children.some((d) => nodeOf(d)?.id === "pp-spr-vps/t2")));
    assert.equal(last(alone, "h"), cellH, "one bee and two take one lane");
  }
});

test("a new bee starts unseen inside the sprite, then flies out to its place and stays", () => {
  mock.agent("t1");
  helper("t3", "t1");
  const drawer = new Drawer();
  const cx = context();
  const at = () => {
    const bee = find(drawer.render(cx), "pp-bee-t1-t3");
    return [last(bee, "left"), last(bee, "top"), last(bee, "opacity")];
  };
  const inside = at();
  assert.equal(inside[2], 0);
  assert.deepEqual(at(), inside, "still inside until the beat is over");
  assert.equal(cx.timers.length, 1, "one launch at a time");
  cx.run(1000);
  assert.equal(cx.notified, 1);
  const out = at();
  assert.equal(out[2], 1);
  assert.notDeepEqual(out.slice(0, 2), inside.slice(0, 2));
  assert.deepEqual(at(), out);
  assert.equal(cx.timers.length, 0);

  // A second helper flies out on its own; the first stays where it is.
  helper("t4", "t1");
  assert.equal(last(find(drawer.render(cx), "pp-bee-t1-t4"), "opacity"), 0);
  assert.deepEqual(at(), out);
  cx.run(1000);
  assert.equal(last(find(drawer.render(cx), "pp-bee-t1-t4"), "opacity"), 1);
});

test("a helper that ends takes its bee away, and the next ones move up a place", () => {
  mock.agent("t1");
  helper("t3", "t1");
  helper("t4", "t1");
  const drawer = new Drawer();
  const cx = context();
  drawer.render(cx);
  cx.run(1000);
  const place = (address) => {
    const bee = find(drawer.render(cx), `pp-bee-t1-${address}`);
    return bee && [last(bee, "left"), last(bee, "top")];
  };
  const first = place("t3");
  mock.state.terminals = mock.state.terminals.map((x) => (x.address === "t3" ? { ...x, state: "finished" } : x));
  assert.equal(place("t3"), null);
  assert.deepEqual(place("t4"), first);
});

test("more helpers than places: the last place counts the rest", () => {
  mock.agent("t1");
  for (let i = 0; i < 6; i++) helper(`t1${i}`, "t1");
  let tree = new Drawer().render(context());
  assert.equal(beesIn(tree, "t1").length, 6);
  assert.doesNotMatch(text(find(tree, "pp-row-t1")), /\+\d/);
  for (let i = 6; i < 9; i++) helper(`t1${i}`, "t1");
  tree = settled();
  check(tree);
  assert.equal(beesIn(tree, "t1").length, 5);
  assert.match(text(find(tree, "pp-row-t1")), /\+4/);
  const tops = new Set(beesIn(tree, "t1").map((n) => last(n, "top")));
  assert.equal(tops.size, 2, "two lanes, never more");
});
