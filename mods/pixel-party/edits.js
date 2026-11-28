// Lines added and removed in the agents' repositories, the commits made in them, HEAD's
// other moves there, and their pushes: the hits and stamps the drawer shows, and the moves it
// lands.
// Contract: docs/DESIGN.md, "Contract: edits.js".
//
// Herdr reports no edits, so they come from git. Each repository an agent works in is
// watched with `watchFolder`. After each batch of changes, the repository's diff against
// HEAD (untracked files counted as added lines) is read again and compared with the last
// read. Growth in a file's added lines is a green hit, growth in its removed lines a red
// one. A commit, a stash or a revert shrinks the diff, and shows nothing. `hitSize` says
// how hard a change hits by its lines added and removed together: a tick, a hit or a crit.
// The whole diff's lines, added and removed together, are the repository's uncommitted
// lines: reported on the first read and each time they change, shrinking included.
//
// A commit is read from HEAD's reflog file on the same look, one line per move of HEAD. Each
// look reads only the lines added since the last look, from where that one got to, so no
// move is missed however many land between looks, and two moves alike are still two lines.
// A move is a commit made here when git's note of it is one `git commit` or `git merge`
// writes for a new commit ("commit: ...", "commit (amend): ...", "merge x: Merge made by
// ..."). A checkout, reset, rebase, pull or cherry-pick moves HEAD too, and is no commit: it
// is reported as a move of its kind, read from the same note. A reset that leaves HEAD where
// it was (`git stash`, `git reset --hard`) is none. A linked worktree keeps its HEAD outside
// its folder, so its git folder is watched as well.
//
// A push moves no HEAD: it moves a remote-tracking ref, and git notes it in that ref's own
// reflog (`logs/refs/remotes/<remote>/<branch>`) as "update by push". Each look counts the
// lines of every such reflog in one call, and reads the new lines of those that grew, the
// same way as HEAD's. The refs are shared by every worktree of a repository, so a push counts
// here only when it moved the remote-tracking ref of the branch checked out here
// (`<remote>/<branch>`), to the commit HEAD is at; and a linked worktree's shared git folder
// is watched for them as well.

import { exec, readTextFile, watchFolder } from "herdr";

/** @import { AsyncContext, Task } from "gpui-kit" */

/** @typedef {{ added: number, removed: number }} Lines */
/** @typedef {Map<string, Lines>} Diff Lines per file, by its path in the repository. */

const UNTRACKED_MAX = 50; // new files read per look, so an unignored build folder stays cheap
const SETTLE = 250; // ms for a burst of writes to land before the diff is read
const RECHECK = 10_000; // ms between asks whether a folder in no repository is in one now

/**
 * `git diff --numstat` output as a Diff. Binary files ("-\t-\tpath") are left out.
 * @param {string} stdout
 * @returns {Diff}
 */
export function parseNumstat(stdout) {
  /** @type {Diff} */
  const diff = new Map();
  for (const line of stdout.split("\n")) {
    const m = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (m) diff.set(m[3], { added: Number(m[1]), removed: Number(m[2]) });
  }
  return diff;
}

/**
 * Lines in a Diff, added and removed together.
 * @type {(diff: Diff) => number}
 */
export const changed = (diff) => [...diff.values()].reduce((n, { added, removed }) => n + added + removed, 0);

/** @type {(text: string) => number} Lines in a file's text, a last line without "\n" included. */
export const countLines = (text) => (text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0);

/**
 * What grew from one diff to the next: per file, only growth counts, so lines that leave
 * the diff (a commit, a revert) never read as a hit.
 * @param {Diff} before
 * @param {Diff} after
 * @returns {Lines}
 */
export function growth(before, after) {
  let added = 0;
  let removed = 0;
  for (const [path, now] of after) {
    const was = before.get(path);
    added += Math.max(0, now.added - (was?.added ?? 0));
    removed += Math.max(0, now.removed - (was?.removed ?? 0));
  }
  return { added, removed };
}

/** @typedef {"tick" | "hit" | "crit"} HitSize How hard a change of some lines hits. */

/** Lines changed from which a change is a plain hit, and from which it is a crit. Fewer is a tick. */
export const HIT_LINES = 5;
export const CRIT_LINES = 200;

