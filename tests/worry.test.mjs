// A blocked bee worries its creature: the creature looks down at its bees and sweats, while
// its own status still shows as it always does.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock as clock, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer, { GOLD, SWEAT_PAINT } from "../mods/pixel-party/drawer.js";
import { makeSprite } from "../mods/pixel-party/sprites.js";
import { CONFETTI, DOUSE, FIRE, HIT, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, nodeOf, walk } from "./mocks/gpui.mjs";

const STATUSES = ["working", "blocked", "done", "idle"];
const EDGES = ["top", "right", "bottom", "left"];
const OPEN_SIDE = { top: "down", right: "left", bottom: "up", left: "right" };
const t = theme();

const helper = (address, parent, fields = {}) => {
  mock.state.terminals.push({ address, parent, state: "live", labels: {}, ...fields });
};
const set = (address, fields) => {
  mock.state.terminals = mock.state.terminals.map((x) => (x.address === address ? { ...x, ...fields } : x));
};
const label = (address, key) => set(address, { labels: { ...mock.state.terminals.find((x) => x.address === address).labels, [key]: "1" } });
const place = (edge, hovered = false) => {
  mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered, dragging: false };
};

// A tree as plain data, handlers dropped: two sprites compare equal when they look the same.
const SKIP = new Set(["child", "children", "when", "hover"]);
const shape = (node) => ({
  kind: node.kind,
  id: node.id,
  calls: JSON.stringify(node.calls.filter(([name]) => !SKIP.has(name) && !name.startsWith("on_"))),
  children: node.children.map((c) => (nodeOf(c) ? shape(nodeOf(c)) : c)),
});
const spriteIn = (tree, address) => shape(find(tree, `pp-spr-${address}`));
const spriteOf = (address, status, face = null) => shape(nodeOf(spriteElement(makeSprite(address), { id: `pp-spr-${address}`, px: 3, status, face })));
const sweatOf = (tree, address) => find(tree, `pp-sweat-${address}`);

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
// A drawer whose bees have flown out, and its context, to draw it again.
const start = () => {
  const drawer = new Drawer();
  const cx = context();
  drawer.render(cx);
  cx.run(1000);
  return { drawer, cx };
};

// Noon on the local clock: no prop for the time of day, so a sprite here is the plain one.
beforeEach(() => {
  mock.reset();
  clock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 5, 12).getTime() });
});
afterEach(() => clock.timers.reset());

test("a blocked helper worries its creature: it looks down at its bees and sweats, in its own status's look", () => {
  for (const helperStatus of ["blocked", "error"]) {
    for (const status of STATUSES) {
      mock.reset();
      mock.agent("t1", { status });
      helper("t2", "t1", { status: "working" });
      helper("t3", "t1", { status: helperStatus });
      for (const edge of [...EDGES, null]) {
        place(edge);
        const tree = draw(...Object.values(start()));
        const why = `${status} parent, ${helperStatus} helper, ${edge}`;
        assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", status, "down"), `${why}: it faces down, and keeps its look`);
        assert.notDeepEqual(spriteIn(tree, "t1"), spriteOf("t1", status), `${why}: turned`);
        assert.ok(sweatOf(tree, "t1"), `${why}: it sweats`);
      }
    }
  }
});

test("helpers that work, rest or finish, and sub-agents, worry no one", () => {
  mock.agent("t1", { status: "working" });
  for (const [address, status] of [["t2", undefined], ["t3", "working"], ["t4", "idle"], ["t5", "done"]]) helper(address, "t1", { status });
  label("t1", "pixel.bee.a1");
  const tree = draw(...Object.values(start()));
  assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", "working"));
  assert.equal(sweatOf(tree, "t1"), null);
});

test("only the agent whose helper is blocked worries, even when that bee sits behind the count", () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "working" });
  for (let i = 0; i < 8; i++) helper(`t1${i}`, "t1", { status: i === 7 ? "blocked" : "working" });
  helper("t20", "t2", { status: "working" });
  const tree = draw(...Object.values(start()));
  assert.ok(sweatOf(tree, "t1"), "the eighth bee is counted, not drawn, and still worries");
  assert.equal(sweatOf(tree, "t2"), null);
  assert.deepEqual(spriteIn(tree, "t2"), spriteOf("t2", "working"));
});

test("the worry ends when the helper goes on, and when it ends, while its bee is still leaving", () => {
  mock.agent("t1", { status: "working" });
  helper("t3", "t1", { status: "blocked" });
  const { drawer, cx } = start();
  assert.ok(sweatOf(draw(drawer, cx), "t1"));
  set("t3", { status: "working" });
  let tree = draw(drawer, cx);
  assert.equal(sweatOf(tree, "t1"), null, "the helper goes on");
  assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", "working"));
  set("t3", { status: "blocked" });
  assert.ok(sweatOf(draw(drawer, cx), "t1"), "blocked again");
  set("t3", { state: "finished" });
  tree = draw(drawer, cx);
  assert.ok(find(tree, "pp-bee-t1-t3"), "its sheep is still drawn, hopping off");
  assert.equal(sweatOf(tree, "t1"), null, "the helper ended");
  assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", "working"));
});

