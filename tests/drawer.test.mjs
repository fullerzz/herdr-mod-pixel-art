// The party drawer, through the stand-ins: what it shows for live data, and what Herdr is
// asked to do when the person clicks, right clicks or presses a key.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { makeSprite } from "../mods/pixel-party/sprites.js";
import { spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, fire, nodeOf, text, walk } from "./mocks/gpui.mjs";

const STATUSES = ["working", "blocked", "done", "idle"];
const EDGES = ["top", "right", "bottom", "left"];
const t = theme();

const render = () => {
  const tree = new Drawer().render(context());
  check(tree);
  return tree;
};

// `find` gives recorded nodes; `walk` and `text` take elements. These take nodes.
const below = (node) => [node, ...node.children.flatMap((c) => walk(c))];
const textOf = (node) => node.children.map(text).filter(Boolean).join(" ");

// An agent's node, whatever the edge: a row on a side, a tile on top or bottom.
const itemOf = (tree, address) => find(tree, `pp-row-${address}`) ?? find(tree, `pp-tile-${address}`);
const items = (tree) => walk(tree).filter((n) => /^pp-(row|tile)-/.test(n.id ?? ""));
const addressOf = (node) => node.id.replace(/^pp-(row|tile)-/, "");

// A tree as plain data, handlers dropped: two renders compare equal when they look the same.
const SKIP = new Set(["child", "children", "when", "hover"]);
const shape = (node) => ({
  kind: node.kind,
  id: node.id,
  calls: JSON.stringify(node.calls.filter(([name]) => !SKIP.has(name) && !name.startsWith("on_"))),
  children: node.children.map((c) => (nodeOf(c) ? shape(nodeOf(c)) : c)),
});
const look = (tree) => shape(nodeOf(tree));

// The sprite drawn for an agent, and the one spriteElement draws for a seed in its place.
const spriteIn = (tree, address) => shape(find(tree, `pp-spr-${address}`));
const spriteOf = (seed, address, status) => look(spriteElement(makeSprite(seed), { id: `pp-spr-${address}`, px: 3, status }));

const bgs = (node) => below(node).flatMap((n) => calls(n, "bg").map(([c]) => c));
const focusOn = (address, { agent = address } = {}) => {
  mock.state.focused = { space: "sp1", tab: "tb1", pane: `p-${address}`, terminal: address, shown: null, agent, cwd: null };
};
const setMsg = (address, msg) => {
  mock.state.terminals = mock.state.terminals.map((x) => (x.address === address ? { ...x, report: { ...x.report, msg } } : x));
};

beforeEach(() => mock.reset());

test("no agents renders an empty div, so the floating block hides", () => {
  const tree = render();
  assert.equal(nodeOf(tree).kind, "div");
  assert.equal(walk(tree).length, 1);
});

test("one row per agent, in the order agents() gives", () => {
  for (const address of ["t5", "t1", "vps/t3"]) mock.agent(address);
  assert.deepEqual(items(render()).map(addressOf), ["t5", "t1", "vps/t3"]);
});

test("each row names its agent by title, without the title's status glyph", () => {
  mock.agent("t1", { title: "✳ Fix the login" });
  mock.agent("t2", { title: "" , tab_name: "api" });
  const tree = render();
  assert.match(textOf(itemOf(tree, "t1")), /^Fix the login/);
  assert.match(textOf(itemOf(tree, "t2")), /api/);
});

test("the status line is the agent's own message", () => {
  mock.agent("t1", { status: "working" });
  setMsg("t1", "Running the test suite");
  assert.match(textOf(itemOf(render(), "t1")), /Running the test suite/);
});

test("without a message the status line says what the agent is doing and where", () => {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status }));
  const tree = render();
  const want = ["Working in repo", "Needs you in repo", "Finished in repo", "Idle in repo"];
  want.forEach((line, i) => assert.ok(textOf(itemOf(tree, `t${i}`)).endsWith(`agent t${i} ${line}`), line));
});

test("click goes to that agent's pane", () => {
  mock.agent("t1");
  mock.agent("t2");
  fire(render(), "pp-row-t2");
  assert.deepEqual(mock.of("run"), [["pane.focus", { pane: "p-t2" }]]);
});

