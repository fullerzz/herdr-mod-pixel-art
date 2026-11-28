// Hits: lines an agent adds or removes, read from git, shown over its sprite in the drawer.
// Moves: HEAD moved by a checkout, reset, rebase, pull or cherry-pick, read from its reflog,
// landed on the drawer's agents; a checkout flips a signpost by the sprite, a reset rewinds
// the creature, a rebase shuffles a deck of cards in front of it, and a pull or a
// fast-forward drops a package in front of it. Git is faked through
// the herdr stand-in's `exec`, and a change through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { CRIT_LINES, EditWatcher, HIT_LINES, countLines, growth, hitSize, moveKind, parseNumstat } from "../mods/pixel-party/edits.js";
import { makeSprite } from "../mods/pixel-party/sprites.js";
import { HIT, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, text, walk } from "./mocks/gpui.mjs";

/** Lets spawned tasks run until they wait on something that has not happened. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** A reflog line, all in one second, as git writes them. */
const line = ([sha, subject], i, all) =>
  `${(all[i - 1]?.[0] ?? "0").repeat(40)} ${sha.repeat(40)} Ada <ada@x> 1794700000 +0000\t${subject}`;
const LOG = "/repo/.git/logs/HEAD";

/**
 * A repository at /repo: `repo.numstat` is its diff against HEAD, `repo.untracked` its new
 * files, `repo.log` HEAD's reflog as [sha, subject] moves, oldest first.
 */
let repo;
function fakeGit() {
  repo = { numstat: "", untracked: [], log: [["a", "commit (initial): start"]] };
  mock.state.exec = (command, args, { cwd } = {}) => {
    if (command === "tail") {
      assert.deepEqual([args[0], args[2]], ["-n", LOG]);
      return ok(repo.log.map(line).map((l) => `${l}\n`).slice(Number(args[1].slice(1)) - 1).join(""));
    }
    if (command === "test") return { code: args[1] === LOG ? 0 : 1, stdout: "", stderr: "" };
    assert.equal(command, "git");
    assert.equal(args[0], "--no-optional-locks", "git must not write the index: that is a change too");
    const [verb, ...rest] = args.slice(1);
    if (verb === "rev-parse") {
      if (!cwd.startsWith("/repo")) return { code: 128, stdout: "", stderr: "not a git repository" };
      if (rest.includes("--git-path")) return ok(".git/logs/HEAD\n");
      return ok(rest.includes("--absolute-git-dir") ? "/repo/.git\n" : "/repo\n");
    }
    if (verb === "diff" && rest[0] === "HEAD") return ok(repo.numstat);
    if (verb === "ls-files") return ok(repo.untracked.map((p) => `${p}\0`).join(""));
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

/** A drawer that has started watching, and its context. */
async function start() {
  const drawer = new Drawer();
  const cx = context();
  drawer.init({}, cx);
  await settle();
  return { drawer, cx };
}

/** A change in /repo, once git has been read again. */
async function edit(change) {
  change();
  mock.touch("/repo");
  await settle();
}

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
/** The hit's numbers over an agent's sprite, or null. */
const hitOf = (tree, address) => walk(tree).find((n) => n.id?.startsWith(`pp-hit-${address}-`)) ?? null;
const last = (node, name) => calls(node, name).at(-1)?.[0];
/** What a hit says, each number once: each is drawn twice, the copy behind as its outline. */
const said = (hit) => [...new Set(text(hit).split(" "))].join(" ");

beforeEach(() => {
  mock.reset();
  fakeGit();
});

test("numstat lines become lines per file, binary files left out", () => {
  const diff = parseNumstat("3\t1\tsrc/a.js\n-\t-\timg.png\n10\t0\tdocs/{old => new}.md\n");
  assert.deepEqual([...diff], [
    ["src/a.js", { added: 3, removed: 1 }],
    ["docs/{old => new}.md", { added: 10, removed: 0 }],
  ]);
  assert.equal(parseNumstat("").size, 0);
});

test("a file's lines count a last line without a newline", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\n\n"), 2);
});

test("only growth counts: a commit or revert shrinks the diff and is no hit", () => {
  const d = (entries) => new Map(Object.entries(entries));
  assert.deepEqual(growth(d({ a: { added: 2, removed: 1 } }), d({ a: { added: 5, removed: 1 }, b: { added: 0, removed: 4 } })), { added: 3, removed: 4 });
  assert.deepEqual(growth(d({ a: { added: 9, removed: 9 } }), d({})), { added: 0, removed: 0 });
  assert.deepEqual(growth(d({ a: { added: 9, removed: 2 } }), d({ a: { added: 4, removed: 3 } })), { added: 0, removed: 1 });
});

test("a drawer watches the repository its agents are in, once, and none for agents elsewhere", async () => {
  mock.agent("t1");
  mock.agent("t2");
  mock.agent("t3");
  mock.agent("mini/t4");
  mock.state.panes = [
    { pane: "p-t1", cwd: "/repo" },
    { pane: "p-t2", cwd: "/repo/src" },
    { pane: "p-t3", cwd: "/tmp" },
    { pane: "p-mini/t4", cwd: "/repo" },
  ];
  await start();
  assert.deepEqual(mock.of("watchFolder"), [["/repo"]]);
});

test("lines added and removed pop as green and red numbers over the working agent's sprite", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  repo.numstat = "1\t0\ta.js\n";
  const { drawer, cx } = await start();
  assert.equal(hitOf(draw(drawer, cx), "t1"), null, "what was there before the drawer is no hit");

  const before = cx.notified;
  await edit(() => (repo.numstat = "13\t2\ta.js\n"));
  assert.ok(cx.notified > before);
  let tree = draw(drawer, cx);
  const hit = hitOf(tree, "t1");
  assert.ok(hit, "the working agent takes the hit");
  assert.equal(hitOf(tree, "t2"), null, "the idle one in the same repository does not");
  assert.equal(said(hit), "+12 \u22122");
  const colors = walk(hit).flatMap((n) => calls(n, "text_color").map(([c]) => c));
  assert.ok(colors.includes(HIT.added) && colors.includes(HIT.removed));

  // Live: still and at full strength. Then each number curves away and fades, natively:
  // added lines up and to the left, removed lines up and to the right.
  const flash = find(tree, `pp-spr-t1-flash-${hit.id.split("-").at(-1)}`);
  assert.equal(last(flash, "opacity"), 0.9);
  const plus = find(tree, `${hit.id}-added`);
  const minus = find(tree, `${hit.id}-removed`);
  for (const n of [plus, minus]) {
    assert.equal(last(n, "opacity"), 1);
    assert.equal(last(n, "left"), 0);
    const eases = Object.fromEntries(calls(n, "transition").map(([p, policy]) => [p, policy.easing]));
    assert.equal(eases.top, "ease-out", "it rises first...");
    assert.equal(eases.left, "ease-in", "...then swings aside: a curve");
    assert.ok("opacity" in eases);
  }
  cx.run(100);
  tree = draw(drawer, cx);
  const [plus2, minus2] = [find(tree, plus.id), find(tree, minus.id)];
  assert.ok(plus2 && minus2, "the same elements, so the change is animated");
  assert.ok(last(plus2, "left") < 0, "added lines go left");
  assert.ok(last(minus2, "left") > 0, "removed lines go right");
  for (const [was, now] of [[plus, plus2], [minus, minus2]]) {
    assert.ok(last(now, "top") < last(was, "top"));
    assert.equal(last(now, "opacity"), 0);
  }
  assert.equal(last(find(tree, flash.id), "opacity"), 0);

  cx.run(2000);
  assert.equal(hitOf(draw(drawer, cx), "t1"), null, "and then it is gone");
});

