// The time of day: a creature at rest keeps a lantern at night and a cup of coffee in the
// morning, from the local clock. The drawer looks at the clock each minute and redraws when
// the part of the day has changed; the sprite itself has no timer.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { GRID, makeSprite } from "../mods/pixel-party/sprites.js";
import { FIRE, HIT, WORKS, daytimeOf, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, nodeOf, walk } from "./mocks/gpui.mjs";

const DAYTIMES = ["night", "morning"];
const RESTING = ["done", "idle"];
const HEX = /^#[0-9a-f]{6}$/;
const last = (node, name) => calls(node, name).at(-1)?.[0];
/** A local time on a day of no clock change, as ms since the epoch. */
const at = (hour, minute = 0) => new Date(2026, 0, 5, hour, minute).getTime();

/** One seed of each kind of creature, the first found. */
const KINDS = (() => {
  const byKind = new Map();
  for (let i = 0; byKind.size < 10 && i < 2000; i++) {
    const sprite = makeSprite(`k${i}`);
    if (!byKind.has(sprite.kind)) byKind.set(sprite.kind, sprite);
  }
  return [...byKind.values()];
})();

const sprite = (s, status, daytime, px = 3) => spriteElement(s, { id: "s", px, status, daytime });

/** The still frame at `px`: a GRID * px square board of colors, null where nothing is drawn. */
function board(el, px) {
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
}

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

/** An element's whole tree as text: every node's kind and calls, children aside. */
const tree = (el) => JSON.stringify(walk(el).map((node) => [node.kind, node.calls.filter(([name]) => name !== "child" && name !== "children")]));

test("the local hour picks the part of the day: night from 20:00 to 5:59, morning from 6:00 to 10:59", () => {
  const parts = Array.from({ length: 24 }, (_, hour) => daytimeOf(hour));
  assert.deepEqual(parts, [
    "night", "night", "night", "night", "night", "night",
    "morning", "morning", "morning", "morning", "morning",
    null, null, null, null, null, null, null, null, null,
    "night", "night", "night", "night",
  ]);
});

test("a resting creature shows the time of day's prop at its lower right, and each part of the day its own", () => {
  for (const s of KINDS) {
    for (const status of RESTING) {
      const plain = board(sprite(s, status, null, 1), 1);
      const frames = new Set([JSON.stringify(plain)]);
      for (const daytime of DAYTIMES) {
        const b = board(sprite(s, status, daytime, 1), 1);
        frames.add(JSON.stringify(b));
        // The prop stands in the corner, in rows 9 to 11 of the two columns at the right edge.
        const corner = b.slice(9).flatMap((row) => row.slice(10));
        assert.ok(corner.every(Boolean), `${daytime} on a ${status} ${s.kind}: the corner is filled`);
        assert.notDeepEqual(corner, plain.slice(9).flatMap((row) => row.slice(10)), `${daytime} on a ${status} ${s.kind}: the corner changed`);
      }
      assert.equal(frames.size, 3, `${status} ${s.kind}: night, morning and the rest of the day share a still frame`);
    }
  }
});

test("only a resting creature keeps the prop: working, blocked and the still pose look as they did", () => {
  for (const s of KINDS) {
    for (const status of [null, "blocked", "working"]) {
      const works = status === "working" ? WORKS : [null];
      for (const work of works) {
        const plain = tree(spriteElement(s, { id: "s", status, work }));
        for (const daytime of DAYTIMES) assert.equal(tree(spriteElement(s, { id: "s", status, work, daytime })), plain, `${status} ${work ?? ""} at ${daytime}`);
      }
    }
    for (const status of RESTING) {
      const plain = tree(sprite(s, status, null));
      for (const daytime of [undefined, "", "noon", "__proto__", "constructor", 7]) assert.equal(tree(sprite(s, status, daytime)), plain, `${status} at ${String(daytime)}`);
    }
  }
});

test("the props stay in the box through all their motion, on every kind, at every size", () => {
  for (const s of KINDS) {
    for (const status of RESTING) {
      for (const daytime of DAYTIMES) {
        for (const px of [1, 2, 3, 4, 8]) {
          const size = GRID * px;
          for (const r of reach(nodeOf(sprite(s, status, daytime, px)))) {
            assert.ok(r.x[0] >= 0 && r.y[0] >= 0 && r.x[1] <= size && r.y[1] <= size, `${daytime} on a ${status} ${s.kind} at ${px} px reaches x ${r.x}, y ${r.y}`);
          }
        }
      }
    }
  }
});

