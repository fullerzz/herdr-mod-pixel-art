// The XP bar: the lines changed in an agent's repository since its last commit fill a bar
// under its sprite's box, and a commit cashes them in: the bar drains as the stamp lands,
// and a full bar pops a LEVEL UP. Git is faked through the herdr stand-in's `exec`, and a
// change through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { BEE_H } from "../mods/pixel-party/bees.js";
import { EditWatcher, LEVEL_LINES, changed, parseNumstat } from "../mods/pixel-party/edits.js";
import { calls, check, context, find, text, walk } from "./mocks/gpui.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const line = ([sha, subject], i, all) =>
  `${(all[i - 1]?.[0] ?? "0").repeat(40)} ${sha.repeat(40)} Ada <ada@x> 1794700000 +0000\t${subject}`;
const LOG = "/repo/.git/logs/HEAD";

/** A repository at /repo: its diff against HEAD, its new files, and HEAD's reflog as [sha, subject], oldest first. */
let repo;
function fakeGit() {
  repo = { numstat: "", untracked: [], log: [["a", "commit (initial): start"]] };
  mock.state.exec = (command, args, { cwd } = {}) => {
    if (command === "tail") return ok(repo.log.map(line).map((l) => `${l}\n`).slice(Number(args[1].slice(1)) - 1).join(""));
    if (command === "test") return { code: args[1] === LOG ? 0 : 1, stdout: "", stderr: "" };
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

async function start() {
  const drawer = new Drawer();
  const cx = context();
  drawer.init({}, cx);
  await settle();
  return { drawer, cx };
}

/** A change in /repo, seen in one look. */
async function edit(change) {
  change();
  mock.touch("/repo");
  await settle();
}
/** A commit that takes every changed line: the diff is empty in the same look. */
const commit = (sha = "b") => edit(() => {
  repo.numstat = "";
  repo.untracked = [];
  repo.log.push([sha, "commit: cash in"]);
});

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const last = (node, name) => calls(node, name).at(-1)?.[0];
const barOf = (tree, address) => find(tree, `pp-xp-${address}`);
/** The bar's fill, in px of its width. */
const fillOf = (tree, address) => last(find(tree, `pp-xp-${address}-fill`), "w");
const levelOf = (tree, address) => walk(tree).find((n) => n.id?.startsWith(`pp-level-${address}-`)) ?? null;
const hitOf = (tree, address) => walk(tree).find((n) => n.id?.startsWith(`pp-hit-${address}-`)) ?? null;
/** An element's box in its cell, from its own left, top, w and h. */
const rect = (node) => ({ x: last(node, "left"), y: last(node, "top"), w: last(node, "w"), h: last(node, "h") });

beforeEach(() => {
  mock.reset();
  fakeGit();
});

test("a diff's uncommitted lines are its added and removed lines together", () => {
  assert.equal(changed(parseNumstat("3\t1\ta.js\n-\t-\timg.png\n10\t0\tb.md\n")), 14);
  assert.equal(changed(new Map()), 0);
});

test("the watcher keeps each repository's uncommitted lines from its first read, and reports each change, a shrink included", async () => {
  repo.numstat = "4\t2\ta.js\n";
  repo.untracked = ["new.js"];
  mock.state.files["/repo/new.js"] = "one\ntwo\nthree\n";
  const seen = [];
  const watcher = new EditWatcher(() => {}, () => {}, () => {}, (root, lines) => seen.push([root, lines]));
  const cx = context();
  watcher.follow(["/repo"], cx);
  await settle();
  assert.deepEqual(seen, [["/repo", 9]], "the first read is reported: untracked files count");
  assert.equal(watcher.uncommitted("/repo"), 9);

  await edit(() => {});
  assert.equal(seen.length, 1, "the same lines again are no change");
  await edit(() => {
    repo.untracked = [];
    repo.numstat = "1\t0\ta.js\n";
  });
  assert.deepEqual(seen.at(-1), ["/repo", 1], "a revert shrinks them, and that is reported too");

  watcher.follow([], cx);
  assert.equal(watcher.uncommitted("/repo"), null, "a repository no longer watched is forgotten");
});

test("the bar fills with the lines changed since the last commit, under the box, from the start", async () => {
  repo.numstat = `${LEVEL_LINES / 4}\t0\ta.js\n`;
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.agent("t3", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/src" }, { pane: "p-t3", cwd: "/tmp" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  const bar = barOf(tree, "t1");
  assert.ok(bar, "the lines there before the drawer fill it at once");
  assert.equal(hitOf(tree, "t1"), null, "and are no hit");
  assert.equal(fillOf(tree, "t1"), last(bar, "w") / 4, "a quarter of a level fills a quarter of the bar");
  assert.equal(fillOf(tree, "t2"), fillOf(tree, "t1"), "every agent in the repository shows it");
  assert.equal(barOf(tree, "t3"), null, "an agent in no repository has none");

  const box = find(tree, "pp-box-t1");
  assert.ok(rect(bar).y >= last(box, "h"), "under the box: clear of the combo, the hits, the stamp and the sign in it");
  assert.ok(!walk(box).includes(bar));

  const before = cx.notified;
  await edit(() => (repo.numstat = `${LEVEL_LINES / 2}\t${LEVEL_LINES / 4}\ta.js\n`));
  assert.ok(cx.notified > before);
  tree = draw(drawer, cx);
  assert.equal(fillOf(tree, "t1"), (last(bar, "w") * 3) / 4, "removed lines count as well");
  assert.ok(calls(find(tree, "pp-xp-t1-fill"), "transition").some(([p]) => p === "width"), "the same element, so it slides to its new width");

  await edit(() => (repo.numstat = `${LEVEL_LINES * 3}\t0\ta.js\n`));
  assert.equal(fillOf(draw(drawer, cx), "t1"), last(bar, "w"), "past a level it is full");

  const notified = cx.notified;
  await edit(() => (repo.numstat = ""));
  assert.ok(cx.notified > notified, "a revert is drawn though it is no hit");
  assert.equal(barOf(draw(drawer, cx), "t1"), null, "with nothing uncommitted there is no bar");
});

test("the bar takes a strip of its own between the box and the bees, and its cell grows by it", async () => {
  repo.numstat = "10\t0\ta.js\n";
  mock.agent("t1", { status: "working" });
  mock.agent("t3", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t3", cwd: "/tmp" }];
  mock.state.terminals.push({ address: "t9", parent: "t1", state: "live", labels: {} });
  const { drawer, cx } = await start();
  for (const edge of ["top", "right", "bottom", "left", null]) {
    mock.state.placement = edge && { edge };
    draw(drawer, cx);
    cx.run(40);
    const tree = draw(drawer, cx);
    const bar = barOf(tree, "t1");
    const cellOf = (address) => walk(tree).find((n) => n.children.some((c) => walk(c)[0]?.id === `pp-box-${address}`));
    const bee = walk(cellOf("t1")).find((n) => n.id?.startsWith("pp-bee-t1-"));
    assert.ok(cellOf("t1").children.some((c) => walk(c)[0] === bar), `${edge}: the bar is beside the box, in the cell`);
    assert.ok(rect(bee).y - 2 >= rect(bar).y + rect(bar).h, `${edge}: the bees go under the bar, a flying one too`);
    assert.ok(rect(bee).y + BEE_H * 2 <= last(cellOf("t1"), "h"), `${edge}: inside the cell, which grows for the bar and the lane`);
    assert.equal(last(cellOf("t3"), "h"), last(find(tree, "pp-box-t3"), "h"), `${edge}: a cell with no bar and no bees is the box`);
  }
});

test("a commit cashes the bar in: it holds as the stamp falls, drains as it lands, and a full bar pops a LEVEL UP that rises and fades", async () => {
  repo.numstat = `${LEVEL_LINES}\t20\ta.js\n`;
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const full = last(barOf(draw(drawer, cx), "t1"), "w");

  await commit();
  let tree = draw(drawer, cx);
  assert.ok(walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), "the stamp lands");
  assert.equal(fillOf(tree, "t1"), full, "the bar holds what the commit took while the stamp falls");
  assert.equal(barOf(tree, "t2"), null, "the idle agent in the repository has its bar emptied, with no cash-in");
  const level = levelOf(tree, "t1");
  assert.equal(level, null, "no level up before the stamp lands");

  cx.run(370);
  tree = draw(drawer, cx);
  assert.equal(fillOf(tree, "t1"), 0, "as the stamp lands, the bar drains");
  const drain = Object.fromEntries(calls(find(tree, "pp-xp-t1-fill"), "transition"));
  assert.ok(drain.width.duration >= 400, "slowly enough to see");
  let up = levelOf(tree, "t1");
  assert.ok(up, "the level up waits");
  assert.equal(last(up, "opacity"), 0, "unseen");
  const low = last(up, "top");

  cx.run(1300);
  tree = draw(drawer, cx);
  up = find(tree, up.id);
  assert.ok(up, "the same element, so it pops in");
  assert.equal(last(up, "opacity"), 1);
  const popped = last(up, "top");
  assert.ok(popped < low, "rising into place");
  assert.ok(walk(find(tree, "pp-box-t1")).includes(up), "over the creature, in the box a closed drawer shows");
  assert.deepEqual([...new Set(text(up).split(" "))].join(" "), "LEVEL UP");
  assert.ok(walk(up).flatMap((n) => calls(n, "text_color").map(([c]) => c)).includes("#000000c0"), "outlined, as the numbers are");
  const mark = walk(tree).find((n) => n.id?.startsWith("pp-mark-t1-"));
  assert.ok(rect(up).y + rect(up).h <= rect(mark).y, "above the stamp's mark, which still holds");
  assert.equal(last(walk(tree).find((n) => n.id?.startsWith("pp-tool-t1-")), "opacity"), 0, "the stamp's tool has lifted away");

  cx.run(2100);
  tree = draw(drawer, cx);
  up = find(tree, up.id);
  assert.equal(last(up, "opacity"), 0, "it fades");
  assert.ok(last(up, "top") < popped, "rising on");

  cx.run(2700);
  tree = draw(drawer, cx);
  assert.equal(levelOf(tree, "t1"), null, "and is gone");
  assert.equal(barOf(tree, "t1"), null, "the empty bar goes with it");
});

test("a commit of less than a level drains the bar with no level up, and one with nothing to cash in has no bar at all", async () => {
  repo.numstat = "30\t0\ta.js\n";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await commit();
  cx.run(370);
  let tree = draw(drawer, cx);
  assert.equal(fillOf(tree, "t1"), 0, "it drains");
  for (const ms of [1300, 2100]) {
    cx.run(ms);
    assert.equal(levelOf(draw(drawer, cx), "t1"), null, `no level up at ${ms} ms`);
  }
  cx.run(2700);

  await edit(() => repo.log.push(["c", "commit (amend): reword"]));
  tree = draw(drawer, cx);
  assert.ok(walk(tree).some((n) => n.id?.startsWith("pp-stamp-t1-")), "an amend with nothing changed still stamps");
  assert.equal(barOf(tree, "t1"), null, "but has no bar to cash in");
  cx.run(1300);
  assert.equal(levelOf(draw(drawer, cx), "t1"), null);
});

test("a commit that leaves lines behind drains the bar to what is left", async () => {
  repo.numstat = "40\t0\ta.js\n40\t0\tb.js\n";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const full = last(barOf(draw(drawer, cx), "t1"), "w");
  await edit(() => {
    repo.numstat = "40\t0\tb.js\n";
    repo.log.push(["b", "commit: only a.js"]);
  });
  cx.run(370);
  assert.equal(fillOf(draw(drawer, cx), "t1"), Math.round((full * 40) / LEVEL_LINES));
});

test("only a commit that takes a level's worth of lines levels up: not one that leaves the bar full, nor one that takes nothing", async () => {
  repo.numstat = "150\t0\ta.js\n";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const full = last(barOf(draw(drawer, cx), "t1"), "w");

  await edit(() => repo.log.push(["b", "commit (amend): reword"]));
  cx.run(1300);
  let tree = draw(drawer, cx);
  assert.equal(levelOf(tree, "t1"), null, "a reword takes no lines");
  assert.equal(fillOf(tree, "t1"), full, "and the bar stays full");
  cx.run(2700);

  await edit(() => {
    repo.numstat = "145\t0\ta.js\n";
    repo.log.push(["c", "commit: five lines"]);
  });
  cx.run(1300);
  assert.equal(levelOf(draw(drawer, cx), "t1"), null, "five lines are no level, though the bar was full");
  cx.run(2700);

  await edit(() => {
    repo.numstat = "40\t0\ta.js\n";
    repo.log.push(["d", "commit: a level"]);
  });
  cx.run(1300);
  tree = draw(drawer, cx);
  assert.equal(last(levelOf(tree, "t1"), "opacity"), 1, "105 lines taken are a level");
  assert.equal(fillOf(tree, "t1"), Math.round((full * 40) / LEVEL_LINES), "and the bar drained to what is left");
});

test("a leaving agent's ghost shows no bar", async () => {
  repo.numstat = "10\t0\ta.js\n";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  assert.ok(barOf(draw(drawer, cx), "t1"));
  mock.state.agents = [];
  const tree = draw(drawer, cx);
  assert.ok(find(tree, "pp-box-t1"), "its ghost is drawn");
  assert.equal(barOf(tree, "t1"), null);
});