test("with no agent working, every agent in the repository takes the hit", async () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }];
  const { drawer, cx } = await start();
  await edit(() => (repo.numstat = "4\t0\ta.js\n"));
  const tree = draw(drawer, cx);
  assert.match(text(hitOf(tree, "t1")), /\+4/);
  assert.match(text(hitOf(tree, "t2")), /\+4/);
});

test("a new file's lines are added lines", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await edit(() => {
    repo.untracked = ["new.js"];
    mock.state.files["/repo/new.js"] = "one\ntwo\nthree\n";
  });
  const hit = hitOf(draw(drawer, cx), "t1");
  assert.match(text(hit), /\+3/);
  assert.doesNotMatch(text(hit), /\u2212/, "nothing was removed");
});

test("a commit shrinks the diff and shows nothing; the next edit counts from there", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  repo.numstat = "40\t5\ta.js\n";
  const { drawer, cx } = await start();
  await edit(() => (repo.numstat = ""));
  assert.equal(hitOf(draw(drawer, cx), "t1"), null);
  await edit(() => (repo.numstat = "2\t0\ta.js\n"));
  assert.equal(said(hitOf(draw(drawer, cx), "t1")), "+2");
});

test("a hit on a damaged sprite flashes red and knocks it sideways; added lines flash green and lift it", () => {
  const sprite = makeSprite("t1");
  const bgs = (el, id) => walk(el).find((n) => n.id === id).children.flatMap((c) => walk(c)).flatMap((n) => calls(n, "bg").map(([c]) => c));
  const red = spriteElement(sprite, { id: "s", status: "working", hit: { n: 7, damage: true, live: true } });
  check(red);
  assert.ok(bgs(red, "s-flash-7").every((c) => c === HIT.removed));
  const knock = find(red, "s-knock-7");
  assert.ok(last(knock, "left") < 0);
  assert.equal(last(knock, "top"), 0);

  const green = spriteElement(sprite, { id: "s", status: "idle", hit: { n: 8, damage: false, live: true } });
  assert.ok(bgs(green, "s-flash-8").every((c) => c === HIT.added));
  assert.ok(last(find(green, "s-knock-8"), "top") < 0);

  const settled = find(spriteElement(sprite, { id: "s", hit: { n: 8, damage: false, live: false } }), "s-knock-8");
  assert.equal(last(settled, "top"), 0);
  assert.equal(last(settled, "left"), 0);
});

test("a change's lines say how hard it hits: a tick for a few, a crit for a big change", () => {
  assert.deepEqual([1, 4, HIT_LINES - 1].map(hitSize), ["tick", "tick", "tick"]);
  assert.deepEqual([HIT_LINES, 14, CRIT_LINES - 1].map(hitSize), ["hit", "hit", "hit"]);
  assert.deepEqual([CRIT_LINES, 500, 34_000].map(hitSize), ["crit", "crit", "crit"]);
});

/** The text sizes a hit's numbers are drawn at, without the CRIT tag. */
const sizesOf = (hit) => [...new Set(walk(hit).filter((n) => !n.id?.endsWith("-crit")).flatMap((n) => walk(n)).flatMap((n) => calls(n, "text_size").map(([s]) => s)))];

test("a one-line change is a small tick; a big change is a crit, with bigger numbers, a CRIT tag and a longer stop", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const flashOf = (tree, hit) => last(find(tree, `pp-spr-t1-flash-${hit.id.split("-").at(-1)}`), "opacity");
  const crit = (hit) => walk(hit).find((n) => n.id === `${hit.id}-crit`) ?? null;

  await edit(() => (repo.numstat = "1\t0\ta.js\n"));
  let tree = draw(drawer, cx);
  let hit = hitOf(tree, "t1");
  assert.equal(said(hit), "+1");
  const [tick] = sizesOf(hit);
  const tickFlash = flashOf(tree, hit);
  assert.equal(crit(hit), null, "a tick is no crit");
  cx.run(2000);

  await edit(() => (repo.numstat = "13\t2\ta.js\n"));
  tree = draw(drawer, cx);
  hit = hitOf(tree, "t1");
  const [plain] = sizesOf(hit);
  const plainFlash = flashOf(tree, hit);
  assert.equal(crit(hit), null, "+12 −2 is a plain hit");
  cx.run(2000);

  await edit(() => (repo.numstat = "513\t2\ta.js\n"));
  tree = draw(drawer, cx);
  hit = hitOf(tree, "t1");
  assert.equal(said(hit), "+500 CRIT");
  const [big] = sizesOf(hit);
  assert.ok(tick < plain && plain < big, `numbers grow with the hit: ${tick}, ${plain}, ${big}`);
  assert.ok(tickFlash < plainFlash && plainFlash < flashOf(tree, hit), "and so does the flash");
  const tag = crit(hit);
  assert.ok(tag, "a crit says so");
  assert.ok(walk(tag).flatMap((n) => calls(n, "text_color").map(([c]) => c)).includes(HIT.added), "in its number's color");
  assert.equal(last(tag, "opacity"), 1);

  // A fighting game's crit holds its hit stop longer: still live when a plain hit moves.
  cx.run(100);
  tree = draw(drawer, cx);
  assert.equal(last(find(tree, tag.id), "opacity"), 1, "still at full strength after a plain hit's stop");
  cx.run(300);
  tree = draw(drawer, cx);
  assert.equal(last(find(tree, tag.id), "opacity"), 0, "then it flies off with the numbers");
  assert.ok(last(find(tree, tag.id), "top") < last(tag, "top"));
  cx.run(2000);
  assert.equal(hitOf(draw(drawer, cx), "t1"), null, "and is gone");
});