test("the props render through the stand-ins in their own colors, move, and loop each property once", () => {
  const taken = new Set([...Object.values(HIT), ...Object.values(FIRE), theme().blocked, theme().done, theme().idle].map((c) => c.toLowerCase()));
  const s = makeSprite("t1");
  for (const status of RESTING) {
    const before = new Set(walk(sprite(s, status, null)).flatMap((node) => calls(node, "bg").map(([c]) => c)));
    const loopsBefore = walk(sprite(s, status, null)).reduce((n, node) => n + calls(node, "loop").length, 0);
    for (const daytime of DAYTIMES) {
      const nodes = check(sprite(s, status, daytime));
      for (const node of nodes.slice(1)) assert.equal(node.id, null, "no ids inside");
      for (const node of nodes) {
        for (const [color] of calls(node, "bg")) {
          assert.match(color, HEX, `${daytime}: ${color}`);
          if (!before.has(color)) assert.ok(!taken.has(color), `${daytime} uses ${color}, which means something else`);
        }
        for (const [property, { from, to, period }] of calls(node, "loop")) {
          assert.ok(period >= 100);
          if (property === "opacity") assert.ok(from >= 0 && from <= 1 && to >= 0 && to <= 1);
        }
        const looped = calls(node, "loop").map(([property]) => property);
        assert.equal(new Set(looped).size, looped.length, `${daytime}: one element loops ${looped}`);
      }
      const loops = nodes.reduce((n, node) => n + calls(node, "loop").length, 0);
      assert.ok(loops > loopsBefore, `${daytime}: the lantern flickers, the coffee steams`);
    }
  }
});

test("no prop hides a resting creature's eyes in the still frame", () => {
  const px = 3;
  for (let i = 0; i < 300; i++) {
    const s = makeSprite(`t${i}`);
    for (const status of RESTING) {
      for (const daytime of DAYTIMES) {
        const el = sprite(s, status, daytime, px);
        // The eyes this pose draws: the torso's eye layer, in the figure of left foot, right foot and torso.
        const figure = nodeOf(nodeOf(el).children.find((c) => nodeOf(c).children.length === 3));
        const torso = nodeOf(figure.children[2]);
        const eyes = nodeOf(torso.children[1]).children.map((c) => nodeOf(c));
        const b = board(el, px);
        for (const e of eyes) {
          const [x, y, w, h, color] = ["left", "top", "w", "h", "bg"].map((k) => last(e, k));
          for (let j = y; j < y + h; j++) for (let k = x; k < x + w; k++) assert.equal(b[j][k], color, `${daytime} hides an eye of a ${status} t${i} (${s.kind}) at ${k},${j}`);
        }
      }
    }
  }
});

// ---- the drawer ----

// A tree as plain data, handlers dropped: two renders compare equal when they look the same.
const SKIP = new Set(["child", "children", "when", "hover"]);
const shape = (node) => ({
  kind: node.kind,
  id: node.id,
  calls: JSON.stringify(node.calls.filter(([name]) => !SKIP.has(name) && !name.startsWith("on_"))),
  children: node.children.map((c) => (nodeOf(c) ? shape(nodeOf(c)) : c)),
});
/** The sprite an agent is drawn with, on the drawer's next draw. */
const drawn = (drawer, cx, address) => {
  const el = drawer.render(cx);
  check(el);
  return shape(find(el, `pp-spr-${address}`));
};
const expected = (address, status, daytime) => shape(nodeOf(spriteElement(makeSprite(address), { id: `pp-spr-${address}`, px: 3, status, daytime })));

beforeEach(() => mock.reset());
afterEach(() => mock.reset());

test("the drawer gives resting creatures the prop for the local hour, and working ones none", (t) => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.agent("t3", { status: "working" });
  for (const [hour, daytime] of [[21, "night"], [3, "night"], [8, "morning"], [12, null], [19, null]]) {
    t.mock.timers.enable({ apis: ["Date"], now: at(hour, 30) });
    const drawer = new Drawer();
    const cx = context();
    assert.deepEqual(drawn(drawer, cx, "t1"), expected("t1", "idle", daytime), `idle at ${hour}:30`);
    assert.deepEqual(drawn(drawer, cx, "t2"), expected("t2", "done", daytime), `done at ${hour}:30`);
    assert.deepEqual(drawn(drawer, cx, "t3"), expected("t3", "working", null), `working at ${hour}:30`);
    t.mock.timers.reset();
  }
});

test("the drawer looks at the clock each minute, and redraws only when the part of the day is new", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: at(19, 58) });
  mock.agent("t1", { status: "idle" });
  const drawer = new Drawer();
  const cx = context();
  drawer.init({}, cx);
  const looks = cx.timers.filter((timer) => timer.every && timer.ms === 60_000);
  assert.equal(looks.length, 1, "one look at the clock a minute");
  const look = looks[0].handler;
  assert.deepEqual(drawn(drawer, cx, "t1"), expected("t1", "idle", null));

  const notified = cx.notified;
  t.mock.timers.tick(60_000);
  look(cx);
  assert.equal(cx.notified, notified, "19:59 is still the evening: no redraw");

  t.mock.timers.tick(60_000);
  look(cx);
  assert.equal(cx.notified, notified + 1, "20:00 is night: the drawer redraws");
  assert.deepEqual(drawn(drawer, cx, "t1"), expected("t1", "idle", "night"), "and the lantern is lit");

  t.mock.timers.tick(60_000);
  look(cx);
  assert.equal(cx.notified, notified + 1, "the night drawn already: no redraw");

  // A late look still lands on the right part of the day: the render reads the clock itself.
  t.mock.timers.tick(10 * 3_600_000);
  look(cx);
  assert.equal(cx.notified, notified + 2, "6:01 is morning");
  assert.deepEqual(drawn(drawer, cx, "t1"), expected("t1", "idle", "morning"));
});
