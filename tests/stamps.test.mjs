// Stamps: a commit made in an agent's repository, read from git's reflog, stamped over its
// sprite in the drawer. Git is faked through the herdr stand-in's `exec`, and a change
// through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, shared, theme } from "herdr";
import Drawer, { GOLD, SOUND, SOUNDS, STAMP_LANDS } from "../mods/pixel-party/drawer.js";
import { FIRE } from "../mods/pixel-party/sprite-view.js";
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
    if (command === "find") return { code: 1, stdout: "", stderr: "find: No such file or directory" };
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
      if (rest.includes("--git-common-dir")) {
        // A linked worktree's shared git folder holds its `worktrees/` folder; git prints it relative when it is inside the folder git ran in.
        const common = repo.gitDir.replace(/\/worktrees\/[^/]+$/, "");
        return ok(common.startsWith(`${cwd}/`) ? `${common.slice(cwd.length + 1)}\n` : `${common}\n`);
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
const clapOf = (tree, address) => walk(tree).find((n) => /^pp-clap-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-clap-${address}-`)) ?? null;
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
  assert.deepEqual(moves, [{ from: "0".repeat(40), sha: "8".repeat(40), subject: "commit: fix the login\twith a tab" }]);
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
  assert.deepEqual(after, { moves: [{ from: "c".repeat(40), sha: "d".repeat(40), subject: "commit: four" }], to: { lines: 6, last: expired.at(-1) } }, "the last line read is found where it is now");
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

  assert.ok(fall.top.duration >= 300, "slow enough to see it fall");

  cx.run(600);
  tree = draw(drawer, cx);
  assert.equal(last(tool(), "opacity"), 1, "it stays down long enough to see");

  cx.run(900);
  tree = draw(drawer, cx);
  assert.equal(last(find(tree, "pp-box-t1"), "top"), 0, "the cell rises again");
  assert.equal(last(tool(), "top"), raised, "the tool lifts away");
  assert.equal(last(tool(), "opacity"), 0);
  assert.equal(last(mark(), "opacity"), 1, "and leaves the mark");

  cx.run(2400);
  tree = draw(drawer, cx);
  assert.equal(last(mark(), "opacity"), 1, "the mark holds for a while");

  cx.run(2700);
  tree = draw(drawer, cx);
  assert.equal(last(mark(), "opacity"), 0, "which then fades");

  cx.run(3800);
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
  cx.run(3800);
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
  cx.run(2700);
  await move("c", "commit: two");
  let tree = draw(drawer, cx);
  const second = stampOf(tree, "t1");
  assert.notEqual(second.id, first, "a new id: it starts over instead of easing back");
  assert.equal(last(walk(second).find((node) => node.id?.startsWith("pp-tool-")), "opacity"), 0, "dropped again");
  cx.run(3800);
  tree = draw(drawer, cx);
  assert.equal(stampOf(tree, "t1"), null, "the second's own end clears it");
});

test("a linked worktree's git folder is watched too, and a commit seen there stamps", async () => {
  repo.gitDir = "/main/.git/worktrees/repo";
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  // Its refs are in the shared git folder, for pushes (tests/pushes.test.mjs).
  assert.deepEqual(mock.of("watchFolder"), [["/repo"], ["/main/.git/worktrees/repo"], ["/main/.git/refs"]]);
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

test("a commit that stamps one agent makes the others in its repository clap: two gloves meet and part, sparks flash, then they fade", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.agent("t3", { status: "blocked" });
  mock.agent("t4", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }, { pane: "p-t3", cwd: "/repo" }, { pane: "p-t4", cwd: "/other" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  assert.ok(!["t1", "t2", "t3", "t4"].some((a) => clapOf(tree, a)), "the commit from before the drawer is no clap");

  await move("b", "commit: land it");
  tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && !clapOf(tree, "t1"), "the committer is stamped, and does not clap");
  assert.ok(clapOf(tree, "t2") && clapOf(tree, "t3"), "the others in the repository clap, whatever their status");
  assert.ok(!stampOf(tree, "t2") && !stampOf(tree, "t3"));
  assert.equal(clapOf(tree, "t4"), null, "an agent in no repository does not");

  const clap = clapOf(tree, "t2");
  const left = find(tree, `${clap.id}-left`);
  const right = find(tree, `${clap.id}-right`);
  const [, swing] = calls(left, "loop").find(([p]) => p === "left");
  const [, back] = calls(right, "loop").find(([p]) => p === "left");
  assert.ok(swing.from < swing.to && back.from > back.to, "the hands swing toward each other");
  assert.equal(swing.to + last(left, "w"), back.to, "and meet");
  assert.equal(swing.period, back.period, "on one beat");
  const sparks = walk(clap).filter((node) => node.id?.startsWith(`${clap.id}-spark-`));
  assert.ok(sparks.length > 0);
  for (const spark of sparks) assert.deepEqual(calls(spark, "loop").find(([p]) => p === "opacity")[1], { from: 0, to: 1, period: swing.period }, "a spark flashes on each clap");
  assert.equal(last(clap, "opacity"), 1);

  cx.run(720);
  tree = draw(drawer, cx);
  assert.equal(clapOf(tree, "t2").id, clap.id, "the same clap, so the fade is animated");
  assert.equal(last(clapOf(tree, "t2"), "opacity"), 0, "the gloves fade after three claps");
  cx.run(1100);
  tree = draw(drawer, cx);
  assert.equal(clapOf(tree, "t2"), null, "and are gone");
  assert.ok(stampOf(tree, "t1"), "while the stamp plays on");
});

test("with no agent working the commit stamps them all, and no one claps; a checkout or reset is no clap", async () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await move("b", "commit: x");
  let tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && stampOf(tree, "t2"));
  assert.ok(!clapOf(tree, "t1") && !clapOf(tree, "t2"));
  mock.state.agents.find((a) => a.address === "t1").status = "working";
  await move("c", "checkout: moving from main to x");
  await move("d", "reset: moving to HEAD~1");
  tree = draw(drawer, cx);
  assert.ok(!clapOf(tree, "t2"), "only a commit");
});

test("an agent that leaves mid-clap leaves with no clap, and every edge renders a clap with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  draw(drawer, cx);
  await move("b", "commit: x");
  for (const edge of ["top", "right", "bottom", "left", null]) {
    mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
    assert.ok(clapOf(draw(drawer, cx), "t2"), String(edge));
  }
  mock.state.agents = mock.state.agents.filter((a) => a.address !== "t2");
  const tree = draw(drawer, cx);
  assert.ok(find(tree, "pp-box-t2"), "its ghost is drawn");
  assert.equal(clapOf(tree, "t2"), null, "with only its creature and exit");
});

const inksOf = (node) => walk(node).flatMap((c) => calls(c, "bg").map(([color]) => color));
/** The rubber's and the mark's ink: the one color of the stamp that is no part of the tool and no outline. */
const inkOf = (stamp) => {
  const n = stamp.id.split("-").at(-1);
  const address = stamp.id.split("-").at(-2);
  const [ink] = inksOf(walk(stamp).find((node) => node.id === `pp-mark-${address}-${n}`)).filter((c) => c !== "#101016");
  return ink;
};
/** How far apart two #rrggbb colors are, as points in RGB. */
const distance = (a, b) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

test("an agent's tenth stamp of the day is gold, the same stamp in another ink; the ninth and eleventh are not", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 27, 9).getTime() });
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  const done = theme().done;
  /** @type {string[]} */
  const inks = [];
  for (let i = 1; i <= 11; i++) {
    await move(`c${i}`, `commit: number ${i}`);
    const tree = draw(drawer, cx);
    const stamp = stampOf(tree, "t1");
    inks.push(inkOf(stamp));
    if (i === 10) {
      const n = stamp.id.split("-").at(-1);
      assert.ok(inksOf(find(tree, `pp-tool-t1-${n}`)).includes(GOLD), "the tool's rubber is inked gold too");
      assert.ok(!inksOf(stamp).includes(done), "with no green left on it");
    }
    assert.equal(clapOf(tree, "t1"), null);
    cx.run(3800);
  }
  assert.deepEqual(inks, [...Array(9).fill(done), GOLD, done], "only the tenth");
});

test("a clap is no stamp: an agent that claps for others' commits counts none of them", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  for (let i = 1; i <= 9; i++) await move(`c${i}`, `commit: t1's ${i}`);
  assert.ok(clapOf(draw(drawer, cx), "t2"), "t2 clapped for them");
  // t1 stops; t2 now works, and its first commit is its first stamp, not its tenth.
  mock.state.agents.find((a) => a.address === "t1").status = "idle";
  mock.state.agents.find((a) => a.address === "t2").status = "working";
  await move("d", "commit: t2's first");
  assert.equal(inkOf(stampOf(draw(drawer, cx), "t2")), theme().done);
  mock.state.agents.find((a) => a.address === "t1").status = "working";
  mock.state.agents.find((a) => a.address === "t2").status = "idle";
  await move("e", "commit: t1's tenth");
  assert.equal(inkOf(stampOf(draw(drawer, cx), "t1")), GOLD, "and t1's count went on");
});