test("a hit's size is all its lines together: +500 −1 is a crit, in the bigger number's color", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await edit(() => (repo.numstat = "3\t300\ta.js\n"));
  const hit = hitOf(draw(drawer, cx), "t1");
  assert.equal(said(hit), "+3 −300 CRIT");
  const tag = walk(hit).find((n) => n.id === `${hit.id}-crit`);
  const colors = walk(tag).flatMap((n) => calls(n, "text_color").map(([c]) => c));
  assert.ok(colors.includes(HIT.removed) && !colors.includes(HIT.added));
});

test("a tick nudges the sprite by less than a cell and flashes faintly; a crit flashes solid and slowly, and knocks no further than a hit", () => {
  const sprite = makeSprite("t1");
  const u = 3;
  const strike = (size, damage = false) => spriteElement(sprite, { id: "s", px: u, hit: { n: 1, damage, live: true, size } });
  const knock = (el, damage = false) => -last(find(el, "s-knock-1"), damage ? "left" : "top");
  const flash = (el) => find(el, "s-flash-1");
  const fade = (el) => calls(flash(el), "transition").find(([p]) => p === "opacity")[1].duration;
  const [tick, hit, crit] = ["tick", "hit", "crit"].map((size) => strike(size));
  for (const el of [tick, hit, crit]) check(el);

  assert.ok(knock(tick) > 0 && knock(tick) < u, "a tick still moves, by less than a cell");
  assert.equal(knock(hit), u);
  assert.equal(knock(crit), u, "the art leaves one empty ring: no knock goes past it");
  assert.equal(knock(strike("crit", true), true), u);
  assert.ok(last(flash(tick), "opacity") < last(flash(hit), "opacity"));
  assert.equal(last(flash(crit), "opacity"), 1);
  assert.ok(fade(crit) > fade(hit), "a crit's flash lingers");
  assert.deepEqual(
    [knock(strike(undefined)), last(flash(strike(undefined)), "opacity")],
    [knock(hit), last(flash(hit), "opacity")],
    "a hit with no size is a plain one",
  );
});

/** An agent's combo counter, or null. */
const comboOf = (tree, address) => walk(tree).find((n) => n.id?.startsWith(`pp-combo-${address}-`)) ?? null;
/** One more line added to a.js: a hit. */
let lines = 0;
const hitAgain = () => edit(() => (repo.numstat = `${++lines}\t0\ta.js\n`));

test("three quick hits on one agent make a combo that counts each hit, in its cell, then fades when they stop", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await hitAgain();
  cx.run(100);
  await hitAgain();
  assert.equal(comboOf(draw(drawer, cx), "t1"), null, "two hits are no combo");
  cx.run(2000);
  await hitAgain();
  let tree = draw(drawer, cx);
  let combo = comboOf(tree, "t1");
  assert.ok(combo, "the third hit within a few seconds of the last is");
  assert.equal(said(combo), "3 HIT COMBO");
  assert.ok(walk(find(tree, "pp-box-t1")).includes(combo), "in the sprite's box, so a closed drawer shows it");
  assert.ok(walk(combo).flatMap((n) => calls(n, "text_color").map(([c]) => c)).includes("#000000c0"), "outlined, as the numbers are");
  assert.equal(comboOf(tree, "t2"), null, "the idle agent took none of the hits");
  assert.ok(hitOf(tree, "t1"), "the hit's numbers still show over it");

  await hitAgain();
  tree = draw(drawer, cx);
  assert.equal(said(comboOf(tree, "t1")), "4 HIT COMBO", "it grows with each hit");
  cx.run(2000);
  tree = draw(drawer, cx);
  assert.equal(hitOf(tree, "t1"), null, "the last hit's numbers are gone");
  combo = comboOf(tree, "t1");
  assert.equal(said(combo), "4 HIT COMBO", "the combo still waits for the next hit");
  assert.equal(last(combo, "opacity"), 1);

  cx.run(2500);
  tree = draw(drawer, cx);
  const fading = find(tree, combo.id);
  assert.ok(fading, "the same counter, so it fades instead of starting over");
  assert.equal(last(fading, "opacity"), 0, "no hit came: it fades");
  assert.ok(calls(fading, "transition").some(([p]) => p === "opacity"));
  cx.run(3000);
  assert.equal(comboOf(draw(drawer, cx), "t1"), null, "and is gone");

  await hitAgain();
  assert.equal(comboOf(draw(drawer, cx), "t1"), null, "the next hit counts from one again");
});

test("hits a few seconds apart, or one in a combo's fade, make no combo", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  for (let i = 0; i < 4; i++) {
    await hitAgain();
    assert.equal(comboOf(draw(drawer, cx), "t1"), null, `hit ${i + 1}, after a pause`);
    cx.run(2500);
  }

  for (let i = 0; i < 3; i++) await hitAgain();
  cx.run(2500);
  const fading = comboOf(draw(drawer, cx), "t1");
  assert.equal(last(fading, "opacity"), 0);
  await hitAgain();
  await hitAgain();
  assert.equal(comboOf(draw(drawer, cx), "t1"), null, "a hit as it fades starts a new count");
  await hitAgain();
  assert.equal(said(comboOf(draw(drawer, cx), "t1")), "3 HIT COMBO");
});