/**
 * How big a change of `lines` lines is: a tick for a line or a few, a crit for a big change.
 * @type {(lines: number) => HitSize}
 */
export const hitSize = (lines) => (lines >= CRIT_LINES ? "crit" : lines >= HIT_LINES ? "hit" : "tick");

/** Uncommitted lines that make a level: they fill the XP bar, and a commit of a full bar levels up. */
export const LEVEL_LINES = 100;

/** @type {(cwd: string, args: string[]) => ReturnType<typeof exec>} Git that never writes the index. */
const git = (cwd, args) => exec("git", ["--no-optional-locks", ...args], { cwd });

/**
 * One move of HEAD, a line of its reflog: `from` is the commit HEAD was at, `sha` the commit
 * it moved to, `subject` git's note of why.
 * @typedef {{ from: string, sha: string, subject: string }} HeadMove
 */
/**
 * How far HEAD's reflog has been read: the lines read, and the text of the last of them.
 * @typedef {{ lines: number, last: string }} Cursor
 */

/** @type {Cursor} Nothing read yet. An absent reflog (no commits yet) is read up to here. */
export const START = Object.freeze({ lines: 0, last: "" });

/**
 * Reflog lines as moves, in the file's order (oldest first). Each line is
 * `<old sha> <new sha> <name> <email> <time> <zone>\t<subject>`.
 * @param {string[]} lines
 * @returns {HeadMove[]}
 */
export function parseReflog(lines) {
  return lines.flatMap((line) => {
    const m = /^([0-9a-f]+) ([0-9a-f]+) [^\t]*\t(.*)$/.exec(line);
    return m ? [{ from: m[1], sha: m[2], subject: m[3] }] : [];
  });
}

/**
 * Whether git wrote this reflog note for a new commit made here: by `git commit` (a first
 * commit, an amend, or one that concludes a merge too), or by a `git merge` that made a merge
 * commit. Not a fast-forward, a pull, a cherry-pick (`commit (cherry-pick): ...` after a
 * conflict) or a rebase.
 * @param {string} subject
 * @returns {boolean}
 */
export const isCommit = (subject) =>
  /^commit(?: \((?:initial|amend|merge)\))?:/.test(subject) || /^merge [^:]*: Merge made by /.test(subject);

/** @typedef {"checkout" | "reset" | "rebase" | "pull" | "cherry-pick" | "merge" | "revert" | "push"} MoveKind */
/**
 * A move of HEAD that is no commit, or a push: its kind, the commit HEAD moved to (a push's:
 * the commit it pushed), and git's note.
 * @typedef {{ kind: MoveKind, sha: string, subject: string }} Move
 */

/**
 * The kind of a move that is no commit, from the git command its reflog note names; null for
 * a commit and for a note of any other kind. `git switch` writes a checkout's note, `git stash`
 * a reset's, `git checkout -B` of the branch checked out a reset's of its own
 * (`branch: Reset to ...`) before its checkout's (from another branch, only a checkout's), a fast-forward `git merge` a merge's, and a cherry-pick concluded after a conflict
 * `commit (cherry-pick): ...`. A pull's note carries its options (`pull --rebase (pick): ...`).
 * A checkout of the branch already checked out (`moving from main to main`) goes nowhere, and
 * is none.
 * @param {string} subject
 * @returns {MoveKind | null}
 */
export function moveKind(subject) {
  if (isCommit(subject) || /^checkout: moving from (.+) to \1$/.test(subject)) return null;
  if (subject.startsWith("commit (cherry-pick):")) return "cherry-pick";
  if (subject.startsWith("branch: Reset to ")) return "reset";
  const m = /^(checkout|reset|rebase|pull|cherry-pick|merge|revert)(?=[ :])/.exec(subject);
  return m ? /** @type {MoveKind} */ (m[1]) : null;
}

/**
 * Whether git wrote this note in a remote-tracking ref's reflog for a push. A fetch's or a
 * pull's (`fetch: fast-forward`, `pull --rebase: fast-forward`) is not.
 * @type {(subject: string) => boolean}
 */
export const isPush = (subject) => subject === "update by push";

