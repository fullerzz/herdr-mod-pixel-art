// Stamps: a commit made in an agent's repository, read from git's reflog, stamped over its
// sprite in the drawer. Git is faked through the herdr stand-in's `exec`, and a change
// through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { isCommit, parseReflog, readMoves, START } from "../mods/pixel-party/edits.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** A reflog line, all in one second, as git writes them. */
const line = ([sha, subject], i, all) =>
  `${(all[i - 1]?.[0] ?? "0").repeat(40)} ${sha.repeat(40)} Ada <ada@x> 1794700000 +0000\t${subject}`;

/**
 * A repository at /repo. `repo.log` is HEAD's reflog as [sha, subject] moves, oldest first
 * (null: no reflog file yet), `repo.gitDir` its git folder, `repo.fails` how many reads of
 * the reflog fail next, `repo.pathFails` how many asks for the reflog's path fail next,
 * `repo.lost` folders git can't tell the repository of for now, and `repo.made` false while
 * /repo is in no repository. Git is 2.30: it knows no `--path-format`, and echoes it back.
 */
let repo;
const logFile = () => `${repo.gitDir}/logs/HEAD`;
function fakeGit() {
  repo = { log: [["a", "commit (initial): start"]], gitDir: "/repo/.git", fails: 0, pathFails: 0, lost: new Set(), made: true };
  mock.state.exec = (command, args, { cwd } = {}) => {
    if (command === "tail") {
      assert.deepEqual([args[0], args[2]], ["-n", logFile()]);
      if (repo.fails > 0) return (repo.fails--, { code: 1, stdout: "", stderr: "tail: read error" });
      if (!repo.log) return { code: 1, stdout: "", stderr: "tail: No such file or directory" };
      const text = repo.log.map(line).map((l) => `${l}\n`);
      return ok(text.slice(Number(args[1].slice(1)) - 1).join(""));
    }
    if (command === "test") return { code: args[1] === logFile() && repo.log ? 0 : 1, stdout: "", stderr: "" };
    assert.equal(command, "git");
    assert.equal(args[0], "--no-optional-locks", "git must not write the index: that is a change too");
    const [verb, ...rest] = args.slice(1);
    if (verb === "rev-parse") {
      if (!repo.made || !cwd.startsWith("/repo") || repo.lost.has(cwd)) return { code: 128, stdout: "", stderr: "not a git repository" };
      const echoed = rest.filter((arg) => arg.startsWith("--path-format")).map((arg) => `${arg}\n`).join("");
      if (rest.includes("--git-path")) {
        if (repo.pathFails > 0) return (repo.pathFails--, { code: 128, stdout: "", stderr: "fatal: unable to read index" });
        // Relative to the folder git ran in when the git folder is inside it, as git prints it.
        const path = logFile().startsWith(`${cwd}/`) ? logFile().slice(cwd.length + 1) : logFile();
        return ok(`${echoed}${path}\n`);
      }
      return ok(rest.includes("--absolute-git-dir") ? `${repo.gitDir}\n` : "/repo\n");
    }
    if (verb === "diff" || verb === "ls-files") return ok();
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

/** HEAD moves in /repo, once for each [sha, subject] in order, seen in one look through a change under `folder`. */
async function moves(list, folder = "/repo") {
  repo.log ??= [];
  repo.log.push(...list);
  mock.touch(folder);
  await settle();
}
const move = (sha, subject, folder) => moves([[sha, subject]], folder);

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const stampOf = (tree, address) => walk(tree).find((n) => n.id?.startsWith(`pp-stamp-${address}-`)) ?? null;
const last = (node, name) => calls(node, name).at(-1)?.[0];

beforeEach(() => {
  mock.reset();
  fakeGit();
});

test("only a commit made here is a commit: a `git commit` or a merge commit, not a checkout, reset, rebase, pull or cherry-pick", () => {
  const notes = {
    "commit: fix the login\twith a tab": true,
    "commit (initial): start": true,
    "commit (amend): reword": true,
    "commit (merge): Merge branch 'x'": true,
    "merge x: Merge made by the 'ort' strategy.": true,
    "merge x: Fast-forward": false,
    "commit (cherry-pick): fix": false,
    "cherry-pick: fix": false,
    "checkout: moving from x to main": false,
    "reset: moving to HEAD~1": false,
    "rebase (finish): returning to refs/heads/x": false,
    "pull: Fast-forward": false,
    "pull: Merge made by the 'ort' strategy.": false,
    "commitment: no": false,
  };
  for (const [subject, commit] of Object.entries(notes)) assert.equal(isCommit(subject), commit, subject);
  const moves = parseReflog([`${"0".repeat(40)} ${"8".repeat(40)} Ada Lovelace <ada@x> 1794700000 +0000\tcommit: fix the login\twith a tab`, "garbage"]);
  assert.deepEqual(moves, [{ sha: "8".repeat(40), subject: "commit: fix the login\twith a tab" }]);
});

test("the reflog is read on from where the last read got to, never twice and never with a gap", async () => {
  repo.log = [["a", "commit (initial): start"], ["b", "commit: two"]];
  const first = await readMoves(logFile(), START);
  assert.deepEqual(first.moves.map((m) => m.subject), ["commit (initial): start", "commit: two"]);
  assert.deepEqual(await readMoves(logFile(), first.to), { moves: [], to: first.to }, "nothing new");
  repo.log.push(...Array.from({ length: 30 }, () => ["b", "reset: moving to HEAD"]), ["c", "commit: three"]);
  const next = await readMoves(logFile(), first.to);
  assert.equal(next.moves.length, 31, "every new line, however many and however alike");
  assert.equal(next.moves.at(-1).subject, "commit: three");
  // `git reflog expire` drops the oldest lines, and a commit lands in the same look.
  repo.log.push(["d", "commit: four"]);
  const expired = repo.log.map(line).slice(-6);
  const logged = mock.state.exec;
  mock.state.exec = (command, args, opts) =>
    command === "tail" ? ok(expired.slice(Number(args[1].slice(1)) - 1).map((l) => `${l}\n`).join("")) : logged(command, args, opts);
  const after = await readMoves(logFile(), next.to);
  mock.state.exec = logged;
  assert.deepEqual(after, { moves: [{ sha: "d".repeat(40), subject: "commit: four" }], to: { lines: 6, last: expired.at(-1) } }, "the last line read is found where it is now");
  repo.log = [["c", "commit: three"]];
  assert.deepEqual(await readMoves(logFile(), next.to), { moves: [], to: { lines: 1, last: line(["c", "commit: three"], 0, repo.log) } }, "a rewritten reflog is read on from its end, with no moves");
  repo.log = null;
  assert.deepEqual(await readMoves(logFile(), START), { moves: [], to: START }, "no reflog yet: nothing to read");
  repo.log = [];
  repo.fails = 1;
  assert.equal(await readMoves(logFile(), START), null, "a failed read of a reflog that is there");
});

test("a commit stamps the working agent's sprite: the tool slams down and lifts, the mark holds and fades", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "the commit that was there before the drawer is no stamp");

  const before = cx.notified;
  await move("b", "commit: add the stamp");
  assert.ok(cx.notified > before);
  let tree = draw(drawer, cx);
  const dropped = stampOf(tree, "t1");
  assert.ok(dropped, "the working agent is stamped");
  assert.equal(stampOf(tree, "t2"), null, "the idle one in the same repository is not");

  const n = dropped.id.split("-").at(-1);
  const tool = () => find(tree, `pp-tool-t1-${n}`);
  const mark = () => find(tree, `pp-mark-t1-${n}`);
  const done = theme().done;
  const inks = (node) => walk(node).flatMap((c) => calls(c, "bg").map(([color]) => color));

  // Dropped: the tool waits unseen above the spot; nothing is marked yet.
  const raised = last(tool(), "top");
  assert.equal(last(tool(), "opacity"), 0);
  assert.equal(last(mark(), "opacity"), 0);
  // Approval is a check in the "done" color, never the "blocked" one, and the tool's rubber is inked with it.
  assert.ok(inks(mark()).includes(done));
  assert.ok(!inks(dropped).includes(theme().blocked));
  assert.ok(inks(tool()).includes(done) && inks(tool()).some((c) => c !== done && !c.startsWith("#000000")), "a tool of its own colors");

  cx.run(30);
  tree = draw(drawer, cx);
  assert.ok(tool(), "the same element, so the change is animated");
  assert.ok(last(tool(), "top") > raised, "the tool slams down");
  assert.equal(last(tool(), "opacity"), 1);
  const fall = Object.fromEntries(calls(tool(), "transition"));
  assert.equal(fall.top.easing, "ease-in", "faster as it nears the sprite");
  assert.equal(last(tool(), "top") + last(tool(), "h"), last(mark(), "top") + last(mark(), "h"), "onto the mark's spot");
  assert.equal(last(mark(), "opacity"), 0, "the tool covers the spot while down");
  const box = find(tree, "pp-box-t1");
  assert.ok(last(box, "top") > 0, "the cell dips under the blow");
  assert.ok(calls(box, "transition").some(([p, policy]) => p === "top" && policy.delay > 0), "as the tool lands, not before");

  cx.run(330);
  tree = draw(drawer, cx);
  assert.equal(last(find(tree, "pp-box-t1"), "top"), 0, "the cell rises again");
  assert.equal(last(tool(), "top"), raised, "the tool lifts away");
  assert.equal(last(tool(), "opacity"), 0);
  assert.equal(last(mark(), "opacity"), 1, "and leaves the mark");

  cx.run(1700);
  tree = draw(drawer, cx);
  assert.equal(last(mark(), "opacity"), 0, "which then fades");

  cx.run(2400);
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "and is gone");
});

