# Pixel Party: design

A Herdr mod. Every agent gets a small generated pixel creature. The creatures stand in a
floating drawer at the window's edge and move according to what their agent is doing. A
picker lets the person choose another creature for an agent.

## What the person gets

- **Drawer.** One row per agent. Docked on a side edge it is a drawer: a strip of sprites
  shows, and hovering slides out each agent's name and what it is doing. Clicking a row
  goes to that agent. Right-clicking a row opens the picker.
- **Sprites.** Each sprite is generated from a seed, so the same seed always draws the same
  creature. A sprite moves natively: it works while its agent works, catches fire and asks
  for attention when the agent is blocked, celebrates when it finished, and rests when it
  is idle.
- **Ways of working.** A working sprite shows what its agent is doing, when the agent's
  hooks say: it types while the agent edits files, reads a book while it reads, hammers
  while it runs commands, sweeps a lens while it searches, holds up an antenna while it
  fetches from the web, and thinks when a prompt comes in. Otherwise it works its own way,
  one of those six or a walk, picked by its seed.
- **Identity.** An agent's seed is the `pixel.avatar` label on its terminal in herdr-core.
  Without the label the seed is the terminal's address, so every agent has a stable sprite
  from the start. A label survives an agent restart in the same terminal, is seen by every
  Herdr client, and can be set from a shell: `hc label t7 pixel.avatar=knight7`.
- **Picker.** A grid of candidate sprites for one agent. Choosing one saves the label.
  Shuffle draws new candidates. Reset removes the label.
- **Hits.** Lines an agent adds or removes in its repository land on its sprite like hits in
  a fighting game: green `+12` and red `−3` pop over it, hold for a beat, then curve away
  and fade: added lines up and to the left, removed lines up and to the right.
  The sprite flashes the hit's color and is knocked: lifted by added lines, pushed sideways
  by removed ones.
- **Stamps.** A commit made in an agent's repository is a stamp of approval: a rubber stamp
  slams down on its sprite, the cell dips under the blow, and the stamp lifts away to leave a
  check that holds a moment, then fades. The check is in the "done" color and says
  "approved" by its shape: red is the "Needs you" cue, so the stamp never relies on it.
- **Bees.** Each helper an agent has running is a small figure beside its sprite: a sheep
  for a terminal it started with `hc run`, a honey bee for a sub-agent inside its own
  program. Both are called bees below. A new bee flies out of the sprite from a puff of
  smoke; it leaves when its helper ends.
- **Arrivals.** A new agent arrives by a magic trick: a wand taps its empty cell, a puff of
  smoke and sparkles goes up, and its sprite is there when the smoke clears.
- **Keys.** Three commands act on the current agent, for `keys.json` and
  `herdr-app do`: `pixel-party.pick`, `pixel-party.reroll`, `pixel-party.reset`.

## Facts the design rests on

Each was observed in Herdr 0.1.15 with the walking skeleton, not assumed.