/**
 * The path of HEAD's reflog file, or null when git can't tell. A linked worktree has its own.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function reflogOf(root) {
  try {
    // Not `--path-format=absolute`: git before 2.31 echoes it back as a line of its own. The
    // path comes relative to `root` unless the git folder is elsewhere (a linked worktree).
    const r = await git(root, ["rev-parse", "--git-path", "logs/HEAD"]);
    const path = r.code === 0 ? r.stdout.trim() : "";
    return path ? (path.startsWith("/") ? path : `${root}/${path}`) : null;
  } catch {
    return null;
  }
}

/**
 * A file's lines from line `n` on (1 and below: all of them), a last line without "\n" left
 * out; [] when there is no such file, null when it can't be read.
 * @param {string} file
 * @param {number} n
 * @returns {Promise<string[] | null>}
 */
async function linesFrom(file, n) {
  const r = await exec("tail", ["-n", `+${Math.max(n, 1)}`, file]);
  if (r.code !== 0) return (await exec("test", ["-e", file])).code === 1 ? [] : null;
  const lines = r.stdout.split("\n");
  lines.pop();
  return lines;
}

/**
 * The moves of HEAD after `from`, oldest first, and how far the reflog is read now; null when
 * it can't be read. The read starts at the last line read before. When that line has moved,
 * as when `git reflog expire` (run by `git gc`) drops the oldest lines, the moves after it
 * are read wherever it is now. When it is gone (the reflog rewritten or deleted), the read
 * goes on from the reflog's end, with no moves. A last line git has not finished writing is
 * left for the next read.
 * @param {string} log The reflog file.
 * @param {Cursor} from
 * @returns {Promise<{ moves: HeadMove[], to: Cursor } | null>}
 */
export async function readMoves(log, from) {
  try {
    let lines = await linesFrom(log, from.lines);
    if (!lines) return null;
    let skipped = Math.max(from.lines - 1, 0); // the file's lines before lines[0]
    let at = from.lines ? 0 : -1; // where the last line read is in `lines`
    if (from.lines && lines[0] !== from.last) {
      lines = await linesFrom(log, 1);
      if (!lines) return null;
      skipped = 0;
      at = lines.lastIndexOf(from.last);
      if (at < 0) at = lines.length - 1;
    }
    const total = skipped + lines.length;
    const to = total ? { lines: total, last: /** @type {string} */ (lines.at(-1)) } : START;
    return { moves: parseReflog(lines.slice(at + 1)), to };
  } catch {
    return null;
  }
}

/**
 * The number of whole lines in each file in a folder and its subfolders, by path; an empty map
 * when there is no such folder, null when it can't be read. One call however many files.
 * @param {string} dir An absolute path.
 * @returns {Promise<Map<string, number> | null>}
 */
async function lineCounts(dir) {
  const r = await exec("find", [dir, "-type", "f", "-exec", "wc", "-l", "{}", "+"]);
  if (r.code !== 0) return (await exec("test", ["-e", dir])).code === 1 ? new Map() : null;
  /** @type {Map<string, number>} */
  const counts = new Map();
  // `wc` adds a line of its own, " <sum> total", for more than one file: no path, as no "/".
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+) (\/.*)$/.exec(line);
    if (m) counts.set(m[2], Number(m[1]));
  }
  return counts;
}

/**
 * The pushes noted in the reflogs under `dir` (the remote-tracking refs') after `from`, and how
 * far each is read now; null when the folder can't be read. Each file is read as HEAD's
 * reflog is (`readMoves`), from where its cursor got to, and only when its count of lines
 * changed. A file not in `from` is read from its start: a branch pushed for the first time
 * makes its file. A file gone (a branch deleted, `git fetch --prune`) is forgotten, and one
 * that fails to read keeps its cursor for the next read. Each push names the ref it moved,
 * its file's path under `dir` (`origin/issue/36-x`).
 * @param {string} dir
 * @param {Map<string, Cursor>} from By file.
 * @returns {Promise<{ pushes: (HeadMove & { ref: string })[], to: Map<string, Cursor> } | null>}
 */
