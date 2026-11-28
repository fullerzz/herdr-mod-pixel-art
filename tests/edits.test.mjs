// Hits: lines an agent adds or removes, read from git, shown over its sprite in the drawer.
// Moves: HEAD moved by a checkout, reset, rebase, pull or cherry-pick, read from its reflog,
// landed on the drawer's agents; a checkout flips a signpost by the sprite. Git is faked
// through the herdr stand-in's `exec`, and a change through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { EditWatcher, countLines, growth, moveKind, parseNumstat } from "../mods/pixel-party/edits.js";
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
    "reset: moving to HEAD": "reset", // `git stash`
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

test("a checkout of the branch already checked out, and a move of a kind with no one-shot yet, show nothing", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const before = cx.notified;
  await moves([["a", "checkout: moving from main to main"]]);
  for (const subject of ["reset: moving to HEAD~1", "rebase (finish): returning to refs/heads/x", "pull: Fast-forward", "cherry-pick: fix"]) {
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