| Fact | Consequence |
|---|---|
| Elements accept only `#rgb`, `#rrggbb`, `#rrggbbaa` colors. `hsl(...)` fails the whole view with an error card. | Every generated color is a hex literal. |
| `herdr-app check` renders with no agents, so it never runs sprite code. | The node tests render every status; the check alone proves little. |
| Absolutely positioned `div`s draw crisp pixels at any zoom. | Sprites are divs. No image files, no file writes, no build step. |
| `.loop("top" \| "opacity", ...)` animates a child `div`, including an absolutely positioned layer, without an id or a timer. | Motion is per part and costs no script time. |
| A label change re-renders mods at once: `terminals()` is live. | No polling and no shared-state signal after a choice. |
| `hc(["label", address, "k=v"])` works from a mod. `k=` removes the label. | The picker writes through `identity.js` only. |
| `openOverlay({ mod: "pixel-party", props })` opens this mod on itself. | One mod folder holds both the drawer and the picker. |
| `herdr-app do pixel-party.<command>` reaches `nextCommand()`. | Every write path can be driven without a pointer. |
| `focused().agent` names an agent even when the keyboard is in a shell pane, or in another agent's pane. | Commands prefer the pane with the keyboard. |
| A mod linked into the app's home reloads when the link is made again, not on every save. | `just install` is the reload. |
| `herdr-app check` hangs inside a command sandbox. | Workers run the node tests; the coordinator runs the check. |
| Herdr reports no file edits. `panes()` gives each pane's live `cwd`; `watchFolder` and `exec("git", ...)` work from a mod. | Hits come from the agent's repository diff, read again after each watched change. |
| `terminals()` gives each terminal's `parent`: the terminal that started it with `hc run`. A helper without a pane is not in `agents()`. | `hc` helpers are bees with no setup. |
| Herdr sees nothing of a sub-agent inside an agent's program (Claude Code's Agent tool). Its hooks run with `HC_TERMINAL_ID` set, and `hc label` takes a key such as `pixel.bee.a1B2-c_3`. | A hook keeps one label per running sub-agent; the label change re-renders the drawer. |
| A Claude Code `PreToolUse` hook's JSON names the tool (`tool_name`: `Read`, `Grep`, `Agent`, ...). A sub-agent's own tool calls carry `agent_id` and `agent_type`; the main agent's carry neither. `UserPromptSubmit` fires for each prompt, a background sub-agent's report included. (Claude Code 2, measured with `claude -p`.) | The hook says what the agent is doing from `tool_name`, and leaves a sub-agent's tools to its bee. |
| `hc label` on the caller's own terminal takes about 10 ms; the whole tool hook about 30 ms. A `PreToolUse` JSON holds the tool's whole input (a Write's content: megabytes), after `tool_name` and `agent_id`. | Before a tool or a prompt, the hook parses only up to `"tool_input"`, at most 8 KiB, and reads the rest to throw it away unparsed. A 2 MB Write costs it about 20 ms, not the 530 ms of parsing it all. |
| `.loop` plays its return leg as the forward leg backwards, easing included: an 8 s ease-in `top` loop is symmetric about its far end, slow to leave home and slow to come back. `.loop("width")` runs too. | Two loops of one period with ease-out and ease-in light in one order and go out in the reverse, as the previews in Chrome (CSS `alternate`) showed. |
| A Claude Code hook's parent process is `claude` itself (measured for SessionStart, SubagentStart and SubagentStop). A `claude -p` run from an agent's tool inherits `HC_TERMINAL_ID` and starts a session of its own. | `clear` tells the owner's own new session from a nested program's session by pid. |
| Herdr clips a floating mod to its frame: a child placed outside it is not drawn. | Bees get room inside the drawer, in lanes under the sprite. |
| A `Context` in `render` has the same `timer` as an `AsyncContext`. | A new bee's second render is scheduled from `render`. |
| `.transition(property, ...)` animates a change of that property between two renders of the same id. | A hit renders twice: at full strength, then settled. A new hit gets new ids so it starts over. |
| A commit writes only under `.git`, and `watchFolder` on a repository wakes for it (macOS). A linked worktree's git folder is outside its folder. | Each look also reads HEAD's reflog; a linked worktree's git folder is watched as well. |
| One look can follow several git commands: a commit and a reset can land in one batch, in the same second, and two reflog entries can read alike. | Each look reads every reflog line added since the last look, from where that one got to, by position in the file, not by time or commit. |
| `readTextFile` reads at most 1 MiB, and a busy repository's reflog grows past it. | The reflog is read with `tail -n +<line>`: only the new lines, from the last one read. |
| A folder an agent is in can become a repository later (`git init`). | A folder in no repository is asked again every 10 s. |

## Modules

All in `mods/pixel-party/`. Arrows are imports.

```
main.js ──> drawer.js ──┬─> identity.js ──> herdr
        │               ├─> edits.js ──> herdr
        │               ├─> bees.js ──> herdr
        └─> picker.js ──┤
                        ├─> sprite-view.js ──> sprites.js
                        └─> sprites.js
```

| File | Owner | Role |
|---|---|---|
| `main.js` | coordinator | Picks the view from `props().view`; feeds key commands to a view that defines `command`. |
| `identity.js` | coordinator | The label: `seedFor`, `hasAvatar`, `setAvatar`, `clearAvatar`, `openPicker`. |
| `sprites.js` | sprites | Seed to sprite. Pure: no imports, runs under plain node. |
| `sprite-view.js` | sprites | Sprite to element, with motion per status and way of working, and a hit's flash and knock. |
| `edits.js` | drawer | Lines added and removed in the agents' repositories, and HEAD's moves there, from git. |
| `bees.js` | drawer | An agent's helpers, and the bee drawn for each. |
| `drawer.js` | drawer | The party drawer. |
| `picker.js` | picker | The picker popup. |

### Contract: `sprites.js`

```js
export const GRID = 12;                 // cells per side of every sprite
export function hashSeed(seed: string): number;      // uint32, stable across runs
export function makeSprite(seed: string): Sprite;    // deterministic, never throws
export function randomSeed(rand?: () => number): string;  // 6 chars of [a-z0-9]
```

`Sprite` is opaque to the drawer and the picker: they pass it to `spriteElement` and read
nothing from it. Its shape is the sprites module's own business, with these guarantees:

- The same seed gives a deeply equal sprite. Any string is a seed, including an address
  such as `vps/t3` and the empty string.
- Art stays inside the 12 by 12 grid and leaves the outer ring of cells empty, so motion of
  up to one cell never leaves the sprite's box.
- Every color is a `#rrggbb` literal.
- A sprite is a creature, not noise: left-right symmetric, one connected body, an outline,
  at least two body tones, and eyes. Seeds differ in silhouette, palette and features.
- A sprite draws with at most 96 rectangles. Runs of equal cells are merged.

### Contract: `sprite-view.js`

```js
export function spriteElement(sprite, { id, px = 3, status = null, work = null, hit = null, stage = 0 }): Element;
export const HIT: { added: "#3ddc6a", removed: "#ff4d5e" };
export const FIRE: { red: "#e5381f", orange: "#ff8c1a", yellow: "#ffd447" };
export const WORKS: readonly string[];          // walk typing reading hammering searching thinking signal
export function ownWork(sprite): string;        // one of WORKS, the same for the same seed
export const STAGES: Record<Status, number[]>;  // ms a status holds to reach each stage; all empty for now
```

- Returns one element exactly `GRID * px` square that does not shrink in a flex row.
- `id` is required and unique per call site. Any id used inside starts with `id + "-"`.
- `status` is `"working" | "blocked" | "done" | "idle" | null`. `null` is a still pose.
- Each status is recognisable in a single frame as well as in motion, since a screenshot
  is a single frame.
- Motion uses only `.loop`, `.frames`, `.spin` and `.transition`. No timers, no `cx`.
- Status accents may use `theme()` colors. Sprite art uses its own palette.
- Blocked, the creature is on fire, in `FIRE`'s colors: a bed of flames along the bottom
  row holds still, so one frame shows it, and tongues flicker in turn over it and up both
  sides. The tall tongues go behind the art and lick up by one cell. The `!` badge goes over
  the fire and keeps the theme's blocked color.
- Working, the creature works the way `work` names, one of `WORKS`. Any other value (null,
  a name it doesn't know, `"__proto__"`) is the creature's own way, `ownWork(sprite)`: a
  hash of its seed, apart from the art's, so a seed's creature looks as it always did.
  `work` changes nothing in any other status.
  - `walk`: eyes glance right, feet step in turn, body bobs, speed lines behind.
  - `typing`: open eyes, a keyboard under the face, keys lighting in the theme's working
    color in an uneven rhythm, the body bobbing once a keystroke.
  - `reading`: eyes glance right, an open book under the face; a leaf turns across the
    spine and a highlight runs along a line while the body sways.
  - `hammering`: open eyes, a hammer held up at the top left slams down on an anvil at the
    bottom left; sparks flick and the body dips with each blow.
  - `searching`: eyes glance right, a lens wanders across the creature, which shows through
    its tinted glass.
  - `thinking`: open eyes, a thought bubble 5 by 2 cells in the top left corner, its dots
    lighting in turn; a tail leads from it to the head: one puff, or two shrinking ones
    where there is room, ending in an empty cell beside the art at most 2.5 cells from the
    bubble, never in the top row or the two left columns. The creature leans slowly.
  - `signal`: eyes glance right, an antenna held up at its left, two radio arcs pulsing out
    of its tip in turn.
- A way of working draws its props over the lower body, in the top left corner or in empty
  cells, where no kind has an eye. A prop that crosses the face (the hammer, the lens) draws a second copy
  of the eyes over itself. A prop under the face (the keyboard, the book) covers row 8 down,
  where some creatures (8% of seeds) have their eyes: it draws those eyes again over
  itself, with the torso's own loop, so they bob with the body. No way hides an eye in the
  still frame. Props use their own colors or the theme's working, foreground,
  dim, canvas and accent, never `HIT`, `FIRE` or the blocked, done and idle cues. Every way
  stays inside the box through all its motion at any `px`, and loops each property of an
  element once: a part that moves two ways nests a layer.
- `hit` is `{ n, damage, live } | null`. It adds a flash of the creature's silhouette in
  `HIT.removed` (`damage`) or `HIT.added`, and a knock of one cell: sideways for damage,
  up otherwise. `live` draws it at full strength; settled, both ease back with
  `.transition`. Its ids carry `n`.
- `stage` is how long the status has held: the number of that status's `STAGES` times
  reached, ascending ms from the status's start, 0 when the start is unknown. A look that
  changes the longer a status holds (a block that burns hotter, an idle that gathers dust)
  adds its times to `STAGES` and reads `stage`. None does yet: every list is empty, and
  `stage` changes nothing.

### Contract: `edits.js`

```js
export function parseNumstat(stdout): Diff;           // `git diff --numstat`, binary files left out
export const countLines = (text) => number;
export function growth(before, after): Lines;         // { added, removed }: only what grew
export async function readDiff(root): Diff | null;    // against HEAD, untracked files as added
export const START: Cursor;                          // { lines: 0, last: "" }: nothing read yet
export function parseReflog(lines): HeadMove[];     // reflog file lines, oldest first
export const isCommit = (subject) => boolean;       // git's note for a new commit made here
export function moveKind(subject): MoveKind | null;  // a move that is no commit: the command its note names
export async function readMoves(log, from: Cursor): { moves: HeadMove[], to: Cursor } | null; // the lines after `from`
export class EditWatcher {
  constructor(onGrowth: (root, lines, cx) => void, onCommit?: (root, sha, cx) => void, onMove?: (root, move: Move, cx) => void);
  follow(dirs, cx): void;   // watch the repositories these folders are in, and no other; ask a folder in none again after 10 s
  rootOf(dir): string | null;
}
```

- Git runs with `--no-optional-locks`, so reading a diff never writes the index and never
  wakes its own watch.
- Growth counts per file: a commit, stash or revert shrinks the diff and is no hit. The
  first read is a baseline, so starting Herdr is no hit either.
- At most 50 untracked files are read per look.
- The reflog is HEAD's own file (`rev-parse --git-path logs/HEAD`, relative to the repository
  unless its git folder is elsewhere, as in a linked worktree; not `--path-format`, which git
  before 2.31 echoes back). Its path is asked for again on each look until git tells it. A
  `Cursor` is `{ lines, last }`: the lines read and the text of the last one. A read starts at
  that last line. When it has moved (`git reflog expire` drops the oldest lines), the read goes
  on from wherever it is now. When it is gone (the reflog rewritten or deleted), the read goes
  on from the reflog's end, with no moves. An absent
  reflog (no commits yet) reads as `START`; a line git has not finished is left for the next
  read.
- A `HeadMove` is `{ sha, subject }`: the commit HEAD moved to and git's reflog note. A
  commit is a move whose note is `commit: `, `commit (initial|amend|merge): ` or
  `merge <x>: Merge made by ...` (a clean `git merge` that made a merge commit). A
  checkout, reset, rebase, pull, fast-forward or cherry-pick (`commit (cherry-pick): ` too) is
  not.
- Any other move is a `Move`, `{ kind, sha, subject }`, when its note names a known command.
  `MoveKind` is `checkout` (`git switch` too), `reset` (`git stash` too), `rebase`, `pull`
  (its note carries its options: `pull --rebase (pick): `), `cherry-pick` (`commit
  (cherry-pick): ` too), `merge` (a fast-forward) or `revert`. A note of any other kind
  (`clone: `, `am: `) is no move.
- Commits and moves count from the first good read: starting Herdr is no commit, and so is anything
  already in the reflog when that first read failed. A repository found where a folder had
  none (`git init`) counts from the start of its reflog, and is reported as soon as it is
  watched. A folder found late in a repository already watched does not make it new. A failed read keeps where the reading got to. One look reports one
  thing at most: the newest commit, else the newest move. A rebase writes many lines, often
  in one look, and is one move; a commit outweighs the checkouts and resets seen with it.
- A linked worktree's git folder (`rev-parse --absolute-git-dir` outside the repository)
  is watched too. Each watched folder has one pending `watchFolder` at a time.

### Contract: `bees.js`

```js
export const BEE = "pixel.bee.";                         // label prefix of a running sub-agent
export function beesOf(address, rows?, all?): Bee[];     // { key, kind, status }
export const BEE_W = 7, BEE_H = 5;                       // cells
export function beeElement({ kind = "bee", status, px = 2, flip, phase }): Element;
```

- An agent's bees are its live `hc` helpers depth first, found through ended helpers too, then one per `pixel.bee.<id>`
  label on its terminal with a value, in key order. `key` is the helper's address or the
  label's key: unique among one agent's bees and stable while the helper lives.
- `kind` is `"sheep"` for an `hc` helper, whatever it runs, and `"bee"` for a label: it
  says who runs the helper, Herdr or the agent's own program.
- A helper in `rows` (it has a row of its own) is still its parent's bee, but its own
  helpers are its own bees, not its parent's.
- `status` is `"working" | "blocked" | "idle"`. A helper that reports nothing is a plain
  command and works while it lives. `error` is blocked. `done` is idle: a helper reports
  to its parent, and the parent's done is the news. A label's bee always works.
- `beeElement` draws the figure of its `kind`. It is `BEE_W * px` by `BEE_H * px`, lifts
  by up to `px` while it works, and uses no ids and no timers. `flip` mirrors it to face
  left. Blocked, a bee's wings or a sheep's fleece take the theme's blocked color.
- `tools/bee-hook.sh tool|think` keeps `pixel.work` from the same hooks: `tool` on
  `PreToolUse` sets the way the tool names (Read is reading; Edit, MultiEdit, Write,
  NotebookEdit and apply_patch are typing; Bash and shell are hammering; Grep and Glob are
  searching; WebFetch, WebSearch and web_search are signal) and removes the label for any
  other tool. Claude Code's names are measured; Codex's `Bash` is seen in its hook
  matchers; `apply_patch`, `shell` and `web_search` are unverified guesses at Codex's.
  `tool` and `think` parse only the JSON before the tool's own input, at most 8 KiB, so
  keys inside the input are never taken for the hook's; Claude Code puts `agent_id` and
  `tool_name` there, after short fields only. `start`, `stop` and `clear` are rare and
  parse all of it, since no order of their fields is promised. `think` on `UserPromptSubmit` sets
  thinking. Both leave the label alone for a sub-agent's event (`agent_id`). The way holds
  until the next tool or prompt: a read or an edit is over in a moment, so a label held
  only while the tool runs would never be seen. A killed agent's label stays until the
  terminal's next hooked session start, but shows only while the agent works.
- `tools/bee-hook.sh start|stop|clear` writes the labels from an agent's hooks. It never
  fails or stalls its agent: each `hc` call is killed after 2 seconds. It does nothing
  outside an `hc` terminal. `clear` leaves the labels alone on a compaction, in a
  sub-agent's own session start, and while another live program owns them: `pixel.hive`
  holds the pid of the owning program, the hook's parent process, and `clear` takes
  ownership when that program has died. `clear` removes `pixel.work` too.
- `tools/install-hooks.mjs` (`just hooks`) adds the five hooks to Claude Code's
  `settings.json` and Codex's `hooks.json`, which share one shape. It appends, because
  Codex keys a hook's trust by its place in its list, and never changes a hook already
  there: an event has the hook only when a command is exactly the one it writes, or that
  with the path unquoted, in a group that runs for everything (no matcher, `""` or `"*"`).
  The same command under any other matcher runs only for some tools, so it is left with a
  note and the hook is added after it. It refuses a file that parsing and writing back would change by
  more than spacing, a hard link, and a link to nothing. It keeps a backup, writes a
  temporary file with the old file's exact mode, and swaps it in only if the old one is
  still what it read (a new file only if none appeared). Any failure before the swap is a
  refusal that leaves the file untouched and nothing beside it, and one program's failure
  never stops the next.

### Contract: `identity.js`

```js
export const MOD = "pixel-party";
export const LABEL = "pixel.avatar";
export const seedFor = (address) => string;      // the label, else the address
export const hasAvatar = (address) => boolean;   // true only with a usable label
export function setAvatar(address, seed): Promise<ExecResult>;  // rejects a bad seed
export const clearAvatar = (address) => Promise<ExecResult>;
export const openPicker = (address, kind = "popup") => string;  // 284 by 348 px
```

A seed is 1 to 32 characters of `[a-z0-9-]`, not starting with `-`. `setAvatar` and
`clearAvatar` resolve with hc's result: a `code` other than 0 means the label was not
written.

### Contract: views

```js
export default class Drawer { init(props, cx) {}  command(name, cx) {}  render(cx) {} }
export default class Picker { init(props, cx) {}  render(cx) {} }
```

Plain classes, not `View`s: `main.js` owns the one `View` and calls them. `init` is
optional. A view calls `cx.notify()` from its own callbacks when its state changes.
Picker props are `{ view: "picker", terminal, overlay }`.

## Drawer behavior

- Rows follow `agents()` in the order given. No agents: render an empty `div()` so the
  floating block hides.
- A row is a sprite cell and a text column. The sprite cell is 48 px wide: a 36 px sprite
  with 6 px on each side. The dock script leaves exactly that strip showing (`PEEK = 48`).
- `placement()` decides the shape. On the right edge the sprite cell is on the right. On
  the left edge, and docked in a layout block, it is on the left. On the top and bottom
  edges the sprites stand in a row with names under them.
- The layout never changes on hover: the drawer slides, the content stays.
- The text column names the agent and shows its status line: the agent's own message
  (`terminals()` entry's `report.msg`) when it has one.
- A working agent's sprite works the way its terminal's `pixel.work` label names, else its
  own way. The drawer passes the label as it is; `spriteElement` decides what counts.
- Status is shown twice: by the sprite, which carries its own motion and status mark, and
  by a theme-colored stripe on the cell's edge side. A blocked agent is the most visible
  thing in the drawer: its cell and row are tinted as well. The sprite draws the only `!`.
- The current agent's row is marked: the pane with the keyboard when it is an agent, else
  Herdr's current agent (`focused().agent`). It is the agent the commands act on.
- Click: `run("pane.focus", { pane })`. Right click: `openPicker(address)`.
- A hit in a repository lands on the agents working in it, else on every agent in it. Only
  agents on this computer are watched. Its numbers sit in the sprite cell, so a closed
  drawer shows them. It holds 90 ms, then each number curves 14 px up and 14 px aside
  (`top` eases out while `left` eases in) and fades; it is gone after 1.4 s. A new
  hit on the same agent replaces the last one.
- A commit in a repository stamps the same agents a hit would, in the box over the sprite's
  lower right, so a closed drawer shows it. The tool, 8 by 9 cells of 3 px, is drawn 14 px
  above its spot and unseen, then 30 ms later falls onto the spot over 340 ms, easing in, as
  it shows. The box dips 3 px as it lands. The tool stays down until 900 ms, then rises back
  and fades over 400 ms, the box rises over 500 ms, and the mark shows where it pressed: a
  bold check, 8 by 6 cells in `theme().done`, outlined dark so it reads on any creature. The
  mark holds, fades over 1 s from 2.7 s, and is gone at 3.8 s. Each step is slow enough to
  follow by eye. A new stamp on the same agent replaces the last, with new ids.
- A move of HEAD that is no commit lands on the same agents a hit or a stamp would. The
  drawer keeps the last one per agent (`moves`, by address) and draws nothing for it yet: a
  one-shot for its kind plays from there.
- Bees sit under the sprite's box, never over the creature: in lanes of three, as wide as
  the sprite cell, so a closed drawer shows them. An agent's cell grows by one lane for
  up to three bees and two for more, and has none without bees. With more than six bees
  the sixth place shows a count of the rest. They can't leave the drawer: Herdr clips a
  floating mod to its frame. A bee not seen before is drawn first in the
  middle of the sprite, unseen, and 40 ms later at its place: it flies there over 450 ms.
  When a bee leaves, the ones after it glide up a place.
- An agent not drawn the time before arrives by a trick, in the box over its sprite. The
  agents of the first draw were there before the drawer, so they get none; an agent that
  leaves and comes back gets one again, and a new seed for the same agent gets none. The
  sprite is unseen until the reveal. A wand, 7 by 7 cells of 3 px, shows over the box's
  upper right, and at 240 ms taps down toward the middle over 180 ms. At 440 ms it fades
  and a puff goes up over the middle: five round clouds in three greys and four plus-sign
  sparkles, gold and lilac. At 760 ms the clouds drift out to twice their distance and the
  sparkles a cell further, all fading over 520 ms, while the sprite fades in over 360 ms.
  It is gone at 1.5 s. Its status line reads "Abracadabra!" until then.
- A new bee comes out of the same puff at 2 px cells over the middle of the sprite. It
  clears as the bee flies out, 60 ms later, and is gone at 800 ms. Bees of the first draw
  get none. Stamps, tricks and puffs share one timeline helper (`play`): each step is one
  render, and a new one on the same agent replaces the last, with new ids. A one-shot for a
  status change is to play through it too; none exists yet.
- Each draw keeps every agent's status and finds the changes since the draw before, as
  `{ address, from, to }` (`changes`). Only agents drawn both times can change: the first
  draw, a new agent and an agent that left and came back have none, and an empty drawer
  forgets them all. The same draw is the moment every agent is done (`allDone`) when one
  of the changes is to done and every agent is done; an all-done first draw, a redraw, or
  the last agent not done leaving is not. The changes are found before the items are
  built, so a one-shot started from them shows on that draw.
- The same draw keeps each agent's status clock (`since`): when its status began, in ms
  since the epoch, or null when unknown. A change starts it at that draw; a status that
  flips and flips back between two draws keeps it running. An agent not drawn the time
  before (the first draw, a new agent, one that comes back, every agent after the drawer
  reopens) takes its start from its tab when it is the only agent in it: the tab's
  `working_since` while it works, else the tab's `changed_at`. Those are per tab, and
  `terminals()` has no times, so an agent that shares its tab, or whose tab has no time,
  has no known start until its next change. The tab fields' meaning is as
  `types/herdr.d.ts` documents it, not measured. Each draw turns the clock into the
  sprite's `stage` (`stages`). Sprite motion has no timers, so the drawer sets one for the
  nearest next stage of any agent and redraws then. One is pending at a time: a redraw
  before it is due adds none, a sooner one replaces it, and the replaced one does nothing.
  An agent with no known start, or at its status's last stage, needs none.
- Commands act on the current agent, as marked: `pick` opens the picker as a dialog,
  `reroll` saves a random seed, `reset` clears the label. With no agent they do nothing.

## Picker behavior

- Shows whose sprite it is, the current sprite, and whether it is chosen or the default.
- A grid of 16 candidates from `randomSeed()`. Choosing one saves it and closes the popup.
- Shuffle replaces the candidates. Reset clears the label and closes; it is plainly
  unavailable when there is no label to clear.
- A failed save keeps the popup open and says so. Nothing is closed on a failure.
- Esc closes: Herdr does that for popups and dialogs.

## Checks

- `just test`: node tests under stand-ins for `gpui-kit`, `gpui-base` and `herdr`
  (`tests/mocks/`). The stand-ins refuse what the app refuses: unknown builder methods,
  non-hex colors, bad motion arguments, `on_click` without an id, duplicate ids.
- `just check`: the app's own loader. Needs Herdr installed.
- Live: `just install`, `just dock`, then `herdr-app shot`.