test("HEAD moved by a checkout, a reset or a rebase is no stamp", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("b", "checkout: moving from main to x");
  await move("c", "reset: moving to HEAD~1");
  await move("d", "rebase (finish): returning to refs/heads/x");
  assert.equal(stampOf(draw(drawer, cx), "t1"), null);
  await move("e", "commit (amend): reword");
  assert.ok(stampOf(draw(drawer, cx), "t1"), "an amend is a commit");
});

test("a commit and a checkout seen in one look still stamp", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"], ["c", "checkout: moving from x to main"]]);
  assert.ok(stampOf(draw(drawer, cx), "t1"));
});

test("a new repository's first commit stamps", async () => {
  repo.log = null;
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("a", "commit (initial): start");
  assert.ok(stampOf(draw(drawer, cx), "t1"));
});

test("a repository made where the agent already is: its first commit stamps", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  repo.made = false;
  repo.log = null;
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const follow = cx.timers.find((timer) => timer.every).handler;
  // `git init`, then a first commit, between two looks at the folders.
  repo.made = true;
  repo.log = [["a", "commit (initial): start"]];
  follow(cx);
  await settle();
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "the folder is not asked again at once");
  t.mock.timers.tick(10_000);
  follow(cx);
  await settle();
  assert.ok(stampOf(draw(drawer, cx), "t1"), "it is asked again, and the new repository's first commit stamps");
});