test("right click opens the picker for that agent at the pointer", () => {
  mock.agent("t1");
  mock.agent("t2");
  fire(render(), "pp-row-t1", "on_mouse_down:right");
  const [[spec]] = mock.of("openOverlay");
  assert.deepEqual(spec.props, { view: "picker", terminal: "t1" });
  assert.equal(spec.kind, "popup");
  assert.deepEqual(mock.of("hc"), []);
});

test("pick opens the picker for the focused agent as a dialog", () => {
  mock.agent("t1");
  mock.agent("t2");
  focusOn("t2");
  new Drawer().command("pick", context());
  const [[spec]] = mock.of("openOverlay");
  assert.deepEqual(spec.props, { view: "picker", terminal: "t2" });
  assert.equal(spec.kind, "dialog");
});

test("reroll saves a random seed on the focused agent, and its sprite changes", () => {
  mock.agent("t1");
  focusOn("t1");
  const before = spriteIn(render(), "t1");
  new Drawer().command("reroll", context());
  const [[args]] = mock.of("hc");
  assert.equal(args[0], "label");
  assert.equal(args[1], "t1");
  const seed = mock.state.terminals[0].labels["pixel.avatar"];
  assert.match(seed, /^[a-z0-9]{6}$/);
  assert.equal(args[2], `pixel.avatar=${seed}`);
  assert.deepEqual(spriteIn(render(), "t1"), spriteOf(seed, "t1", "idle"));
  assert.notDeepEqual(spriteIn(render(), "t1"), before);
});

test("reset clears the focused agent's label, and its sprite goes back to the address's", () => {
  mock.agent("t1");
  mock.state.terminals[0].labels["pixel.avatar"] = "knight7";
  focusOn("t1");
  new Drawer().command("reset", context());
  assert.deepEqual(mock.of("hc"), [[["label", "t1", "pixel.avatar="]]]);
  assert.deepEqual(spriteIn(render(), "t1"), spriteOf("t1", "t1", "idle"));
});

test("the pane with the keyboard wins over an agent chosen earlier", () => {
  mock.agent("t1");
  mock.agent("t2");
  mock.state.terminals[1].labels["pixel.avatar"] = "knight7";
  // agent.next chose t1 a while ago; the person has since clicked into t2's pane.
  focusOn("t2", { agent: "t1" });
  assert.ok(calls(itemOf(render(), "t2"), "bg").some(([c]) => c === t.selected));
  new Drawer().command("reset", context());
  assert.deepEqual(mock.of("hc"), [[["label", "t2", "pixel.avatar="]]]);
});

test("with the keyboard in a shell pane, commands act on Herdr's current agent, which is the marked row", () => {
  mock.agent("t1");
  mock.agent("t2");
  focusOn("t9", { agent: "t2" });
  assert.ok(calls(itemOf(render(), "t2"), "bg").some(([c]) => c === t.selected));
  new Drawer().command("pick", context());
  const [[spec]] = mock.of("openOverlay");
  assert.equal(spec.props.terminal, "t2");
});

test("commands use the focused terminal when no agent block is focused", () => {
  mock.agent("t1");
  focusOn("t1", { agent: null });
  new Drawer().command("reset", context());
  assert.deepEqual(mock.of("hc"), [[["label", "t1", "pixel.avatar="]]]);
});

test("commands do nothing when the focus is not an agent, and unknown commands do nothing", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  for (const name of ["pick", "reroll", "reset"]) drawer.command(name, context());
  focusOn("t9");
  for (const name of ["pick", "reroll", "reset"]) drawer.command(name, context());
  focusOn("t1");
  drawer.command("dance", context());
  assert.deepEqual(mock.calls, []);
});

test("the sprite follows the label: setAvatar's label is drawn on the next render", async () => {
  mock.agent("t1", { status: "working" });
  assert.deepEqual(spriteIn(render(), "t1"), spriteOf("t1", "t1", "working"));
  const { setAvatar } = await import("../mods/pixel-party/identity.js");
  await setAvatar("t1", "knight7");
  assert.deepEqual(spriteIn(render(), "t1"), spriteOf("knight7", "t1", "working"));
});

test("every status reaches the sprite, and shows as a cue in its theme color", () => {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status }));
  const tree = render();
  STATUSES.forEach((status, i) => {
    assert.deepEqual(spriteIn(tree, `t${i}`), spriteOf(`t${i}`, `t${i}`, status));
    const cue = status === "idle" ? t.idle + "99" : t[status];
    assert.ok(bgs(itemOf(tree, `t${i}`)).includes(cue), `${status} row has its ${cue} cue`);
  });
});