export async function readPushes(dir, from) {
  try {
    const counts = await lineCounts(dir);
    if (!counts) return null;
    const files = [...counts].map(async ([file, lines]) => {
      const was = from.get(file) ?? START;
      const read = was.lines === lines ? null : await readMoves(file, was);
      const ref = file.slice(dir.length + 1);
      return { file, to: read?.to ?? was, pushes: read?.moves.filter((m) => isPush(m.subject)).map((m) => ({ ...m, ref })) ?? [] };
    });
    const read = await Promise.all(files);
    return { pushes: read.flatMap((r) => r.pushes), to: new Map(read.map((r) => [r.file, r.to])) };
  } catch {
    return null;
  }
}

/**
 * The commit HEAD is at, or null when git can't tell.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function headOf(root) {
  try {
    const r = await git(root, ["rev-parse", "HEAD"]);
    return r.code === 0 ? r.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * The branch checked out, as its name under `refs/heads/` (`issue/36-x`), or null when HEAD
 * is detached or git can't tell.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function branchOf(root) {
  try {
    const r = await git(root, ["symbolic-ref", "-q", "HEAD"]);
    const ref = r.code === 0 ? r.stdout.trim() : "";
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) || null : null;
  } catch {
    return null;
  }
}

/**
 * Whether a remote-tracking ref, as its name under `refs/remotes/` (`origin/issue/36-x`), is
 * the branch's on some remote: its first part is the remote's name, the rest the branch's.
 * @type {(ref: string, branch: string) => boolean}
 */
export const tracks = (ref, branch) => ref.indexOf("/") > 0 && ref.slice(ref.indexOf("/") + 1) === branch;

/**
 * The repository's shared git folder, where its refs and their reflogs are: the same for
 * every worktree of it. Null when git can't tell.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function commonDirOf(root) {
  try {
    // Relative to `root` when it is inside it (".git"), else absolute.
    const r = await git(root, ["rev-parse", "--git-common-dir"]);
    const dir = r.code === 0 ? r.stdout.trim() : "";
    return dir ? (dir.startsWith("/") ? dir : `${root}/${dir}`) : null;
  } catch {
    return null;
  }
}

/** @type {(path: string, dir: string) => boolean} Whether a path is the folder or inside it. */
const within = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/**
 * The repository's git folder when it is outside the repository (a linked worktree), else null.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function outerGitDir(root) {
  try {
    const r = await git(root, ["rev-parse", "--absolute-git-dir"]);
    const dir = r.code === 0 ? r.stdout.trim() : "";
    return dir && !within(dir, root) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * The repository a folder is in, or null when it is in none.
 * @param {string} dir
 * @returns {Promise<string | null>}
 */