test("commits before the drawer are no stamp, even when its first read of the reflog failed", async () => {
  repo.log.push(["b", "commit: yesterday's work"]);
  repo.fails = 1;
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([]);
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "a file saved: HEAD did not move");
  await move("c", "commit: today's work");
  assert.ok(stampOf(draw(drawer, cx), "t1"), "a commit after that stamps");
});

test("a reflog path git could not tell at first is asked for again, and a commit after that stamps", async () => {
  repo.pathFails = 1;
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([]);
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "the first good read is no stamp");
  await move("b", "commit: after the failed ask");
  assert.ok(stampOf(draw(drawer, cx), "t1"));
});

test("a folder found late in a repository already watched does not make it new: no old commit stamps when its watch starts again", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  repo.lost.add("/repo/lib");
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "working" });
  const both = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }];
  mock.state.panes = both;
  const { drawer, cx } = await start();
  const follow = cx.timers.find((timer) => timer.every).handler;
  repo.lost.clear();
  t.mock.timers.tick(10_000);
  follow(cx);
  await settle();
  // Both agents leave, then come back: /repo is watched again from the start.
  mock.state.panes = [];
  follow(cx);
  await settle();
  mock.state.panes = both;
  follow(cx);
  await settle();
  assert.equal(stampOf(draw(drawer, cx), "t1"), null, "the reflog's old commit is no stamp");
});

test("a commit stamps however many moves follow it before the next look, and when it is undone in the same second", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await moves([["b", "commit: x"], ...Array.from({ length: 25 }, () => ["b", "reset: moving to HEAD"])]);
  assert.ok(stampOf(draw(drawer, cx), "t1"), "25 moves after it");
  cx.run(2400);
  // Back to "a" in the same second: the reset's line reads as it did when "a" was first reached.
  await moves([["a", "reset: moving to HEAD~1"]]);
  await moves([["d", "commit: y"], ["a", "reset: moving to HEAD~1"]]);
  assert.ok(stampOf(draw(drawer, cx), "t1"), "a commit undone before the look");
});

test("a clean `git merge` that makes a merge commit stamps; a cherry-pick concluded after a conflict does not", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("e", "commit (cherry-pick): pick a");
  assert.equal(stampOf(draw(drawer, cx), "t1"), null);
  await move("f", "merge x: Merge made by the 'ort' strategy.");
  assert.ok(stampOf(draw(drawer, cx), "t1"));
});

test("with no agent working, every agent in the repository is stamped", async () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }];
  const { drawer, cx } = await start();
  await move("b", "commit: x");
  const tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && stampOf(tree, "t2"));
});

test("a second commit starts a new stamp; the first one's steps no longer touch it", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("b", "commit: one");
  const first = stampOf(draw(drawer, cx), "t1").id;
  cx.run(1700);
  await move("c", "commit: two");
  let tree = draw(drawer, cx);
  const second = stampOf(tree, "t1");
  assert.notEqual(second.id, first, "a new id: it starts over instead of easing back");
  assert.equal(last(walk(second).find((node) => node.id?.startsWith("pp-tool-")), "opacity"), 0, "dropped again");
  cx.run(2400);
  tree = draw(drawer, cx);
  assert.equal(stampOf(tree, "t1"), null, "the second's own end clears it");
});

test("a linked worktree's git folder is watched too, and a commit seen there stamps", async () => {
  repo.gitDir = "/main/.git/worktrees/repo";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  assert.deepEqual(mock.of("watchFolder"), [["/repo"], ["/main/.git/worktrees/repo"]]);
  await move("b", "commit: in a worktree", "/main/.git/worktrees/repo");
  assert.ok(stampOf(draw(drawer, cx), "t1"));
  // Each folder keeps one wait: the one that did not fire is not asked again.
  assert.equal(mock.of("watchFolder").filter(([p]) => p === "/repo").length, 1);
});

test("every edge renders a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("b", "commit: x");
  for (const edge of ["top", "right", "bottom", "left", null]) {
    mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
    assert.ok(stampOf(draw(drawer, cx), "t1"), String(edge));
  }
});