test("an agent that leaves the repository stops its watch and takes no more hits", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  mock.state.panes = [{ pane: "p-t1", cwd: "/tmp" }];
  for (const t of cx.timers.filter((t) => t.every)) t.handler(cx);
  await settle();
  await edit(() => (repo.numstat = "9\t9\ta.js\n"));
  assert.equal(hitOf(draw(drawer, cx), "t1"), null);
});

/** HEAD moves in /repo, once for each [sha, subject] in order, seen in one look. */
async function moves(list) {
  repo.log.push(...list);
  mock.touch("/repo");
  await settle();
}
const sha = (c) => c.repeat(40);

/** A watcher on /repo alone, and what it reported, in order. */
async function watcher() {
  const got = [];
  const w = new EditWatcher(() => {}, (_root, commit) => got.push(["commit", commit]), (root, move) => got.push([move.kind, move.subject, move.sha, root]));
  w.follow(["/repo"], context());
  await settle();
  return got;
}

test("a move's kind is the git command its reflog note names; a commit or a note of any other kind has none", () => {
  // The notes git 2.56 writes, recorded from a real repository.
  const kinds = {
    "checkout: moving from main to x": "checkout",
    "checkout: moving from 98c219a6f1db5d03558069fa5b3c934a1e7f5083 to main": "checkout",
    "checkout: moving from main to main": null, // the branch already checked out: HEAD stays
    "checkout: moving from main to main-2": "checkout",
    "reset: moving to HEAD~1": "reset",
    "reset: moving to HEAD": "reset", // `git stash`, `git reset --hard`: HEAD stays, so the watcher drops it
    "branch: Reset to HEAD~1": "reset", // `git checkout -B main HEAD~1`, before "checkout: moving from main to main"
    "rebase (start): checkout main": "rebase",
    "rebase (pick): yy": "rebase",
    "rebase (finish): returning to refs/heads/y": "rebase",
    "rebase -i (finish): returning to refs/heads/y": "rebase", // older git
    "pull: Fast-forward": "pull",
    "pull -q --ff-only: Fast-forward": "pull",
    "pull -q --no-rebase --no-edit: Merge made by the 'ort' strategy.": "pull",
    "pull -q --rebase (pick): w": "pull",
    "cherry-pick: three": "cherry-pick",
    "commit (cherry-pick): conflictk": "cherry-pick",
    "merge x: Fast-forward": "merge",
    'revert: Revert "two"': "revert",
    "commit: three": null,
    "commit (initial): start": null,
    "commit (amend): reword": null,
    "commit (merge): Merge branch 'x'": null,
    "merge x: Merge made by the 'ort' strategy.": null,
    "clone: from /up": null,
    "checkouts: no": null,
    "": null,
  };
  for (const [subject, kind] of Object.entries(kinds)) assert.equal(moveKind(subject), kind, subject);
});

test("a checkout lands on the working agent, as a hit would, with its kind, commit and note", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  assert.equal(drawer.moves.size, 0, "the reflog's lines before the drawer are no move");
  const before = cx.notified;
  await moves([["b", "checkout: moving from main to x"]]);
  assert.ok(cx.notified > before, "the drawer draws again");
  assert.deepEqual(drawer.moves.get("t1").move, { kind: "checkout", sha: sha("b"), subject: "checkout: moving from main to x" });
  assert.equal(drawer.moves.has("t2"), false, "the idle one in the same repository takes none");
  const first = drawer.moves.get("t1").n;
  await moves([["c", "checkout: moving from x to main"]]);
  assert.ok(drawer.moves.get("t1").n > first, "a later move replaces it");
});

test("with no agent working, a move lands on every agent in the repository", async () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.agent("t3", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }, { pane: "p-t3", cwd: "/tmp" }];
  const { drawer, cx } = await start();
  await moves([["b", "checkout: moving from main to x"]]);
  assert.deepEqual([...drawer.moves.keys()].sort(), ["t1", "t2"]);
  const tree = draw(drawer, cx);
  assert.ok(signOf(tree, "t1") && signOf(tree, "t2") && !signOf(tree, "t3"));
});

test("one look reports one move, the newest: a rebase's many lines are one rebase", async () => {
  const got = await watcher();
  assert.deepEqual(got, [], "the reflog the watch starts with");
  await moves([
    ["a", "rebase (start): checkout main"],
    ["b", "rebase (pick): one"],
    ["c", "rebase (pick): two"],
    ["c", "rebase (finish): returning to refs/heads/x"],
  ]);
  assert.deepEqual(got, [["rebase", "rebase (finish): returning to refs/heads/x", sha("c"), "/repo"]]);
  await moves([["d", "checkout: moving from x to main"], ["e", "cherry-pick: fix"]]);
  assert.deepEqual(got.at(-1), ["cherry-pick", "cherry-pick: fix", sha("e"), "/repo"]);
  assert.equal(got.length, 2);
});

test("a look with a commit in it reports the commit alone, whatever moves come with it", async () => {
  const got = await watcher();
  await moves([["b", "checkout: moving from main to x"], ["c", "commit: work"], ["b", "reset: moving to HEAD~1"]]);
  assert.deepEqual(got, [["commit", sha("c")]]);
});

test("a note of no known kind is no move, and never hides an older one in the same look", async () => {
  const got = await watcher();
  await moves([["b", "clone: from /up"]]);
  assert.deepEqual(got, []);
  await moves([["c", "checkout: moving from main to x"], ["d", "am: patch"]]);
  assert.deepEqual(got, [["checkout", "checkout: moving from main to x", sha("c"), "/repo"]]);
  await moves([]);
  assert.equal(got.length, 1, "a file saved: HEAD did not move");
});