async function repoRoot(dir) {
  try {
    const r = await git(dir, ["rev-parse", "--show-toplevel"]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The repository's changes against HEAD, untracked files included, or null when git can't
 * tell. A repository without commits is compared with nothing.
 * @param {string} root
 * @returns {Promise<Diff | null>}
 */
export async function readDiff(root) {
  try {
    let r = await git(root, ["diff", "HEAD", "--numstat"]);
    if (r.code !== 0) r = await git(root, ["diff", "--cached", "--numstat"]);
    if (r.code !== 0) return null;
    const diff = parseNumstat(r.stdout);
    const u = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const fresh = u.code === 0 ? u.stdout.split("\0").filter(Boolean).slice(0, UNTRACKED_MAX) : [];
    const texts = await Promise.all(fresh.map((path) => readTextFile(`${root}/${path}`).catch(() => /** @type {string | null} */ (null))));
    fresh.forEach((path, i) => diff.set(path, { added: countLines(texts[i] ?? ""), removed: 0 }));
    return diff;
  } catch {
    return null;
  }
}

/** Watches the repositories of the folders it is given, and reports what grows in them, their uncommitted lines, the commits made in them, HEAD's other moves, and their pushes. */
export class EditWatcher {
  /**
   * @param {(root: string, lines: Lines, cx: AsyncContext) => void} onGrowth
   * @param {(root: string, commit: string, cx: AsyncContext) => void} [onCommit] Gets the new commit's sha.
   * @param {(root: string, move: Move, cx: AsyncContext) => void} [onMove] Gets a move of HEAD that is no commit, and a push (kind "push").
   * @param {(root: string, lines: number, cx: AsyncContext) => void} [onDiff] Gets the repository's uncommitted lines when they change.
   */
  constructor(onGrowth, onCommit = () => {}, onMove = () => {}, onDiff = () => {}) {
    this.onGrowth = onGrowth;
    this.onCommit = onCommit;
    this.onMove = onMove;
    this.onDiff = onDiff;
    /** @type {Map<string, number>} Each watched repository's uncommitted lines, once read. */
    this.totals = new Map();
    /** @type {Map<string, string | null>} Folder to repository root; null: none, or still asking. */
    this.roots = new Map();
    /** @type {Map<string, number>} When each folder was last asked for its repository. */
    this.asked = new Map();
    /** @type {Set<string>} Roots found where there was no repository before: new ones. */
    this.made = new Set();
    /** @type {Map<string, Task>} Watched repository roots. */
    this.watched = new Map();
    /** @type {Set<string>} The folders last given. */
    this.dirs = new Set();
  }

  /**
   * The repository root of a folder, once known.
   * @param {string} dir
   * @returns {string | null}
   */
  rootOf(dir) {
    return this.roots.get(dir) ?? null;
  }

  /**
   * A watched repository's uncommitted lines (`changed` of its diff against HEAD), as of the
   * last read; null before its first read and once it is no longer watched. A commit is
   * reported before the read that follows it is kept, so `onCommit` still sees the lines
   * the commit took.
   * @param {string} root
   * @returns {number | null}
   */
  uncommitted(root) {
    return this.totals.get(root) ?? null;
  }

  /**
   * Watches the repositories these folders are in, and stops watching any other. Cheap to
   * call again with the same folders.
   * @param {Iterable<string>} dirs
   * @param {AsyncContext} cx
   */
  follow(dirs, cx) {
    this.dirs = new Set(dirs);
    for (const dir of this.roots.keys()) {
      if (this.dirs.has(dir)) continue;
      this.roots.delete(dir);
      this.asked.delete(dir);
    }
    // A folder in no repository is asked again now and then: `git init` can make one there.
    const now = Date.now();
    for (const dir of this.dirs) {
      if (this.roots.get(dir) || now - (this.asked.get(dir) ?? -Infinity) < RECHECK) continue;
      const before = this.roots.has(dir);
      this.roots.set(dir, null);
      this.asked.set(dir, now);
      cx.spawn(async (cx) => {
        const root = await repoRoot(dir);
        if (!this.dirs.has(dir)) return;
        this.roots.set(dir, root);
        if (!root) return;
        // A root already watched is no new repository, and its watch would never take the entry.
        if (before && !this.watched.has(root)) this.made.add(root);
        this.follow(this.dirs, cx);
      });
    }
    const wanted = new Set([...this.dirs].map((dir) => this.rootOf(dir)).filter(Boolean));
    for (const [root, task] of this.watched) {
      if (wanted.has(root)) continue;
      this.watched.delete(root);
      this.totals.delete(root);
      task.cancel();
    }
    for (const root of wanted) if (!this.watched.has(root)) this.watch(root, cx);
  }

  /**
   * @param {string} root
   * @param {AsyncContext} cx
   */
  watch(root, cx) {
    const task = cx.spawn(async (cx) => {
      const live = () => this.watched.get(root) === task;
      const folders = [root];
      const [outer, shared] = await Promise.all([outerGitDir(root), commonDirOf(root)]);
      if (outer) folders.push(outer);
      // A linked worktree's refs are in the shared git folder, outside both: its pushes wake that.
      if (shared && !within(shared, root) && !(outer && within(shared, outer))) folders.push(`${shared}/refs`);
      /** @type {string | null} The shared git folder; asked for again on each look until git tells it. */
      let common = shared;
      /** @type {Map<string, Promise<unknown>>} One wait per folder, kept until it ends. */
      const waits = new Map();
      /** @type {(dir: string) => Promise<unknown>} */
      const wait = (dir) => {
        if (!waits.has(dir)) waits.set(dir, watchFolder(dir).finally(() => waits.delete(dir)));
        return /** @type {Promise<unknown>} */ (waits.get(dir));
      };
      const made = this.made.delete(root);
      /** @type {string | null} HEAD's reflog file; asked for again on each look until git tells it. */
      let log = null;
      /** @type {Cursor | null} How far the reflog is read; null: not yet. */
      let read = null;
      // Commits and moves count from the first good read of the reflog: what it holds already
      // is no stamp or move, unless the repository was made since the folder was first asked (its first
      // commit can come before the watch starts). Until a read succeeds, nothing counts.
      // A failed read keeps where the reading got to, so the next good read goes on from it.
      const readLog = async () => {
        log ??= await reflogOf(root);
        const moved = log ? await readMoves(log, read ?? START) : null;
        if (!moved || !live()) return;
        if (read || made) this.report(root, moved.moves, cx);
        read = moved.to;
      };
      /** @type {Map<string, Cursor> | null} How far each remote-tracking ref's reflog is read; null: not yet. */
      let pushed = null;
      // Pushes count from the first good read, as commits do: the reflogs a push wrote before
      // it are no push. Every worktree of the repository writes the same shared reflogs, so a
      // push counts only when it moved the branch checked out here, to the commit HEAD is at:
      // another worktree has another branch checked out, even at the same commit. A detached
      // HEAD has no branch, and no push counts.
      const readPushLog = async () => {
        common ??= await commonDirOf(root);
        const got = common ? await readPushes(`${common}/logs/refs/remotes`, pushed ?? new Map()) : null;
        if (!got || !live()) return;
        const counts = Boolean(pushed || made);
        pushed = got.to;
        if (!counts || !got.pushes.length) return;
        const [head, branch] = await Promise.all([headOf(root), branchOf(root)]);
        const push = branch ? got.pushes.filter((m) => m.sha === head && tracks(m.ref, branch)).at(-1) : undefined;
        if (push && live()) this.onMove(root, { kind: "push", sha: push.sha, subject: push.subject }, cx);
      };
      /** Reads HEAD's reflog, then the pushes, so a push in the same look as a move of HEAD is reported after it. */
      const readLogs = async () => {
        await readLog();
        await readPushLog();
      };
      /** @type {(diff: Diff | null) => void} Keeps the diff's lines, and reports them when they changed. */
      const keep = (diff) => {
        if (!diff || !live()) return;
        const lines = changed(diff);
        if (this.totals.get(root) === lines) return;
        this.totals.set(root, lines);
        this.onDiff(root, lines, cx);
      };
      let [last] = await Promise.all([readDiff(root), readLogs()]);
      keep(last);
      while (live()) {
        try {
          await Promise.race(folders.map(wait));
        } catch (e) {
          // Too big to watch (Linux): no hits from this repository.
          console.log(`pixel-party: not watching ${root}: ${e instanceof Error ? e.message : e}`);
          return;
        }
        await cx.sleep(SETTLE);
        const [next] = await Promise.all([readDiff(root), readLogs()]);
        if (!live() || !next) continue;
        const lines = last ? growth(last, next) : null;
        last = next;
        keep(next);
        if (lines && (lines.added || lines.removed)) this.onGrowth(root, lines, cx);
      }
    });
    this.watched.set(root, task);
  }

  /**
   * Reports one thing per look: the newest commit among these moves, else the newest move of
   * a known kind. A rebase writes many lines, often in one look, and is still one move; a
   * commit outweighs the checkouts and resets around it. A reset that leaves HEAD where it was
   * (`git stash`, `git reset --hard`) is no move, so it never hides an older one. A push is
   * read apart, after this, and reported as well.
   * @param {string} root
   * @param {HeadMove[]} moves Oldest first.
   * @param {AsyncContext} cx
   */
  report(root, moves, cx) {
    const commit = moves.filter((m) => isCommit(m.subject)).at(-1);
    if (commit) return this.onCommit(root, commit.sha, cx);
    /** @type {Move | undefined} */
    const move = moves.flatMap(({ from, sha, subject }) => {
      const kind = moveKind(subject);
      return kind && !(kind === "reset" && from === sha) ? [{ kind, sha, subject }] : [];
    }).at(-1);
    if (move) this.onMove(root, move, cx);
  }
}
