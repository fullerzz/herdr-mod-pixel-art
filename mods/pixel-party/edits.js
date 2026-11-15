// Lines added and removed in the agents' repositories, and the commits made in them: the
// hits and stamps the drawer shows.
// Contract: docs/DESIGN.md, "Contract: edits.js".
//
// Herdr reports no edits, so they come from git. Each repository an agent works in is
// watched with `watchFolder`. After each batch of changes, the repository's diff against
// HEAD (untracked files counted as added lines) is read again and compared with the last
// read. Growth in a file's added lines is a green hit, growth in its removed lines a red
// one. A commit, a stash or a revert shrinks the diff, and shows nothing.
//
// A commit is read from HEAD's reflog file on the same look, one line per move of HEAD. Each
// look reads only the lines added since the last look, from where that one got to, so no
// move is missed however many land between looks, and two moves alike are still two lines.
// A move is a commit made here when git's note of it is one `git commit` or `git merge`
// writes for a new commit ("commit: ...", "commit (amend): ...", "merge x: Merge made by
// ..."). A checkout, reset, rebase, pull or cherry-pick moves HEAD too, and is no commit. A
// linked worktree keeps its HEAD outside its folder, so its git folder is watched as well.

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

/** @type {(cwd: string, args: string[]) => ReturnType<typeof exec>} Git that never writes the index. */
const git = (cwd, args) => exec("git", ["--no-optional-locks", ...args], { cwd });

/**
 * One move of HEAD, a line of its reflog: `sha` is the commit HEAD moved to, `subject` git's
 * note of why.
 * @typedef {{ sha: string, subject: string }} HeadMove
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
    const m = /^[0-9a-f]+ ([0-9a-f]+) [^\t]*\t(.*)$/.exec(line);
    return m ? [{ sha: m[1], subject: m[2] }] : [];
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
 * The repository's git folder when it is outside the repository (a linked worktree), else null.
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function outerGitDir(root) {
  try {
    const r = await git(root, ["rev-parse", "--absolute-git-dir"]);
    const dir = r.code === 0 ? r.stdout.trim() : "";
    return dir && dir !== root && !dir.startsWith(`${root}/`) ? dir : null;
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

/** Watches the repositories of the folders it is given, and reports what grows in them and the commits made in them. */
export class EditWatcher {
  /**
   * @param {(root: string, lines: Lines, cx: AsyncContext) => void} onGrowth
   * @param {(root: string, commit: string, cx: AsyncContext) => void} [onCommit] Gets the new commit's sha.
   */
  constructor(onGrowth, onCommit = () => {}) {
    this.onGrowth = onGrowth;
    this.onCommit = onCommit;
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
      const outer = await outerGitDir(root);
      if (outer) folders.push(outer);
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
      // Commits count from the first good read of the reflog: what it holds already is no
      // stamp, unless the repository was made since the folder was first asked (its first
      // commit can come before the watch starts). Until a read succeeds, nothing counts.
      // A failed read keeps where the reading got to, so the next good read goes on from it.
      const readLog = async () => {
        log ??= await reflogOf(root);
        const moved = log ? await readMoves(log, read ?? START) : null;
        if (!moved || !live()) return;
        if (read || made) this.report(root, moved.moves, cx);
        read = moved.to;
      };
      let [last] = await Promise.all([readDiff(root), readLog()]);
      while (live()) {
        try {
          await Promise.race(folders.map(wait));
        } catch (e) {
          // Too big to watch (Linux): no hits from this repository.
          console.log(`pixel-party: not watching ${root}: ${e instanceof Error ? e.message : e}`);
          return;
        }
        await cx.sleep(SETTLE);
        const [next] = await Promise.all([readDiff(root), readLog()]);
        if (!live() || !next) continue;
        const lines = last ? growth(last, next) : null;
        last = next;
        if (lines && (lines.added || lines.removed)) this.onGrowth(root, lines, cx);
      }
    });
    this.watched.set(root, task);
  }

  /**
   * Reports the newest commit among these moves, if any: one stamp per look.
   * @param {string} root
   * @param {HeadMove[]} moves Oldest first.
   * @param {AsyncContext} cx
   */
  report(root, moves, cx) {
    const commit = moves.filter((m) => isCommit(m.subject)).at(-1);
    if (commit) this.onCommit(root, commit.sha, cx);
  }
}
