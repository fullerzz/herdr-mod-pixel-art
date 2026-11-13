# Pixel Party: design

A Herdr mod. Every agent gets a small generated pixel creature. The creatures stand in a
floating drawer at the window's edge and move according to what their agent is doing. A
picker lets the person choose another creature for an agent.

## What the person gets

- **Drawer.** One row per agent. Docked on a side edge it is a drawer: a strip of sprites
  shows, and hovering slides out each agent's name and what it is doing. Clicking a row
  goes to that agent. Right-clicking a row opens the picker.
- **Sprites.** Each sprite is generated from a seed, so the same seed always draws the same
  creature. A sprite moves natively: it walks while its agent works, asks for attention
  when the agent is blocked, celebrates when it finished, and rests when it is idle.
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
- **Bees.** Each helper an agent has running is a small figure beside its sprite: a sheep
  for a terminal it started with `hc run`, a honey bee for a sub-agent inside its own
  program. Both are called bees below. A new bee flies out of the sprite; it leaves when
  its helper ends.
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
| A Claude Code hook's parent process is `claude` itself (measured for SessionStart, SubagentStart and SubagentStop). A `claude -p` run from an agent's tool inherits `HC_TERMINAL_ID` and starts a session of its own. | `clear` tells the owner's own new session from a nested program's session by pid. |
| Herdr clips a floating mod to its frame: a child placed outside it is not drawn. | Bees get room inside the drawer, in lanes under the sprite. |
| A `Context` in `render` has the same `timer` as an `AsyncContext`. | A new bee's second render is scheduled from `render`. |
| `.transition(property, ...)` animates a change of that property between two renders of the same id. | A hit renders twice: at full strength, then settled. A new hit gets new ids so it starts over. |

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
| `sprite-view.js` | sprites | Sprite to element, with motion per status and a hit's flash and knock. |
| `edits.js` | drawer | Lines added and removed in the agents' repositories, from git. |
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
export function spriteElement(sprite, { id, px = 3, status = null, hit = null }): Element;
export const HIT: { added: "#3ddc6a", removed: "#ff4d5e" };
```

- Returns one element exactly `GRID * px` square that does not shrink in a flex row.
- `id` is required and unique per call site. Any id used inside starts with `id + "-"`.
- `status` is `"working" | "blocked" | "done" | "idle" | null`. `null` is a still pose.
- Each status is recognisable in a single frame as well as in motion, since a screenshot
  is a single frame.
- Motion uses only `.loop`, `.frames`, `.spin` and `.transition`. No timers, no `cx`.
- Status accents may use `theme()` colors. Sprite art uses its own palette.
- `hit` is `{ n, damage, live } | null`. It adds a flash of the creature's silhouette in
  `HIT.removed` (`damage`) or `HIT.added`, and a knock of one cell: sideways for damage,
  up otherwise. `live` draws it at full strength; settled, both ease back with
  `.transition`. Its ids carry `n`.

### Contract: `edits.js`

```js
export function parseNumstat(stdout): Diff;           // `git diff --numstat`, binary files left out
export const countLines = (text) => number;
export function growth(before, after): Lines;         // { added, removed }: only what grew
export async function readDiff(root): Diff | null;    // against HEAD, untracked files as added
export class EditWatcher {
  constructor(onGrowth: (root, lines, cx) => void);
  follow(dirs, cx): void;   // watch the repositories these folders are in, and no other
  rootOf(dir): string | null;
}
```

- Git runs with `--no-optional-locks`, so reading a diff never writes the index and never
  wakes its own watch.
- Growth counts per file: a commit, stash or revert shrinks the diff and is no hit. The
  first read is a baseline, so starting Herdr is no hit either.
- At most 50 untracked files are read per look.

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
- `tools/bee-hook.sh start|stop|clear` writes the labels from an agent's hooks. It never
  fails or stalls its agent: each `hc` call is killed after 2 seconds. It does nothing
  outside an `hc` terminal. `clear` leaves the labels alone on a compaction, in a
  sub-agent's own session start, and while another live program owns them: `pixel.hive`
  holds the pid of the owning program, the hook's parent process, and `clear` takes
  ownership when that program has died.
- `tools/install-hooks.mjs` (`just hooks`) adds the three hooks to Claude Code's
  `settings.json` and Codex's `hooks.json`, which share one shape. It appends, because
  Codex keys a hook's trust by its place in its list, and never changes a hook already
  there: an event has the hook only when a command is exactly the one it writes, or that
  with the path unquoted. It refuses a file that parsing and writing back would change by
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
- Bees sit under the sprite's box, never over the creature: in lanes of three, as wide as
  the sprite cell, so a closed drawer shows them. An agent's cell grows by one lane for
  up to three bees and two for more, and has none without bees. With more than six bees
  the sixth place shows a count of the rest. They can't leave the drawer: Herdr clips a
  floating mod to its frame. A bee not seen before is drawn first in the
  middle of the sprite, unseen, and 40 ms later at its place: it flies there over 450 ms.
  When a bee leaves, the ones after it glide up a place.
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