test("a reset that leaves HEAD where it was is no move, and never hides an older one in the same look", async () => {
  const got = await watcher();
  await moves([["a", "reset: moving to HEAD"]]); // `git stash`
  assert.deepEqual(got, []);
  await moves([["b", "checkout: moving from main to x"], ["b", "reset: moving to HEAD"]]);
  assert.deepEqual(got, [["checkout", "checkout: moving from main to x", sha("b"), "/repo"]]);
  await moves([["a", "branch: Reset to HEAD~1"], ["a", "checkout: moving from x to x"]]); // `git checkout -B x HEAD~1`
  assert.deepEqual(got.at(-1), ["reset", "branch: Reset to HEAD~1", sha("a"), "/repo"]);
  assert.equal(got.length, 2);
});

test("git checkout -B from another branch writes only a checkout's note, so it is a checkout", async () => {
  const got = await watcher();
  // `git checkout -B main other` run on `other`: main moves, but HEAD's reflog gets no `branch: Reset to`.
  await moves([["b", "checkout: moving from other to main"]]);
  assert.deepEqual(got, [["checkout", "checkout: moving from other to main", sha("b"), "/repo"]]);
});

/** The signpost by an agent's sprite, or null. */
const signOf = (tree, address) => walk(tree).find((n) => /^pp-sign-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-sign-${address}-`)) ?? null;
/** The board layer of a sign for one frame of its turn: "left", "edge" or "right". */
const board = (sign, side) => find(sign, `${sign.id}-${side}`);
/** Each row of a board's own colors (its last layer, over the outline) as [first x, last x], in px. */
function extents(layer) {
  const paint = walk(layer.children.at(-1)).slice(1);
  const rows = new Map();
  for (const px of paint) {
    const [x, y, w] = [last(px, "left"), last(px, "top"), last(px, "w")];
    const [from, to] = rows.get(y) ?? [Infinity, -Infinity];
    rows.set(y, [Math.min(from, x), Math.max(to, x + w)]);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, ext]) => ext);
}

test("a checkout flips a signpost by the sprite: it shows pointing back, turns edge-on, points on, and fades", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  assert.equal(signOf(draw(drawer, cx), "t1"), null, "no move, no sign");
  await moves([["b", "checkout: moving from main to x"]]);
  let tree = draw(drawer, cx);
  const sign = () => signOf(tree, "t1");
  const shown = () => ["left", "edge", "right"].filter((side) => last(board(sign(), side), "opacity") === 1);
  assert.ok(sign(), "a sign by the creature");
  assert.ok(find(tree, "pp-box-t1") && walk(find(tree, "pp-box-t1")).includes(sign()), "in the sprite's box, so a closed drawer shows it");
  assert.equal(last(sign(), "opacity"), 0, "planted unseen");
  assert.deepEqual(shown(), ["left"]);

  // The left board points left: its middle row reaches further left than its top row; the right board the other way.
  const [left, right] = [extents(board(sign(), "left")), extents(board(sign(), "right"))];
  assert.ok(left[2][0] < left[0][0] && left[2][1] === left[0][1], "pointing left");
  assert.ok(right[2][1] > right[0][1] && right[2][0] === right[0][0], "pointing right");
  assert.ok(extents(board(sign(), "edge")).every(([from, to]) => to - from < right[0][1] - right[0][0]), "edge-on, a narrow plank");

  cx.run(30);
  tree = draw(drawer, cx);
  assert.equal(last(sign(), "opacity"), 1, "it shows");
  assert.deepEqual(shown(), ["left"], "pointing the way HEAD came from");
  cx.run(600);
  tree = draw(drawer, cx);
  assert.deepEqual(shown(), ["left"], "long enough to see");
  cx.run(700);
  tree = draw(drawer, cx);
  assert.deepEqual(shown(), ["edge"], "it turns");
  cx.run(820);
  tree = draw(drawer, cx);
  assert.deepEqual(shown(), ["right"], "and points the way HEAD went");
  cx.run(2300);
  tree = draw(drawer, cx);
  assert.equal(last(sign(), "opacity"), 1, "it holds");
  cx.run(2400);
  tree = draw(drawer, cx);
  assert.equal(last(sign(), "opacity"), 0, "then fades");
  assert.deepEqual(shown(), ["right"]);
  cx.run(3100);
  tree = draw(drawer, cx);
  assert.equal(sign(), null, "and is gone");
  assert.equal(drawer.moves.size, 0, "forgotten too");
});

test("a second checkout starts a new sign; the first one's steps no longer touch it", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "checkout: moving from main to x"]]);
  const first = signOf(draw(drawer, cx), "t1").id;
  cx.run(30);
  // The first sign's steps still to come, held back to run after the second sign starts.
  const pending = cx.timers.filter((t) => !t.every);
  cx.timers = cx.timers.filter((t) => t.every);
  await moves([["c", "checkout: moving from x to main"]]);
  const second = signOf(draw(drawer, cx), "t1").id;
  assert.notEqual(second, first, "a new id: it starts over instead of easing back");
  for (const t of pending) t.handler(cx);
  let tree = draw(drawer, cx);
  assert.equal(signOf(tree, "t1")?.id, second, "the first one's end does not clear the second");
  assert.equal(last(signOf(tree, "t1"), "opacity"), 0, "still planted, as the second's own steps have it");
  cx.run(5000);
  tree = draw(drawer, cx);
  assert.equal(signOf(tree, "t1"), null, "the second's own end clears it");
});

test("a checkout of the branch already checked out, a reset that stays, and a move of a kind with no one-shot yet, show nothing", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const before = cx.notified;
  await moves([["a", "checkout: moving from main to main"]]);
  await moves([["a", "reset: moving to HEAD"]]);
  for (const subject of ['revert: Revert "two"', "cherry-pick: fix"]) {
    await moves([["b", subject]]);
  }
  assert.equal(cx.notified, before, "nothing to draw");
  assert.equal(drawer.moves.size, 0);
  assert.equal(signOf(draw(drawer, cx), "t1"), null);
  assert.equal(cx.timers.filter((t) => !t.every).length, 0, "and nothing left to time");
});

test("a commit and a checkout in one look stamp, with no sign", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"], ["c", "checkout: moving from x to main"]]);
  const tree = draw(drawer, cx);
  assert.equal(signOf(tree, "t1"), null);
  assert.ok(walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")));
});

test("every edge renders a sign beside a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"]]);
  await moves([["c", "checkout: moving from x to main"]]);
  for (const step of [0, 30, 700, 820, 2400]) {
    cx.run(step);
    for (const edge of ["top", "right", "bottom", "left", null]) {
      mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
      const tree = draw(drawer, cx);
      assert.ok(signOf(tree, "t1") && walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), `${edge} at ${step} ms`);
    }
  }
});

/** The rewind in an agent's box, or null. */
const rewindOf = (tree, address) => walk(tree).find((n) => /^pp-rewind-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-rewind-${address}-`)) ?? null;
/** The rewind's slipping bands of rows. */
const bandsOf = (rewind) => walk(rewind).filter((n) => /-band-\d+$/.test(n.id ?? ""));
/** The creature as a rewind draws it: each pixel as "left,top,w,h,color" in px, the bands put together. */
const faceOf = (rewind) => new Set(bandsOf(rewind).flatMap((band) => walk(band).slice(1).map((px) => ["left", "top", "w", "h", "bg"].map((k) => last(px, k)).join(","))));
/** How wide the drawn creature is, in px. */
function widthOf(face) {
  const spans = [...face].map((key) => key.split(",").map(Number)).map(([x, , w]) => [x, x + w]);
  return Math.max(...spans.map(([, to]) => to)) - Math.min(...spans.map(([from]) => from));
}
/** A face's pixels mirrored across the sprite's middle. */
const mirrored = (face) => new Set([...face].map((key) => {
  const [x, y, w, h, color] = key.split(",");
  return [36 - Number(x) - Number(w), y, w, h, color].join(",");
}));
const same = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