test("on hover a worried creature turns with the others, and still sweats", () => {
  mock.agent("t1", { status: "idle" });
  helper("t3", "t1", { status: "blocked" });
  for (const edge of EDGES) {
    place(edge, true);
    const tree = draw(...Object.values(start()));
    assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", "idle", OPEN_SIDE[edge]), edge);
    assert.ok(sweatOf(tree, "t1"), edge);
  }
});

test("a worried creature that leaves, or arrives, shows no sweat while its sprite is hidden", () => {
  mock.agent("t1", { status: "working" });
  const { drawer, cx } = start();
  mock.agent("t2", { status: "working" });
  helper("t3", "t2", { status: "blocked" });
  let tree = draw(drawer, cx);
  assert.ok(walk(tree).some((n) => (n.id ?? "").startsWith("pp-trick-t2-")), "it arrives by a trick");
  assert.equal(sweatOf(tree, "t2"), null, "the trick hides it");
  cx.run(2000);
  tree = draw(drawer, cx);
  assert.ok(sweatOf(tree, "t2"), "revealed, it sweats");

  mock.state.agents = mock.state.agents.filter((a) => a.address !== "t2");
  mock.state.terminals = mock.state.terminals.filter((x) => x.address !== "t2");
  tree = draw(drawer, cx);
  assert.ok(find(tree, "pp-row-t2"), "its row stays while it leaves");
  assert.equal(sweatOf(tree, "t2"), null, "a ghost worries no more");
});

// Every pixel of the sweat, outline included, in the box, at the lowest it trickles to.
const rectsOf = (sweat) => {
  const at = (node, name) => calls(node, name).at(-1)?.[0] ?? 0;
  const [trickle] = calls(sweat, "loop").filter(([p]) => p === "top").map(([, o]) => o);
  assert.ok(trickle, "it trickles");
  const out = [];
  for (const top of [trickle.from, trickle.to]) {
    for (const layer of sweat.children.map(nodeOf)) {
      for (const px of layer.children.map(nodeOf)) {
        const x = at(sweat, "left") + at(layer, "left") + at(px, "left");
        const y = top + at(layer, "top") + at(px, "top");
        out.push([x, y, x + at(px, "w"), y + at(px, "h")]);
      }
    }
  }
  return out;
};
const distance = (a, b) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

test("the sweat stays in the box, clear of the edge stripe and of every eye, whichever way the creature faces", () => {
  mock.agent("t1", { status: "blocked" });
  helper("t3", "t1", { status: "blocked" });
  place("left");
  const rects = rectsOf(sweatOf(draw(...Object.values(start())), "t1"));
  for (const [x0, y0, x1, y1] of rects) {
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 48 && y1 <= 44, "inside the 48 by 44 box");
    assert.ok(x0 >= 3, "clear of a left stripe, 3 px wide");
  }
  // The sprite is 36 px at 6, 4 in the box, and a face steps it a cell (3 px).
  const steps = [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]];
  for (let i = 0; i < 400; i++) {
    const { eyes } = makeSprite(`seed-${i}`).parts;
    for (const [dx, dy] of steps) {
      for (const r of Object.values(eyes).flat()) {
        const [ex0, ey0] = [6 + dx + r.x * 3, 4 + dy + r.y * 3];
        const [ex1, ey1] = [ex0 + r.w * 3, ey0 + r.h * 3];
        for (const [x0, y0, x1, y1] of rects) assert.ok(x1 <= ex0 || ex1 <= x0 || y1 <= ey0 || ey1 <= y0, `seed-${i}: an eye under the sweat`);
      }
    }
  }
});

test("the sweat is its own: no '!', no status cue, and apart from the douse, confetti, hit and fire colors", () => {
  mock.agent("t1", { status: "working" });
  helper("t3", "t1", { status: "blocked" });
  const sweat = sweatOf(draw(...Object.values(start())), "t1");
  const colors = walk(sweat).flatMap((n) => calls(n, "bg").map(([c]) => c));
  assert.ok(colors.length && colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), "hex colors");
  assert.ok(walk(sweat).every((n) => n.children.every((c) => typeof c !== "string")), "no text, no '!'");
  for (const cue of [t.blocked, t.done, t.idle, t.working]) assert.ok(!colors.some((c) => c.toLowerCase().startsWith(String(cue).toLowerCase())), `not ${cue}`);
  for (const other of [...Object.values(DOUSE), ...Object.values(CONFETTI), ...Object.values(HIT), ...Object.values(FIRE), GOLD]) {
    assert.ok(distance(SWEAT_PAINT.d, other) >= 48, `${SWEAT_PAINT.d} reads apart from ${other}`);
  }
});
