// The picker as the person uses it: what it shows, and what each click saves or closes.
// Sprites are opaque here: a candidate is known by the seed its click saves.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Picker from "../mods/pixel-party/picker.js";
import { LABEL, hasAvatar, seedFor } from "../mods/pixel-party/identity.js";
import { calls, check, context, find, fire, text, walk } from "./mocks/gpui.mjs";

const OVERLAY = "ov9";
const CANDIDATE = /^pp-cand-\d+$/;

function open(terminal = "t1") {
  const picker = new Picker();
  picker.init({ view: "picker", terminal, overlay: OVERLAY }, context());
  return picker;
}

/** A render, checked for anything the app would refuse. */
function draw(picker) {
  const tree = picker.render(context());
  check(tree);
  return tree;
}

/** Lets the click's spawned save finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// `find` gives a recorded node; `text` and `walk` take elements, which a node's children are.
const textOf = (node) => node.children.map(text).filter(Boolean).join(" ");
const findIn = (node, id) => node.children.flatMap((child) => walk(child)).find((n) => n.id === id) ?? null;

const candidateIds = (tree) => walk(tree).map((node) => node.id).filter((id) => CANDIDATE.test(id ?? ""));

/** The seed each candidate saves when clicked, in grid order. */
async function seedsOf(picker) {
  const tree = draw(picker);
  const seeds = [];
  for (const id of candidateIds(tree)) {
    mock.calls.length = 0;
    fire(tree, id);
    await settle();
    const [[args]] = mock.of("hc");
    seeds.push(args[2].slice(`${LABEL}=`.length));
  }
  return seeds;
}

beforeEach(() => mock.reset());

test("the grid shows 16 candidates with unique ids, four per row, each a different seed", async () => {
  mock.agent("t1");
  const picker = open();
  const tree = draw(picker);
  const ids = candidateIds(tree);
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
  const rows = find(tree, "pp-grid").children;
  assert.deepEqual(rows.map((row) => walk(row).filter((node) => CANDIDATE.test(node.id ?? "")).length), [4, 4, 4, 4]);
  const shown = seedFor("t1");
  const seeds = await seedsOf(picker);
  assert.equal(new Set(seeds).size, 16);
  assert.ok(!seeds.includes(shown), "no candidate is the sprite shown now");
});

test("choosing a candidate saves its seed as the label and closes this overlay", async () => {
  mock.agent("t1");
  const picker = open();
  const tree = draw(picker);
  fire(tree, "pp-cand-5");
  await settle();
  const [[args]] = mock.of("hc");
  const seed = args[2].slice(`${LABEL}=`.length);
  assert.deepEqual(args, ["label", "t1", `${LABEL}=${seed}`]);
  assert.equal(seedFor("t1"), seed);
  assert.equal(hasAvatar("t1"), true);
  assert.deepEqual(mock.of("closeOverlay"), [[OVERLAY]]);
});

test("shuffle replaces the candidates and asks for a redraw", async () => {
  mock.agent("t1");
  const picker = open();
  const before = await seedsOf(picker);
  // seedsOf saved labels; start from no label again so only the shuffle differs.
  mock.reset();
  mock.agent("t1");
  const cx = fire(draw(picker), "pp-shuffle");
  assert.equal(cx.notified, 1);
  const after = await seedsOf(picker);
  assert.equal(after.length, 16);
  assert.notDeepEqual(after, before);
});

test("candidates are made once per shuffle, not on every render", async () => {
  mock.agent("t1");
  const picker = open();
  const first = await seedsOf(picker);
  mock.reset();
  mock.agent("t1");
  assert.deepEqual(await seedsOf(picker), first);
});

test("reset clears the label and closes", async () => {
  mock.agent("t1");
  mock.state.terminals[0].labels[LABEL] = "knight7";
  const tree = draw(open());
  fire(tree, "pp-reset");
  await settle();
  assert.deepEqual(mock.of("hc"), [[["label", "t1", `${LABEL}=`]]]);
  assert.equal(hasAvatar("t1"), false);
  assert.deepEqual(mock.of("closeOverlay"), [[OVERLAY]]);
});

test("reset is dimmed and does nothing when there is no label", () => {
  mock.agent("t1");
  const tree = draw(open());
  const reset = find(tree, "pp-reset");
  assert.ok(reset, "reset is still shown");
  assert.ok(calls(reset, "opacity").some(([value]) => value < 1), "reset is dimmed");
  assert.throws(() => fire(tree, "pp-reset"), /no on_click handler/);
  assert.deepEqual(mock.of("hc"), []);
  assert.deepEqual(mock.of("closeOverlay"), []);
});

test("a failed save keeps the popup open and says so", async () => {
  // A terminal the core does not know: the stand-in hc answers code 3, not_found.
  const picker = open("t404");
  const tree = draw(picker);
  assert.equal(find(tree, "pp-error"), null);
  const cx = fire(tree, "pp-cand-0");
  await settle();
  assert.equal(mock.of("hc").length, 1);
  assert.deepEqual(mock.of("closeOverlay"), []);
  assert.ok(cx.notified >= 1, "the failure is redrawn");
  const after = draw(picker);
  assert.match(textOf(find(after, "pp-error")), /Not saved.*3.*not_found/);
  assert.equal(candidateIds(after).length, 16, "the grid stays for another try");
});

test("a failed reset keeps the popup open and says so", async () => {
  mock.agent("t1");
  mock.state.terminals[0].labels[LABEL] = "knight7";
  const picker = open();
  const tree = draw(picker);
  // The terminal goes away between the render and the click.
  mock.state.terminals = [];
  fire(tree, "pp-reset");
  await settle();
  assert.deepEqual(mock.of("closeOverlay"), []);
  assert.match(text(draw(picker)), /Not saved/);
});

test("the header names the agent and tells a chosen sprite from the default", () => {
  mock.agent("t1", { title: "fix the login bug" });
  const picker = open();
  let header = find(draw(picker), "pp-header");
  assert.ok(findIn(header, "pp-current"), "the current sprite is shown");
  assert.match(textOf(header), /fix the login bug/);
  assert.match(textOf(header), /Default sprite for t1/);
  assert.doesNotMatch(textOf(header), /Chosen/);

  mock.state.terminals[0].labels[LABEL] = "knight7";
  header = find(draw(picker), "pp-header");
  assert.match(textOf(header), /Chosen sprite · knight7/);
  assert.doesNotMatch(textOf(header), /Default/);
});

test("without an agent title the header names the address", () => {
  mock.agent("vps/t3", { title: "" });
  assert.match(textOf(find(draw(open("vps/t3")), "pp-name")), /vps\/t3/);
});

test("a missing terminal renders a message and a way to close", () => {
  const picker = new Picker();
  picker.init({ view: "picker", overlay: OVERLAY }, context());
  const tree = draw(picker);
  assert.match(text(tree), /without a terminal/);
  assert.deepEqual(candidateIds(tree), []);
  fire(tree, "pp-close");
  assert.deepEqual(mock.of("closeOverlay"), [[OVERLAY]]);
  assert.deepEqual(mock.of("hc"), []);
});