test("a reset rewinds the creature: it spins backwards three times, jittering, under a blinking rewind mark, then is itself again", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  assert.equal(rewindOf(tree, "t1"), null, "no move, no rewind");
  const before = cx.notified;
  await moves([["b", "reset: moving to HEAD~1"]]);
  assert.ok(cx.notified > before, "the drawer draws again");
  assert.equal(drawer.moves.get("t1").move.kind, "reset");
  tree = draw(drawer, cx);
  const rewind = () => rewindOf(tree, "t1");
  const sprite = () => find(tree, "pp-spr-t1");
  assert.ok(rewind() && walk(find(tree, "pp-box-t1")).includes(rewind()), "in the sprite's box, so a closed drawer shows it");
  assert.equal(last(sprite(), "opacity"), 0, "the creature itself goes unseen while its copy turns");
  assert.ok(find(rewind(), `${rewind().id}-glyph`), "a rewind mark");
  assert.ok(calls(find(rewind(), `${rewind().id}-glyph`), "loop").some(([p]) => p === "opacity"), "that blinks");
  const bands = bandsOf(rewind());
  assert.ok(bands.length >= 3, "the creature slips in bands of rows");
  const slips = bands.map((band) => calls(band, "loop").find(([p]) => p === "left")?.[1]);
  assert.ok(slips.every((policy) => policy && policy.from < 0 && policy.to > 0), "each slips sideways both ways");
  assert.equal(new Set(slips.map((policy) => policy.period)).size, slips.length, "each on its own beat, so the rows tear apart");
  assert.ok(calls(find(rewind(), `${rewind().id}-bar`), "loop").some(([p]) => p === "top"), "a tracking bar rolls over it");

  const faces = [];
  const ids = [];
  for (let ms = 0; ms < 960; ms += 80) {
    cx.run(ms);
    tree = draw(drawer, cx);
    assert.equal(last(sprite(), "opacity"), 0, `still unseen at ${ms} ms`);
    faces.push(faceOf(rewind()));
    ids.push(bandsOf(rewind()).map((band) => band.id).join(" "));
  }
  assert.equal(new Set(ids).size, 1, "the bands keep their ids through the turn, so the jitter runs on");
  const [front, left, back, right] = faces;
  assert.ok(widthOf(front) >= 24 && widthOf(back) >= 24, "full width from the front and the back");
  assert.ok(widthOf(left) <= 12 && widthOf(right) <= 12, "a third as wide, edge-on");
  assert.ok([...back].every((k) => front.has(k)) && back.size < front.size, "the back is the front without its eyes");
  assert.ok(!same(left, right) && same(mirrored(left), right), "edge-on, one eye shows on the side it turns to: left, then right");
  for (let i = 4; i < 12; i++) assert.ok(same(faces[i], faces[i % 4]), `turn ${Math.floor(i / 4) + 1} like the first`);

  cx.run(960);
  tree = draw(drawer, cx);
  assert.equal(rewind(), null, "the rewind is over");
  assert.notEqual(last(sprite(), "opacity"), 0, "and the creature is itself again");
  assert.equal(drawer.moves.size, 0, "forgotten too");
});

test("git checkout -B is a reset, and a second reset starts the rewind over", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "branch: Reset to HEAD~1"], ["b", "checkout: moving from main to main"]]);
  const first = rewindOf(draw(drawer, cx), "t1").id;
  cx.run(400);
  // The first rewind's steps still to come, held back to run after the second starts.
  const pending = cx.timers.filter((t) => !t.every);
  cx.timers = cx.timers.filter((t) => t.every);
  await moves([["c", "reset: moving to ORIG_HEAD"]]);
  const second = rewindOf(draw(drawer, cx), "t1").id;
  assert.notEqual(second, first, "a new id: it starts over from the front");
  const front = faceOf(rewindOf(draw(drawer, cx), "t1"));
  for (const t of pending) t.handler(cx);
  const tree = draw(drawer, cx);
  assert.equal(rewindOf(tree, "t1")?.id, second, "the first one's end does not clear the second");
  assert.ok(same(faceOf(rewindOf(tree, "t1")), front), "nor turns it: it is still at its own first face");
  cx.run(5000);
  assert.equal(rewindOf(draw(drawer, cx), "t1"), null, "the second's own end clears it");
});

test("every edge renders a rewind beside a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"]]);
  await moves([["a", "reset: moving to HEAD~1"]]);
  for (const step of [0, 80, 160, 240]) {
    cx.run(step);
    for (const edge of ["top", "right", "bottom", "left", null]) {
      mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
      const tree = draw(drawer, cx);
      assert.ok(rewindOf(tree, "t1") && walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), `${edge} at ${step} ms`);
    }
  }
});