test("a new day starts the count over", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 27, 9).getTime() });
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  for (let i = 1; i <= 9; i++) await move(`c${i}`, `commit: ${i}`);
  t.mock.timers.tick(48 * 3600_000);
  for (let i = 1; i <= 9; i++) await move(`d${i}`, `commit: ${i}`);
  assert.equal(inkOf(stampOf(draw(drawer, cx), "t1")), theme().done, "nine yesterday and nine today are no ten");
  await move("e", "commit: today's tenth");
  assert.equal(inkOf(stampOf(draw(drawer, cx), "t1")), GOLD);
});

test("the gold is its own: no fire color, no status cue, and clear of the fire on a blocked creature it lands on", async () => {
  mock.agent("t1", { status: "blocked" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  for (let i = 1; i <= 10; i++) await move(`c${i}`, `commit: ${i}`);
  const stamp = stampOf(draw(drawer, cx), "t1");
  assert.equal(inkOf(stamp), GOLD, "with no agent working, the blocked one is stamped");
  const taken = [...Object.values(FIRE), theme().done, theme().blocked];
  assert.ok(!inksOf(stamp).some((c) => taken.includes(c)));
  for (const flame of Object.values(FIRE)) assert.ok(distance(GOLD, flame) >= 48, `${GOLD} reads apart from ${flame}`);
});

test("a stamp makes no sound until the person turns sounds on; then a commit thunks once, as the tool lands, and claps make none", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  draw(drawer, cx);
  await move("b", "commit: quiet");
  let tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && clapOf(tree, "t2"), "the stamp and the clap show as ever");
  cx.run(Infinity);
  assert.deepEqual(mock.of("playSound"), [], "off by default");

  drawer.command("sounds-on");
  assert.equal(shared(SOUNDS), true);
  await move("c", "commit: loud");
  tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && clapOf(tree, "t2"));
  cx.run(STAMP_LANDS - 1);
  assert.deepEqual(mock.of("playSound"), [], "not before the tool lands");
  cx.run(STAMP_LANDS);
  assert.deepEqual(mock.of("playSound"), [[SOUND.stamp]], "one thunk for the stamp, none for the clap");
  cx.run(Infinity);
  assert.equal(mock.of("playSound").length, 1);

  drawer.command("sounds-off");
  assert.equal(shared(SOUNDS), false);
  await move("d", "commit: quiet again");
  assert.ok(stampOf(draw(drawer, cx), "t1"));
  cx.run(Infinity);
  assert.equal(mock.of("playSound").length, 1, "off again");
});

test("with sounds on, a commit that stamps several agents thunks once", async () => {
  mock.state.shared[SOUNDS] = true;
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }];
  const { drawer, cx } = await start();
  await move("b", "commit: x");
  const tree = draw(drawer, cx);
  assert.ok(stampOf(tree, "t1") && stampOf(tree, "t2"));
  cx.run(Infinity);
  assert.deepEqual(mock.of("playSound"), [[SOUND.stamp]]);
});
