// Pushes: a push moves a remote-tracking ref, not HEAD, and git notes it in that ref's own
// reflog as "update by push". The watcher reads those reflogs as it reads HEAD's, and the
// drawer launches a small rocket off the creature. Git is faked through the herdr stand-in's
// `exec`, and a change through `mock.touch`.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { EditWatcher, isPush, tracks } from "../mods/pixel-party/edits.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

/** Lets spawned tasks run until they wait on something that has not happened. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const sha = (c) => c.repeat(40);

/** Reflog lines, as git writes them: each from the commit the one before went to. */
const lines = (moves) => moves.map(([to, subject], i) => `${sha(moves[i - 1]?.[0] ?? "0")} ${sha(to)} Ada <ada@x> 1794700000 +0000\t${subject}\n`);

/**
 * A repository at /repo. `repo.head` is HEAD's reflog as [sha, subject] moves, oldest first;
 * HEAD is at the last one's commit. `repo.remotes` holds each remote-tracking ref's reflog,
 * by its name under `refs/remotes/`. `repo.common` is the shared git folder and `repo.gitDir`
 * the worktree's own; `repo.findFails` how many counts of the remote reflogs fail next.
 * `repo.branch` is the branch checked out, null for a detached HEAD.
 */
let repo;
const remotesDir = () => `${repo.common}/logs/refs/remotes`;
const headLog = () => `${repo.gitDir}/logs/HEAD`;
function fakeGit() {
  repo = { head: [["a", "commit (initial): start"]], remotes: {}, common: "/repo/.git", gitDir: "/repo/.git", findFails: 0, branch: "main" };
  mock.state.exec = (command, args, { cwd } = {}) => {
    const fileOf = (path) => path === headLog() ? repo.head : path.startsWith(`${remotesDir()}/`) ? repo.remotes[path.slice(remotesDir().length + 1)] : undefined;
    if (command === "tail") {
      assert.equal(args[0], "-n");
      const log = fileOf(args[2]);
      if (!log) return { code: 1, stdout: "", stderr: "tail: No such file or directory" };
      return ok(lines(log).slice(Number(args[1].slice(1)) - 1).join(""));
    }
    if (command === "test") {
      const path = args[1];
      const there = path === remotesDir() ? Object.keys(repo.remotes).length > 0 : Boolean(fileOf(path));
      return { code: there ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "find") {
      assert.deepEqual(args.slice(1), ["-type", "f", "-exec", "wc", "-l", "{}", "+"]);
      if (repo.findFails > 0) return (repo.findFails--, { code: 1, stdout: "", stderr: "find: Permission denied" });
      const names = Object.keys(repo.remotes);
      if (args[0] !== remotesDir() || !names.length) return { code: 1, stdout: "", stderr: "find: No such file or directory" };
      // As macOS `wc` prints them: padded counts, and a total for more than one file.
      const rows = names.map((name) => `${String(repo.remotes[name].length).padStart(8)} ${remotesDir()}/${name}\n`);
      const total = names.length > 1 ? `${String(names.reduce((n, name) => n + repo.remotes[name].length, 0)).padStart(8)} total\n` : "";
      return ok(rows.join("") + total);
    }
    assert.equal(command, "git");
    assert.equal(args[0], "--no-optional-locks", "git must not write the index: that is a change too");
    const [verb, ...rest] = args.slice(1);
    if (verb === "rev-parse") {
      if (!cwd.startsWith("/repo")) return { code: 128, stdout: "", stderr: "not a git repository" };
      /** @type {(path: string) => string} As git prints a path: relative to the folder it ran in when inside it. */
      const shown = (path) => (path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path);
      if (rest.includes("--git-path")) return ok(`${shown(headLog())}\n`);
      if (rest.includes("--git-common-dir")) return ok(`${shown(repo.common)}\n`);
      if (rest.includes("--absolute-git-dir")) return ok(`${repo.gitDir}\n`);
      if (rest[0] === "HEAD") return ok(`${sha(repo.head.at(-1)[0])}\n`);
      return ok("/repo\n");
    }
    if (verb === "symbolic-ref") {
      assert.deepEqual(rest, ["-q", "HEAD"]);
      return repo.branch ? ok(`refs/heads/${repo.branch}\n`) : { code: 1, stdout: "", stderr: "" };
    }
    if (verb === "diff" || verb === "ls-files") return ok();
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

beforeEach(() => {
  mock.reset();
  fakeGit();
});

/** Things happen in /repo, then one look sees them all, through a change under `folder`. */
async function look(change = () => {}, folder = "/repo") {
  change();
  mock.touch(folder);
  await settle();
}
/** A push of HEAD's commit to `ref`, as git notes it in the ref's reflog. */
const push = (ref = "origin/main", to = repo.head.at(-1)[0]) => (repo.remotes[ref] ??= []).push([to, "update by push"]);
/** HEAD moves, as git notes it in its reflog; a checkout checks out the branch it names. */
const move = (to, subject) => {
  repo.head.push([to, subject]);
  const m = /^checkout: moving from .+ to (.+)$/.exec(subject);
  if (m) repo.branch = m[1];
};

/** A watcher on /repo alone, and what it reported, in order. */
async function watcher() {
  const got = [];
  const w = new EditWatcher(() => {}, (_root, commit) => got.push(["commit", commit]), (root, m) => got.push([m.kind, m.subject, m.sha, root]));
  w.follow(["/repo"], context());
  await settle();
  return got;
}

/** A drawer that has started watching, and its context. */
async function start() {
  const drawer = new Drawer();
  const cx = context();
  drawer.init({}, cx);
  await settle();
  return { drawer, cx };
}
const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const last = (node, name) => calls(node, name).at(-1)?.[0];
/** The rocket's one-shot in an agent's box, or null. */
const rocketOf = (tree, address) => walk(tree).find((n) => /^pp-rocket-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-rocket-${address}-`)) ?? null;
const shipOf = (shot) => find(shot, `${shot.id}-ship`);
const flameOf = (shot) => find(shot, `${shot.id}-flame`);
const bodyOf = (shot) => find(shot, `${shot.id}-body`);
/** The exhaust's clouds, none before lift-off. */
const cloudsOf = (shot) => walk(shot).filter((n) => n.id?.startsWith(`${shot.id}-exhaust-cloud-`));
const hasStamp = (tree, address) => walk(tree).some((n) => n.id?.startsWith(`pp-stamp-${address}-`));

test("git's note for a push is a push; a fetch's or a pull's on the same ref is not", () => {
  // The notes git 2.56 writes in `logs/refs/remotes/origin/main`, recorded from a real repository.
  assert.equal(isPush("update by push"), true); // a push, a force push, and a branch's first push
  for (const subject of ["fetch -q: fast-forward", "fetch: storing head", "pull -q --rebase: fast-forward", "update by push "]) assert.equal(isPush(subject), false, subject);
});

test("a push is reported as a move of kind push, with the commit it pushed; the pushes before the watch are none", async () => {
  push("origin/main");
  const got = await watcher();
  assert.deepEqual(got, [], "the reflogs the watch starts with");
  await look(() => {
    move("b", "commit: two");
    push("origin/main");
  });
  assert.deepEqual(got, [["commit", sha("b")], ["push", "update by push", sha("b"), "/repo"]], "a commit and its push in one look: both, the push after");
  await look(() => {
    move("c", "commit: three");
    push("origin/main");
    repo.remotes["origin/main"].push(["c", "update by push"]);
  });
  assert.equal(got.filter(([kind]) => kind === "push").length, 2, "one push a look, however many lines");
});

test("a fetch or a pull moves the same ref, and is no push", async () => {
  push("origin/main");
  const got = await watcher();
  await look(() => repo.remotes["origin/main"].push(["e", "fetch -q: fast-forward"]));
  await look(() => {
    repo.remotes["origin/main"].push(["f", "pull -q --rebase: fast-forward"]);
    move("f", "pull -q --rebase (finish): returning to refs/heads/main");
  });
  assert.deepEqual(got, [["pull", "pull -q --rebase (finish): returning to refs/heads/main", sha("f"), "/repo"]], "the pull's move of HEAD only");
});

test("a branch's first push makes its reflog, in folders of its own, and counts from its start", async () => {
  push("origin/main");
  const got = await watcher();
  await look(() => {
    move("b", "checkout: moving from main to issue/36-rocket");
    move("c", "commit: rocket");
    push("origin/issue/36-rocket");
  });
  assert.deepEqual(got.at(-1), ["push", "update by push", sha("c"), "/repo"]);
});

test("only the reflogs that grew are read, in one count of them all per look", async () => {
  push("origin/main");
  push("origin/a");
  push("origin/b");
  await watcher();
  const tails = () => mock.of("exec").filter(([command]) => command === "tail").map(([, args]) => args[2]);
  const finds = () => mock.of("exec").filter(([command]) => command === "find").length;
  const [t0, f0] = [tails().length, finds()];
  await look(() => push("origin/b"));
  assert.deepEqual(tails().slice(t0), ["/repo/.git/logs/HEAD", "/repo/.git/logs/refs/remotes/origin/b"], "HEAD's and the one that grew");
  assert.equal(finds() - f0, 1);
});

test("a remote-tracking ref is a branch's when its name past the remote's is the branch's", () => {
  assert.equal(tracks("origin/main", "main"), true);
  assert.equal(tracks("upstream/main", "main"), true);
  assert.equal(tracks("origin/issue/36-x", "issue/36-x"), true);
  assert.equal(tracks("origin/issue/36-x", "36-x"), false, "a tail of the name is another branch");
  assert.equal(tracks("origin/main", "origin/main"), false);
  assert.equal(tracks("main", "main"), false, "no remote");
});

test("a push from another worktree writes the same shared reflog, and is none here, even at the commit HEAD is at", async () => {
  push("origin/main");
  const got = await watcher();
  await look(() => push("origin/elsewhere", "d")); // its HEAD is at d; this one's is not
  assert.deepEqual(got, []);
  // A fresh worktree branched from here pushes its branch first: the same commit, another branch.
  await look(() => push("origin/elsewhere"));
  assert.deepEqual(got, []);
  await look(() => push("origin/main")); // the branch checked out here, at the commit HEAD is at
  assert.deepEqual(got, [["push", "update by push", sha("a"), "/repo"]]);
});

test("a push from a fresh worktree's branch is none for the worktree it was branched from, and the other way", async () => {
  // Two worktrees at one commit: this one on issue/36-x, the main one on main.
  repo.branch = "issue/36-x";
  const got = await watcher();
  await look(() => push("origin/main")); // the main worktree pushes main
  assert.deepEqual(got, []);
  await look(() => push("origin/issue/36-x"));
  assert.deepEqual(got, [["push", "update by push", sha("a"), "/repo"]]);
});

test("with HEAD detached, no push counts", async () => {
  push("origin/main");
  const got = await watcher();
  await look(() => {
    move("a", `checkout: moving from main to ${sha("a")}`);
    repo.branch = null;
    push("origin/main");
  });
  assert.deepEqual(got.filter(([kind]) => kind === "push"), []);
});

test("a deleted branch's reflog going is no push and no failure; pushed again, it counts again", async () => {
  repo.branch = "old";
  push("origin/main");
  push("origin/old");
  const got = await watcher();
  await look(() => delete repo.remotes["origin/old"]); // `git push --delete`, `git fetch --prune`
  assert.deepEqual(got, []);
  await look(() => push("origin/old"));
  assert.deepEqual(got, [["push", "update by push", sha("a"), "/repo"]]);
});

test("pushes count from the first good read: a count that fails is no baseline", async () => {
  push("origin/main");
  repo.findFails = 1;
  const got = await watcher();
  await look();
  assert.deepEqual(got, [], "the old pushes, read for the first time");
  await look(() => push("origin/main"));
  assert.equal(got.length, 1);
});

test("no remote-tracking reflog yet is nothing pushed, and the first push counts", async () => {
  const got = await watcher();
  await look();
  assert.deepEqual(got, []);
  await look(() => push("origin/main"));
  assert.deepEqual(got, [["push", "update by push", sha("a"), "/repo"]]);
});

test("a linked worktree's shared refs are watched too, and a push seen there launches", async () => {
  repo.gitDir = "/main/.git/worktrees/repo";
  repo.common = "/main/.git";
  repo.branch = "wt";
  push("origin/main");
  const got = await watcher();
  assert.deepEqual(mock.of("watchFolder"), [["/repo"], ["/main/.git/worktrees/repo"], ["/main/.git/refs"]]);
  await look(() => push("origin/wt"), "/main/.git/refs");
  assert.deepEqual(got, [["push", "update by push", sha("a"), "/repo"]]);
});

test("a repository whose git folder is elsewhere shares none: no third folder", async () => {
  repo.gitDir = "/store/repo.git"; // `git init --separate-git-dir`
  repo.common = "/store/repo.git";
  await watcher();
  assert.deepEqual(mock.of("watchFolder"), [["/repo"], ["/store/repo.git"]]);
});

test("a push launches a rocket off the working agent's creature: it lights, lifts off in a puff of smoke, and flies up out of sight", async () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "idle" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo" }];
  const { drawer, cx } = await start();
  let tree = draw(drawer, cx);
  assert.equal(rocketOf(tree, "t1"), null, "no push, no rocket");
  const before = cx.notified;
  await look(() => push("origin/main"));
  assert.ok(cx.notified > before, "the drawer draws again");
  assert.equal(drawer.moves.get("t1").move.kind, "push");
  tree = draw(drawer, cx);
  const shot = () => rocketOf(tree, "t1");
  const ship = () => shipOf(shot());
  const sprite = () => find(tree, "pp-spr-t1");
  assert.ok(shot() && walk(find(tree, "pp-box-t1")).includes(shot()), "in the sprite's box, so a closed drawer shows it");
  assert.equal(rocketOf(tree, "t2"), null, "the idle one in the same repository takes none");
  assert.notEqual(last(sprite(), "opacity"), 0, "the creature stays: the rocket launches off it");
  assert.equal(last(ship(), "opacity"), 0, "set unseen");
  const pad = last(ship(), "top");
  const [x, w, h] = [last(ship(), "left"), last(ship(), "w"), last(ship(), "h")];
  assert.equal(pad + h, 41, "standing on the stamp's floor");
  assert.ok(x >= 6 && x + w <= 42, "in front of the creature");
  assert.equal(last(flameOf(shot()), "opacity"), 0, "its engine off");
  assert.equal(cloudsOf(shot()).length, 0, "no smoke yet");

  cx.run(30);
  tree = draw(drawer, cx);
  assert.equal(last(ship(), "opacity"), 1, "it shows");
  assert.equal(last(ship(), "top"), pad, "on the pad");

  cx.run(450);
  tree = draw(drawer, cx);
  assert.equal(last(flameOf(shot()), "opacity"), 1, "the engine lights");
  assert.equal(last(flameOf(shot()), "loop"), "opacity", "and its flame flickers");
  assert.equal(last(bodyOf(shot()), "loop"), "left", "the rocket shakes");
  assert.equal(last(ship(), "top"), pad, "still on the pad");

  cx.run(850);
  tree = draw(drawer, cx);
  assert.equal(last(ship(), "top"), 0, "it climbs to the box's top, never over the row above");
  assert.equal(last(ship(), "opacity"), 0, "fading as it flies away");
  const climb = calls(ship(), "transition").filter(([p]) => p === "top").at(-1)[1];
  assert.equal(climb.easing, "ease-in", "faster as it goes");
  assert.equal(last(flameOf(shot()), "opacity"), 1, "on its flame");
  assert.equal(calls(bodyOf(shot()), "loop").length, 0, "no shake in flight");
  const clouds = () => cloudsOf(shot());
  assert.ok(clouds().length && clouds().every((c) => last(c, "opacity") === 1), "a puff of exhaust on the pad");
  /** @type {(c: any) => boolean} */
  const inside = (c) => last(c, "left") >= 0 && last(c, "top") >= 0 && last(c, "left") + last(c, "size") <= 48 && last(c, "top") + last(c, "size") <= 44;
  assert.ok(clouds().every(inside), "inside the box");

  cx.run(1100);
  tree = draw(drawer, cx);
  assert.ok(clouds().every((c) => last(c, "opacity") === 0), "the smoke clears");
  assert.ok(clouds().every(inside), "and spreads inside the box");

  cx.run(1700);
  tree = draw(drawer, cx);
  assert.equal(shot(), null, "and is gone");
  assert.equal(drawer.moves.size, 0, "forgotten too");
});

test("a commit and its push in one look stamp the creature and launch the rocket", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await look(() => {
    move("b", "commit: two");
    push("origin/main");
  });
  const tree = draw(drawer, cx);
  assert.ok(rocketOf(tree, "t1") && hasStamp(tree, "t1"));
});

test("a push after a checkout in the same look launches the rocket in its place", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await look(() => {
    move("b", "checkout: moving from main to x");
    push("origin/x", "b");
  });
  assert.equal(drawer.moves.get("t1").move.kind, "push", "the push is read after HEAD's moves");
});

test("with no agent working, a push lands on every agent in the repository", async () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "done" });
  mock.agent("t3", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }, { pane: "p-t2", cwd: "/repo/lib" }, { pane: "p-t3", cwd: "/tmp" }];
  const { drawer, cx } = await start();
  await look(() => push());
  const tree = draw(drawer, cx);
  assert.ok(rocketOf(tree, "t1") && rocketOf(tree, "t2") && !rocketOf(tree, "t3"));
});

test("a second push launches a new rocket; the first one's steps no longer touch it", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await look(() => push());
  const first = rocketOf(draw(drawer, cx), "t1").id;
  cx.run(500);
  // The first rocket's steps still to come, held back to run after the second is set.
  const pending = cx.timers.filter((t) => !t.every);
  cx.timers = cx.timers.filter((t) => t.every);
  await look(() => push());
  const second = rocketOf(draw(drawer, cx), "t1").id;
  assert.notEqual(second, first, "a new id: it starts on the pad again");
  for (const t of pending) t.handler(cx);
  const tree = draw(drawer, cx);
  assert.equal(rocketOf(tree, "t1")?.id, second, "the first one's end does not clear the second");
  assert.equal(last(shipOf(rocketOf(tree, "t1")), "opacity"), 0, "still set unseen, as the second's own steps have it");
  cx.run(5000);
  assert.equal(rocketOf(draw(drawer, cx), "t1"), null, "the second's own end clears it");
});

test("every edge renders a rocket beside a stamp with unique ids", async () => {
  mock.agent("t1", { status: "working" });
  mock.state.panes = [{ pane: "p-t1", cwd: "/repo" }];
  const { drawer, cx } = await start();
  await look(() => {
    move("b", "commit: x");
    push();
  });
  for (const step of [0, 30, 450, 850, 1100]) {
    cx.run(step);
    for (const edge of ["top", "right", "bottom", "left", null]) {
      mock.state.placement = edge && { edge, align: "center", vertical: edge === "left" || edge === "right", hovered: false, dragging: false };
      const tree = draw(drawer, cx);
      assert.ok(rocketOf(tree, "t1") && hasStamp(tree, "t1"), `${edge} at ${step} ms`);
    }
  }
});