/** The deck of cards in an agent's box, or null. */
const deckOf = (tree, address) => walk(tree).find((n) => /^pp-deck-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-deck-${address}-`)) ?? null;
/** The deck's cards, bottom first. */
const cardsOf = (deck) => walk(deck).filter((n) => /-card-\d+$/.test(n.id ?? ""));
/** Where each card is: [left, top] in px. */
const spots = (deck) => cardsOf(deck).map((card) => [last(card, "left"), last(card, "top")]);
/** Each card's glide to where it is: its "left" transition. */
const glides = (deck) => cardsOf(deck).map((card) => calls(card, "transition").find(([p]) => p === "left")?.[1]);
/** Whether every card is in one squared stack: one left, each a little over the one under it. */
const squared = (deck) => {
  const at = spots(deck);
  return new Set(at.map(([x]) => x)).size === 1 && at.every(([, y], i) => i === 0 || y < at[i - 1][1]);
};

test("a rebase shuffles a deck of cards in front of the creature: it splits and riffles twice, then fades", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  assert.equal(deckOf(tree, "t1"), null, "no move, no deck");
  const before = cx.notified;
  await moves([["b", "rebase (start): checkout main"], ["c", "rebase (pick): one"], ["c", "rebase (finish): returning to refs/heads/x"]]);
  assert.ok(cx.notified > before, "the drawer draws again");
  assert.equal(drawer.moves.get("t1").move.kind, "rebase");
  tree = draw(drawer, cx);
  const deck = () => deckOf(tree, "t1");
  const sprite = () => find(tree, "pp-spr-t1");
  assert.ok(deck() && walk(find(tree, "pp-box-t1")).includes(deck()), "in the sprite's box, so a closed drawer shows it");
  assert.equal(deckOf(tree, "t2"), null, "the idle one in the same repository takes none");
  assert.notEqual(last(sprite(), "opacity"), 0, "the creature stays: it is the one shuffling");
  assert.equal(last(deck(), "opacity"), 0, "dealt unseen");
  assert.ok(cardsOf(deck()).length >= 4, "a deck of cards");
  assert.ok(squared(deck()), "squared");
  const ids = cardsOf(deck()).map((card) => card.id).join(" ");
  const [middle, floor] = spots(deck())[0];

  cx.run(30);
  tree = draw(drawer, cx);
  assert.equal(last(deck(), "opacity"), 1, "it shows");
  assert.ok(squared(deck()));
  for (const [split, riffle] of [[350, 600], [1000, 1250]]) {
    cx.run(split);
    tree = draw(drawer, cx);
    const at = spots(deck());
    assert.ok(at.every(([x], i) => (i % 2 ? x > middle : x < middle)), `at ${split} ms it splits: every other card to the left half, the rest to the right`);
    assert.ok(at[0][1] < floor && at[1][1] === at[0][1], "the halves lift, side by side");
    assert.equal(cardsOf(deck()).map((card) => card.id).join(" "), ids, "each card keeps its id, so it glides there");
    cx.run(riffle);
    tree = draw(drawer, cx);
    assert.ok(squared(deck()), `at ${riffle} ms it riffles back into one deck`);
    const delays = glides(deck()).map((policy) => policy?.delay ?? 0);
    assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]), "one card at a time, bottom first, so the halves take turns");
    assert.equal(cardsOf(deck()).map((card) => card.id).join(" "), ids);
  }
  cx.run(2200);
  tree = draw(drawer, cx);
  assert.equal(last(deck(), "opacity"), 1, "it holds");
  cx.run(2300);
  tree = draw(drawer, cx);
  assert.equal(last(deck(), "opacity"), 0, "then fades");
  cx.run(2800);
  tree = draw(drawer, cx);
  assert.equal(deck(), null, "and is gone");
  assert.equal(drawer.moves.size, 0, "forgotten too");
});

test("a rebase's many lines in one look shuffle once; a rebase in a later look starts over", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const timed = () => cx.timers.filter((t) => !t.every).length;
  await moves([["a", "rebase (finish): returning to refs/heads/x"]]);
  const one = timed();
  assert.ok(one > 0);
  cx.run(5000);
  assert.equal(drawer.moves.size, 0);
  const n = drawer.serial;
  await moves([
    ["a", "rebase (start): checkout main"],
    ["b", "rebase (pick): one"],
    ["c", "rebase (pick): two"],
    ["d", "rebase (pick): three"],
    ["d", "rebase (finish): returning to refs/heads/x"],
  ]);
  assert.equal(drawer.serial, n + 1, "one shuffle for the whole rebase");
  assert.equal(timed(), one, "with the steps of one shuffle to time");
  cx.run(5000);
  await moves([["e", "rebase (start): checkout main"]]);
  const first = deckOf(draw(drawer, cx), "t1").id;
  cx.run(400);
  // The first deck's steps still to come, held back to run after the second starts.
  const pending = cx.timers.filter((t) => !t.every);
  cx.timers = cx.timers.filter((t) => t.every);
  await moves([["f", "rebase (finish): returning to refs/heads/x"]]);
  const second = deckOf(draw(drawer, cx), "t1").id;
  assert.notEqual(second, first, "a new id: the next look's rebase deals a new deck");
  for (const t of pending) t.handler(cx);
  const tree = draw(drawer, cx);
  assert.equal(deckOf(tree, "t1")?.id, second, "the first one's end does not clear the second");
  assert.equal(last(deckOf(tree, "t1"), "opacity"), 0, "still dealt unseen, as the second's own steps have it");
  cx.run(5000);
  assert.equal(deckOf(draw(drawer, cx), "t1"), null, "the second's own end clears it");
});

test("every edge renders a deck beside a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"]]);
  await moves([["c", "rebase (finish): returning to refs/heads/x"]]);
  for (const step of [0, 30, 350, 600, 2300]) {
    cx.run(step);
    for (const edge of ["top", "right", "bottom", "left", null]) {
      mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
      const tree = draw(drawer, cx);
      assert.ok(deckOf(tree, "t1") && walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), `${edge} at ${step} ms`);
    }
  }
});

/** The package in an agent's box, or null. */
const packageOf = (tree, address) => walk(tree).find((n) => /^pp-package-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-package-${address}-`)) ?? null;
/** The package's box itself. */
const boxOf = (pkg) => find(pkg, `${pkg.id}-box`);
/** Its puffs of dust. */
const dustOf = (pkg) => walk(pkg).filter((n) => /-dust-\d+$/.test(n.id ?? ""));