test("a blocked agent's cell is tinted; no other is, and the sprite alone draws the alert mark", () => {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status }));
  const tree = render();
  assert.ok(bgs(itemOf(tree, "t1")).includes(t.blocked + "40"));
  for (const i of [0, 2, 3]) {
    assert.ok(!bgs(itemOf(tree, `t${i}`)).some((c) => c.startsWith(t.blocked)), `t${i} has no blocked tint`);
  }
  // One mark per agent: the sprite's. The drawer adds no second "!" beside it.
  for (const i of [0, 1, 2, 3]) assert.ok(!textOf(itemOf(tree, `t${i}`)).includes("!"));
});

test("the focused agent's row is marked, and only that one", () => {
  mock.agent("t1");
  mock.agent("t2");
  focusOn("t2");
  const tree = render();
  assert.ok(calls(itemOf(tree, "t2"), "bg").some(([c]) => c === t.selected));
  assert.ok(!calls(itemOf(tree, "t1"), "bg").some(([c]) => c === t.selected));
});

test("every edge, and docked with no placement, renders with unique ids; hover and drag change nothing", () => {
  STATUSES.forEach((status, i) => mock.agent(i % 2 ? `vps/t${i}` : `t${i}`, { status }));
  for (const edge of EDGES) {
    const looks = [];
    for (const [hovered, dragging] of [[false, false], [true, false], [true, true]]) {
      mock.state.placement = { edge, align: "center", vertical: edge === "left" || edge === "right", hovered, dragging };
      const tree = render();
      assert.equal(items(tree).length, STATUSES.length, edge);
      looks.push(look(tree));
    }
    assert.deepEqual(looks[1], looks[0], `${edge}: hover changes nothing`);
    assert.deepEqual(looks[2], looks[0], `${edge}: drag changes nothing`);
  }
  mock.state.placement = null;
  assert.equal(items(render()).length, STATUSES.length);
});

test("on a side edge the sprite cell is on the edge side, and is 48 px wide", () => {
  mock.agent("t1");
  const cellOf = (row, at) => nodeOf(row.children.at(at));
  const hasSprite = (node) => below(node).some((n) => n.id === "pp-spr-t1");
  for (const [edge, at] of [["left", 0], ["right", -1], [null, 0]]) {
    mock.state.placement = edge && { edge, align: "center", vertical: true, hovered: false, dragging: false };
    const row = find(render(), "pp-row-t1");
    const c = cellOf(row, at);
    assert.ok(hasSprite(c), `${edge}: sprite on the ${at === 0 ? "left" : "right"}`);
    assert.deepEqual(calls(c, "w"), [[48]]);
    assert.ok(!hasSprite(cellOf(row, at === 0 ? -1 : 0)));
  }
});

test("on the top and bottom edges the sprites stand in a row with names under them", () => {
  mock.agent("t1", { title: "first" });
  mock.agent("t2", { title: "second" });
  for (const edge of ["top", "bottom"]) {
    mock.state.placement = { edge, align: "center", vertical: false, hovered: false, dragging: false };
    const tree = render();
    assert.equal(nodeOf(tree).kind, "h_flex");
    const tile = find(tree, "pp-tile-t1");
    assert.equal(tile.kind, "v_flex");
    assert.ok(walk(tile.children[0]).some((n) => n.id === "pp-spr-t1"), "sprite first");
    assert.equal(text(tile.children[1]), "first");
  }
});

test("an agent on another machine works: named with its machine, clicked, picked", () => {
  mock.agent("vps/t3", { title: "deploy" });
  let tree = render();
  assert.match(textOf(itemOf(tree, "vps/t3")), /deploy vps/);
  fire(tree, "pp-row-vps/t3");
  fire(tree, "pp-row-vps/t3", "on_mouse_down:right");
  assert.deepEqual(mock.of("run"), [["pane.focus", { pane: "p-vps/t3" }]]);
  assert.equal(mock.of("openOverlay")[0][0].props.terminal, "vps/t3");
  focusOn("vps/t3");
  new Drawer().command("reset", context());
  assert.deepEqual(mock.of("hc"), [[["label", "vps/t3", "pixel.avatar="]]]);
  tree = render();
  assert.deepEqual(spriteIn(tree, "vps/t3"), spriteOf("vps/t3", "vps/t3", "idle"));
});