test("a pull drops a package in front of the creature: it falls from the top, bounces with a puff of dust, rests, and fades", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  assert.equal(packageOf(tree, "t1"), null, "no move, no package");
  const before = cx.notified;
  await moves([["b", "pull: Fast-forward"]]);
  assert.ok(cx.notified > before, "the drawer draws again");
  assert.equal(drawer.moves.get("t1").move.kind, "pull");
  tree = draw(drawer, cx);
  const pkg = () => packageOf(tree, "t1");
  const box = () => boxOf(pkg());
  const sprite = () => find(tree, "pp-spr-t1");
  assert.ok(pkg() && walk(find(tree, "pp-box-t1")).includes(pkg()), "in the sprite's box, so a closed drawer shows it");
  assert.equal(packageOf(tree, "t2"), null, "the idle one in the same repository takes none");
  assert.notEqual(last(sprite(), "opacity"), 0, "the creature stays: the package lands in front of it");
  assert.equal(last(box(), "opacity"), 0, "dropped unseen");
  assert.equal(last(box(), "top"), 0, "at the top of the box, never over the row above");
  const [x, w] = [last(box(), "left"), last(box(), "w")];
  assert.ok(x >= 6 && x + w <= 42, "over the creature's columns");
  assert.ok(dustOf(pkg()).length >= 2 && dustOf(pkg()).every((d) => last(d, "opacity") === 0), "no dust yet");

  cx.run(30);
  tree = draw(drawer, cx);
  assert.equal(last(box(), "opacity"), 1, "it shows as it falls");
  const rest = last(box(), "top");
  assert.ok(rest > 0, "down to the floor");
  assert.ok(rest + last(box(), "h") <= 44, "inside the box");
  assert.equal(calls(box(), "transition").filter(([p]) => p === "top").at(-1)[1].easing, "ease-in", "faster as it falls");

  cx.run(330);
  tree = draw(drawer, cx);
  assert.ok(last(box(), "top") < rest, "it bounces back up as it lands");
  assert.ok(dustOf(pkg()).every((d) => last(d, "opacity") === 1), "with a puff of dust at each corner");
  const puffs = dustOf(pkg()).map((d) => last(d, "left"));

  cx.run(420);
  tree = draw(drawer, cx);
  assert.equal(last(box(), "top"), rest, "and comes to rest");
  const spread = dustOf(pkg()).map((d) => last(d, "left"));
  assert.ok(spread[0] < puffs[0] && spread[1] > puffs[1], "the dust spreads either way");
  assert.ok(dustOf(pkg()).every((d) => last(d, "opacity") === 0), "and clears");

  cx.run(2100);
  tree = draw(drawer, cx);
  assert.equal(last(box(), "opacity"), 1, "it holds");
  cx.run(2200);
  tree = draw(drawer, cx);
  assert.equal(last(box(), "opacity"), 0, "then fades");
  cx.run(2700);
  tree = draw(drawer, cx);
  assert.equal(pkg(), null, "and is gone");
  assert.equal(drawer.moves.size, 0, "forgotten too");
});

test("a fast-forward merge and a pull that merges drop a package too; a pull --rebase's many lines drop one, and shuffle no deck", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  for (const subject of ["merge x: Fast-forward", "pull --no-rebase: Merge made by the 'ort' strategy."]) {
    await moves([["b", subject]]);
    const tree = draw(drawer, cx);
    assert.ok(packageOf(tree, "t1"), subject);
    assert.equal(walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), false, `${subject}: no stamp`);
    cx.run(5000);
    assert.equal(packageOf(draw(drawer, cx), "t1"), null);
  }
  const n = drawer.serial;
  await moves([
    ["c", "pull --rebase (start): checkout c"],
    ["d", "pull --rebase (pick): one"],
    ["e", "pull --rebase (pick): two"],
    ["e", "pull --rebase (finish): returning to refs/heads/x"],
  ]);
  assert.equal(drawer.serial, n + 1, "one package for the whole pull");
  const tree = draw(drawer, cx);
  assert.ok(packageOf(tree, "t1"));
  assert.equal(deckOf(tree, "t1"), null, "a pull, not a rebase");
});

test("a second pull drops a new package; the first one's steps no longer touch it", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "pull: Fast-forward"]]);
  const first = packageOf(draw(drawer, cx), "t1").id;
  cx.run(400);
  // The first package's steps still to come, held back to run after the second drops.
  const pending = cx.timers.filter((t) => !t.every);
  cx.timers = cx.timers.filter((t) => t.every);
  await moves([["c", "pull: Fast-forward"]]);
  const second = packageOf(draw(drawer, cx), "t1").id;
  assert.notEqual(second, first, "a new id: it drops from the top again");
  for (const t of pending) t.handler(cx);
  const tree = draw(drawer, cx);
  assert.equal(packageOf(tree, "t1")?.id, second, "the first one's end does not clear the second");
  assert.equal(last(boxOf(packageOf(tree, "t1")), "opacity"), 0, "still dropped unseen, as the second's own steps have it");
  cx.run(5000);
  assert.equal(packageOf(draw(drawer, cx), "t1"), null, "the second's own end clears it");
});

test("every edge renders a package beside a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"]]);
  await moves([["c", "pull: Fast-forward"]]);
  for (const step of [0, 30, 330, 420, 2200]) {
    cx.run(step);
    for (const edge of ["top", "right", "bottom", "left", null]) {
      mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
      const tree = draw(drawer, cx);
      assert.ok(packageOf(tree, "t1") && walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), `${edge} at ${step} ms`);
    }
  }
});
