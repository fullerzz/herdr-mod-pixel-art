# Pixel Party: design

A Herdr mod. Every agent gets a small generated pixel creature. The creatures stand in a
floating drawer at the window's edge and move according to what their agent is doing. A
picker lets the person choose another creature for an agent.

## What the person gets

- **Drawer.** One row per agent. Docked on a side edge it is a drawer: a strip of sprites
  shows, and hovering slides out each agent's name and what it is doing, while the
  creatures turn toward the side it opens to. Clicking a row goes to that agent.
  Right-clicking a row opens the picker. The current agent, the one the keys act on, wears
  a small gold crown over its creature, so a closed drawer shows it too.
- **Sprites.** Each sprite is generated from a seed, so the same seed always draws the same
  creature. A sprite moves natively: it works while its agent works, catches fire and asks
  for attention when the agent is blocked, celebrates when it finished, and rests when it
  is idle.
- **Fidgets.** An idle creature fidgets in its own way, at its own rhythm, both picked by
  its seed: a blink, a glance aside, or a scratch at its side. A fidget shows only for a
  moment of its rhythm, so almost every frame of an idle creature has its eyes shut.
- **Jolt.** When an agent becomes blocked, its creature jumps as if startled and drops
  back, then the fire catches and the badge shows.
- **Fire out.** When a blocked agent goes on, water pours on its creature's fire and puts it
  out, steam rises off the ashes, and the creature goes back to work.
- **Cheer.** When a working agent finishes, its creature cheers once: a burst of confetti
  pops out from behind it and drifts down as it fades, then the done pose goes on as usual.
- **Ways of working.** A working sprite shows what its agent is doing, when the agent's
  hooks say: it types while the agent edits files, reads a book while it reads, bubbles a
  test tube while it runs tests, lifts bricks with a crane while it builds, unpacks a box
  while it installs, grows a branching twig while it uses git, hammers while it runs other
  commands, sweeps a lens while it searches, holds up an antenna while it fetches from the
  web, thinks when a prompt comes in, and is squished in a press while it compacts its
  context. Otherwise it works its own way, picked by its seed: a walk, or one of the six
  ways from before the four for kinds of command.
- **Time of day.** A creature at rest (done or idle) keeps a prop for the local time of day
  at its lower right: a lantern at night, a cup of coffee in the morning.
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
  by removed ones. A hit's size follows its lines: a change of a line or a few is a small
  tick, a big one a crit, with bigger numbers, a CRIT tag, a solid flash and a longer stop.
  Three or more hits on one agent, each within a few seconds of the last, are a combo: a
  `3 HIT COMBO` counter that grows with each hit and fades when the hits stop.
- **Stamps.** A commit made in an agent's repository is a stamp of approval: a rubber stamp
  slams down on its sprite, the cell dips under the blow, and the stamp lifts away to leave a
  check that holds a moment, then fades. The check is in the "done" color and says
  "approved" by its shape: red is the "Needs you" cue, so the stamp never relies on it.
- **Claps.** The other agents in the repository of a commit, the ones its stamp does not
  land on, clap: two white gloves clap three times in front of each sprite, then fade.
- **XP bar.** The lines changed in an agent's repository since its last commit fill an XP
  bar under its sprite, full at a level's worth (100 lines). A commit cashes it in: the
  stamp lands, the bar drains, and a commit of a full bar's worth pops a `LEVEL UP` over
  the creature.
- **Signposts.** A checkout or switch in an agent's repository flips a signpost by its
  sprite: it shows pointing back the way HEAD came from, turns edge-on, and points the
  other way, then fades. A reset rewinds the sprite: it spins backwards three times, its rows
  jittering like a worn tape, under a blinking `◀◀`. A rebase shuffles a deck of cards in
  front of the sprite: it splits and riffles twice, then fades. Other moves of HEAD get
  one-shots of their own the same way.
- **Smoke.** A shell command an agent runs that fails makes its sprite cough: it lurches,
  and a puff of black smoke goes up from its face and clears. Only Claude Code's hooks say
  so (`PostToolUseFailure`).
- **Test results.** Tests that pass get a thumbs up held in front of the sprite's right
  side, over its right eye; tests that fail make it drop its test tube, which tips over
  and spills. Failed tests show this instead of smoke. Only Claude Code's hooks say so (`PostToolUse` and `PostToolUseFailure`).
- **Bees.** Each helper an agent has running is a small figure beside its sprite: a sheep
  for a terminal it started with `hc run`, a honey bee for a sub-agent inside its own
  program. Both are called bees below. A new bee flies out of the sprite from a puff of
  smoke. When its helper ends, a bee flies back into the sprite and fades, and a sheep hops
  off to the side.
- **Arrivals.** A new agent arrives by a magic trick: a wand taps its empty cell, a puff of
  smoke and sparkles goes up, and its sprite is there when the smoke clears.
- **Departures.** An agent that ends leaves by the trick in reverse: a wand taps its sprite,
  a puff of smoke goes up, and the cell is empty when the smoke clears.
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
| A Bash command that exits 0 fires `PostToolUse`: `session_id`, ..., `hook_event_name`, `tool_name`, `tool_input`, then `tool_response` (`stdout`, `stderr`, `interrupted`, ...), `tool_use_id`, `duration_ms`. One with `run_in_background: true` fires it at once, 4 ms in, with empty output and then `backgroundTaskId` in `tool_response`, and its end fires no hook. So does one that outlives its `timeout` (2 s for a 15 s test): it moves to the background, and `PostToolUse` comes at the timeout with empty output, `backgroundTaskId` and `timedOutAfterMs`, and no `run_in_background` in its input. A piped command's exit code is its last program's: `node --test` with a failing test, piped to `tail`, fired `PostToolUse`. (Claude Code 2.1.332, measured with `claude -p`.) | Tests passed when `PostToolUse` comes for a test command of a shell tool with no pipe in it and no `backgroundTaskId`. |
| A Bash command that exits other than 0 fires Claude Code's `PostToolUseFailure`, not `PostToolUse`. Its JSON is `session_id`, ..., `agent_id` and `agent_type` for a sub-agent's, `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms`. The exit code is only text at the start of `error` (`"Exit code 2\n..."`), which also holds the output, cut to about 10 KB: a failed `seq 1 200000` was 13 KB in all. `PostToolUse` has no exit code at all, and a 1.2 MB output made it 37 KB. A failed Edit (no match) fired neither. (Claude Code 2.1.332, measured with `claude -p`.) Codex 0.172's hook events include no failure event. | A failed command is the `PostToolUseFailure` hook for a shell tool, with no parsing of the error. Codex gets no hook for it. |
| `hc label` on the caller's own terminal takes about 10 ms; the whole tool hook about 30 ms. A `PreToolUse` JSON holds the tool's whole input (a Write's content: megabytes), after `tool_name` and `agent_id`. | Before a tool or a prompt, the hook parses only up to `"tool_input"`, at most 8 KiB, and reads the rest to throw it away unparsed. A 2 MB Write costs it about 20 ms, not the 530 ms of parsing it all. A shell tool's command is the one exception, with a budget of its own: the first 512 bytes after `"tool_input"`, within those 8 KiB. |
| `.loop` plays its return leg as the forward leg backwards, easing included: an 8 s ease-in `top` loop is symmetric about its far end, slow to leave home and slow to come back. `.loop("width")` runs too. | Two loops of one period with ease-out and ease-in light in one order and go out in the reverse, as the previews in Chrome (CSS `alternate`) showed. |
| Claude Code runs `PreCompact` (`trigger`, `custom_instructions`, no `tool_input`) when a compaction starts, then `SessionStart` with `source` `"compact"` when its summary is written, about 4 s later, then `PostCompact`. `/compact` sends no `UserPromptSubmit`. (Claude Code 2.1.332, `/compact` in `claude -p`: `trigger` `"manual"`; an automatic compaction is not measured.) | `compact` on `PreCompact` sets the way, and `clear` on the compaction's session start ends it: no hook of its own. |
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
| `sprite-view.js` | sprites | Sprite to element, with motion per status and way of working, a turn for a status change, and a hit's flash and knock. |
| `edits.js` | drawer | Lines added and removed in the agents' repositories, the lines left uncommitted there, and HEAD's moves there, from git. |
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

`Sprite` is opaque to the drawer and the picker: they pass it to `spriteElement` or
`faceRects` and read nothing from it. Its shape is the sprites module's own business, with
these guarantees:

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
export function spriteElement(sprite, { id, px = 3, status = null, work = null, hit = null, turn = null, stage = 0, tube = true, daytime = null, face = null }): Element;
export const HIT: { added: "#3ddc6a", removed: "#ff4d5e" };
export const FIRE: { red: "#e5381f", orange: "#ff8c1a", yellow: "#ffd447" };
export const DOUSE: { water: "#2f8fe8", spray: "#a3d8ff", steam: "#e3eaf0", haze: "#9eabb7" };
export const CONFETTI: { pink: "#ff5fa2", violet: "#a77bff", sky: "#4cc9f0" };
export const TURNS: Record<string, Turn>;       // one-shots for a status change: jolt douse cheer stretch
export const WORKS: readonly string[];          // walk typing reading hammering searching thinking signal testing building installing git compacting
export function ownWork(sprite): string;        // one of WORKS' first seven, the same for the same seed
export const FIDGETS: readonly string[];        // blink look scratch
export function ownFidget(sprite): { fidget: string, period: number };  // one of FIDGETS and its rhythm in ms, the same for the same seed
export const STAGES: Record<Status, number[]>;  // ms a status holds to reach each stage; all empty for now
export function faceRects(sprite, face, px = 3): { x, y, w, h, color }[];  // the creature still from one side, in px
export function daytimeOf(hour): "night" | "morning" | null;  // the part of the day of a local hour, 0 to 23
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
  hash of its seed, apart from the art's, so a seed's creature looks as it always did. It
  picks from the first seven only: the four ways for kinds of command and compacting came
  later, and a seed keeps the own way it had. `work` changes nothing in any other status.
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
  - `testing`: eyes glance right, at a test tube in the two columns at the right edge:
    glass over liquid in the theme's accent, three bubbles lighting from the bottom up.
    With `tube: false` it holds none, and only watches and bobs: the drawer draws how the
    tests came out in its place. `tube` changes nothing in any other way.
  - `building`: open eyes, a crane: a mast behind the right edge and a jib along the top
    row, both dim, and a brick on a cable rising from a pile at the left foot to row 3 and
    back, the cable reeling in with it.
  - `installing`: open eyes, an open box over the feet, its flaps waving out of its top
    corners, and a package in the theme's accent popping up out of it to row 8 and back.
  - `git`: open eyes, a twig up the left edge with a leaf on its tip, branching over the
    head, where its branch grows out a cell at a time to a leaf in the theme's working color.
  - `compacting`: open eyes, a press: two dim rails in the edge columns and a plate in the
    theme's foreground resting on the head, hung from a dim rod. The plate comes down a cell
    with the body, slowly and then with a slam, and lifts again: the body sinks over the
    feet, which stay, so the creature is a cell shorter, squished.
- A way of working draws its props over the lower body, in the top left corner, in the two
  columns at each edge or in empty cells, where no kind has an eye. A prop that crosses the face (the hammer, the lens) draws a second copy
  of the eyes over itself. A prop under the face (the keyboard, the book, the package) covers row 8 down,
  where some creatures (8% of seeds) have their eyes: it draws those eyes again over
  itself, with the torso's own loop, so they bob with the body. No way hides an eye in the
  still frame. Props use their own colors or the theme's working, foreground,
  dim, canvas and accent, never `HIT`, `FIRE` or the blocked, done and idle cues. Every way
  stays inside the box through all its motion at any `px`, and loops each property of an
  element once: a part that moves two ways nests a layer.
- Idle, the creature has closed eyes, is dimmed, breathes slowly, and a "z" fades behind
  it. Now and then it fidgets its own way, `ownFidget(sprite)`: a hash of its seed with a
  salt of its own, apart from the art's and the way of working's, so a seed's creature
  looks and works as it always did. The hash picks one of `FIDGETS` and a period of 3.6 to
  7.4 s, its rhythm. The fidget rides in the torso, so it breathes and dims with the body.
  It sits in six nested layers, each swinging its opacity from 0 to 1 and back on that
  period with `ease-in`: their product is a spike at the middle of the period, over half
  strength for under a ninth of it even if the easing were linear. The still frame is the
  start of the period, so it has the closed eyes.
  - `blink`: the open eyes show over the closed ones, on a patch of the body where the lid
    is, so no lid shows through eyes that leave its cells empty.
  - `look`: the same, with the eyes glancing right.
  - `scratch`: the eyes stay shut; two strokes in the theme's foreground jiggle in the
    empty column at its left edge, clear of the time of day's props at the right.
- `hit` is `{ n, damage, live, size? } | null`. It adds a flash of the creature's silhouette
  in `HIT.removed` (`damage`) or `HIT.added`, and a knock: sideways for damage, up
  otherwise. `live` draws it at full strength; settled, both ease back with `.transition`.
  Its ids carry `n`. `size` is a `HitSize`, `"hit"` when left out: a hit flashes at 0.9
  and fades over 320 ms, and knocks one cell. A tick flashes at 0.5, fades over 200 ms and
  knocks a third of a cell (at least a pixel). A crit flashes solid and fades over 700 ms;
  its knock is one cell too, since the art leaves only the outer ring empty.
- `turn` is `{ kind, n, step } | null`: a one-shot being played because the agent's status
  changed. A `Turn` in `TURNS` is `{ from, to, first, steps, eyes, build }`: the change it
  plays on (null for any status), its first step, when each next step starts in ms from the
  change (null: over), the creature's eyes (one mood, or a mood by step, open for a step
  it leaves out), and what it does at a step: `build` gets the
  same parts a way of working gets, plus the turn's `id` and `step`, moves them as it likes
  and returns its marks. While a turn of a known `kind` plays it takes the status's place:
  no way of working, status motion or status accent is drawn, and a part the turn leaves
  alone holds still. Any other `kind` (`"__proto__"` too) is no turn. Its ids start with
  `id-<kind>-<n>-`, and a part keeps its id from step to step, so `.transition` eases
  between them. A new turn adds an entry to `TURNS`.
  - `jolt`, from any status to blocked, the only turn to blocked, with open eyes: `jump`
    snaps the feet and torso up a cell at once, over two 2-cell dashes in the theme's
    foreground on the bottom row; `land` drops them back over 140 ms, easing in, and the
    dashes go; `catch` fades the blocked fire in over 300 ms, easing in. The fire is drawn
    from `jump`, at opacity 0, so it fades rather than pops. It draws no badge and no other
    `!`: the badge is the blocked look's, the only `!`, and shows when the jolt is over.
  - `douse`, blocked to working, with the creature still: `pour` draws the blocked fire,
    without its badge, under water hanging in the top rows; `splash` drops the water onto
    the bed over 300 ms, easing in, and the fire and its tongues die out as it lands, while
    spray shows at both ends of the bed and steam gathers on it; `steam` clears the water
    and spray, and the steam rises six cells off the bed as it fades over 1 s. Water and
    steam are in `DOUSE`'s colors, never `FIRE`'s, `HIT`'s or a status cue's.
  - `cheer`, working to done, with happy eyes and the done pose's hop (one cell up, 700 ms,
    on the feet and torso, so the done pose takes over without a jump), and no done
    sparkles until it is over: eight bits of confetti, one cell each, behind the creature so
    they never cover a face. `pop` gathers them, unseen, on the cell they burst from behind
    the body; `burst` throws them out to the top rows and the edge columns over 420 ms,
    easing out; `fall` drops them three cells over 900 ms, easing in, as they fade. They are
    in `CONFETTI`'s colors, never `HIT`'s, `FIRE`'s, `DOUSE`'s or a status cue's. It is over
    within 2 s, before any later done look that waits a few seconds (`STAGES`) would start.
  - `stretch`, from any other status to working (it comes after `douse`, so blocked to
    working stays the douse): `yawn` shuts the eyes, slumps the body over the feet by a
    sub-cell move and opens a mouth in the art's ink two rows under the eyes' top, across the
    middle two columns, on body cells only; `stretch` shuts the mouth and eases the body up
    a cell over 420 ms, slowing, while the feet stay; `wake` drops it back into place over
    160 ms with open eyes, and a tick in the theme's foreground pops out behind each top
    corner. Nothing loops: it is one move, and the creature works when it is over.
- `stage` is how long the status has held: the number of that status's `STAGES` times
  reached, ascending ms from the status's start, 0 when the start is unknown. A look that
  changes the longer a status holds (a block that burns hotter, an idle that gathers dust)
  adds its times to `STAGES` and reads `stage`. None does yet: every list is empty, and
  `stage` changes nothing.
- `faceRects` is the creature still, seen from one side, for a caller that turns it: `face`
  is `"front"` (its open eyes), `"back"` (no eyes), or `"left"` or `"right"`, turned that
  way edge-on: a third as wide, centered, with only the eye on that side. The two turned
  faces mirror each other. Rectangles are in px, inside the `GRID * px` square.
- `daytime` is the part of the day, as `daytimeOf` names it from a local hour: `night` from
  20:00 to 5:59, `morning` from 6:00 to 10:59, null the rest of the day. A done or idle
  creature keeps its prop at its lower right, in front of the art. `night` is a lantern: an
  iron frame 2 by 3 cells round a lit window, a flame flickering in it. `morning` is a cup of
  coffee on a saucer, its handle toward the creature, two thin wisps of steam rising in turn
  up the right edge's column. Both keep to rows 9 to 11 and the right edge's column: a
  happy eye reaches column 10, but no lower than row 8, so they hide no eye in any mood. They
  follow the ways' rules for colors, the box and loops. Working, a way's own props fill that
  corner, and blocked, the fire does, so neither shows the prop; nor does the still pose.
  Any other value (a name it doesn't know, `"__proto__"`) adds none.
- `face` is `"left" | "right" | "up" | "down" | null`. Facing a way, everything the
  sprite draws (the creature, its props, its status marks, a turn and a hit) steps one
  cell that way as one layer, so each prop keeps its place on the creature. The step
  snaps, as a pixel creature turns round: no id and no transition. Facing left or right,
  its open or glancing eyes look that way, and so does every copy a way of working draws:
  they are `look` or `look` mirrored, whichever moves the pupils (the dark eye cells) that
  way against `open`. Most `look` eyes glance right, but pip eyes glance left. Happy and
  closed eyes are a status's cue and stay. The step is the one motion that may leave the box, by that cell; `null`
  faces out, as before.

### Contract: `edits.js`

```js
export function parseNumstat(stdout): Diff;           // `git diff --numstat`, binary files left out
export const countLines = (text) => number;
export function growth(before, after): Lines;         // { added, removed }: only what grew
export const HIT_LINES = 5, CRIT_LINES = 200;         // lines from which a change is a hit, and a crit
export const hitSize = (lines) => HitSize;            // "tick" under HIT_LINES, "crit" from CRIT_LINES, else "hit"
export const changed = (diff) => number;              // a Diff's lines, added and removed together
export const LEVEL_LINES = 100;                       // uncommitted lines that fill the XP bar: a level
export async function readDiff(root): Diff | null;    // against HEAD, untracked files as added
export const START: Cursor;                          // { lines: 0, last: "" }: nothing read yet
export function parseReflog(lines): HeadMove[];     // reflog file lines, oldest first
export const isCommit = (subject) => boolean;       // git's note for a new commit made here
export function moveKind(subject): MoveKind | null;  // a move that is no commit: the command its note names
export async function readMoves(log, from: Cursor): { moves: HeadMove[], to: Cursor } | null; // the lines after `from`
export class EditWatcher {
  constructor(onGrowth: (root, lines, cx) => void, onCommit?: (root, sha, cx) => void, onMove?: (root, move: Move, cx) => void, onDiff?: (root, lines: number, cx) => void);
  follow(dirs, cx): void;   // watch the repositories these folders are in, and no other; ask a folder in none again after 10 s
  rootOf(dir): string | null;
  uncommitted(root): number | null;  // `changed` of the last diff read; null before the first read and once unwatched
}
```

- Git runs with `--no-optional-locks`, so reading a diff never writes the index and never
  wakes its own watch.
- Growth counts per file: a commit, stash or revert shrinks the diff and is no hit. The
  first read is a baseline, so starting Herdr is no hit either.
- `hitSize` takes a count of lines, so any count can be sized: a hit's added and removed
  lines together, or a running total.
- At most 50 untracked files are read per look.
- A repository's uncommitted lines are `changed` of its diff against HEAD, untracked files
  included. `onDiff` gets them on the first read and on each read that changes them, a
  shrink (a commit, a stash, a revert) included. `onCommit` runs inside the look's reflog
  read, before that look's diff is kept, so `uncommitted` still holds the lines the commit
  took. A repository's lines are forgotten when it is no longer watched.
- The reflog is HEAD's own file (`rev-parse --git-path logs/HEAD`, relative to the repository
  unless its git folder is elsewhere, as in a linked worktree; not `--path-format`, which git
  before 2.31 echoes back). Its path is asked for again on each look until git tells it. A
  `Cursor` is `{ lines, last }`: the lines read and the text of the last one. A read starts at
  that last line. When it has moved (`git reflog expire` drops the oldest lines), the read goes
  on from wherever it is now. When it is gone (the reflog rewritten or deleted), the read goes
  on from the reflog's end, with no moves. An absent
  reflog (no commits yet) reads as `START`; a line git has not finished is left for the next
  read.
- A `HeadMove` is `{ from, sha, subject }`: the commit HEAD was at, the commit it moved to,
  and git's reflog note. A commit is a move whose note is `commit: `,
  `commit (initial|amend|merge): ` or `merge <x>: Merge made by ...` (a clean `git merge`
  that made a merge commit). A checkout, reset, rebase, pull, fast-forward or cherry-pick
  (`commit (cherry-pick): ` too) is not.
- Any other move is a `Move`, `{ kind, sha, subject }`, when its note names a known command.
  `MoveKind` is `checkout` (`git switch` too), `reset` (`git stash` too, and
  `branch: Reset to ` from `git checkout -B` of the branch already checked out; from another
  branch, `-B` writes only a checkout's note), `rebase`, `pull` (its note carries its
  options: `pull --rebase (pick): `), `cherry-pick` (`commit (cherry-pick): ` too), `merge`
  (a fast-forward) or `revert`. A note of any other kind
  (`clone: `, `am: `) is no move, and nor is a checkout of the branch already checked out
  (`checkout: moving from main to main`): HEAD goes nowhere. The watcher drops a reset that
  leaves HEAD at the commit it was at (`git stash`, `git reset --hard`), so it never hides
  an older move in the same look.
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
- `tools/bee-hook.sh tool|think|compact` keeps `pixel.work` from the same hooks: `tool` on
  `PreToolUse` sets the way the tool names (Read is reading; Edit, MultiEdit, Write,
  NotebookEdit and apply_patch are typing; Bash and shell run a command; Grep and Glob are
  searching; WebFetch, WebSearch and web_search are signal) and removes the label for any
  other tool. Claude Code's names are measured; Codex's `Bash` is seen in its hook
  matchers; `apply_patch`, `shell` and `web_search` are unverified guesses at Codex's.
  `tool` and `think` look for the hook's own fields only in the JSON before the tool's own
  input, at most 8 KiB, so keys inside the input are never taken for the hook's; Claude Code puts `agent_id` and
  `tool_name` there, after short fields only. `start`, `stop`, `clear` and `compact` are rare
  and parse all of it, since no order of their fields is promised. `think` on `UserPromptSubmit` sets
  thinking. `compact` on `PreCompact` sets compacting, and the compaction's session start
  takes it away; Codex's `PreCompact` is in its binary's list of events, unmeasured. All
  three leave the label alone for a sub-agent's event (`agent_id`). The way holds
  until the next tool or prompt: a read or an edit is over in a moment, so a label held
  only while the tool runs would never be seen. A killed agent's label stays until the
  terminal's next hooked session start, but shows only while the agent works. A
  compaction that never finishes leaves compacting until the next tool or prompt.
- A command's way is its first command's, split at `;`, `&`, `|`, `(`, `)`, a backtick and
  a newline, that runs a program the hook knows. Its program is the first word after
  settings (`FOO=1`) and wrappers (`sudo`, `env`, `npx`, ...), without its path; a program
  run by another (`uv run pytest`, `python -m pip`) counts as itself. `git` is git; a test
  runner (`pytest`, `jest`, `vitest`, ...) or `node --test` is testing; a build tool that
  does one thing (`tsc`, `make`, `gcc`, ...) is building. For a tool that does many things
  (`npm`, `cargo`, `go`, `just`, `make`, `pip`, ...) the next word decides, `npm run`'s
  script included: `test` or `test:<x>` is testing, `build` or `build:<x>` building,
  `install`, `add`, `ci` and the like installing. Any other command is hammering, and so
  are BashOutput and KillShell. The command is the input's first `"command"` string, read from its first
  512 bytes, never expanded (no globbing); a string cut there is read as far as it goes.
  Codex's shell input is guessed to take the same shape.
- `tools/bee-hook.sh fail` on `PostToolUseFailure` reports a failed command: for a shell
  tool (Bash, shell, local_shell, exec_command) of the agent's own (no `agent_id`) that the
  person did not interrupt (`is_interrupt`), it sets `pixel.result=failed.<the hook's pid>`.
  A result's value is `<kind>.<nonce>`, new for each result, so the drawer plays every one
  however many come in a row, and no tool needs to clear it first. `tool_name` and
  `agent_id` come from the head, as for `tool`, and the command from the input after it;
  `is_interrupt` from the last 64 bytes. A failure is rare, so it reads all of its JSON:
  `head` reads ahead on a pipe and would leave `tail` nothing. A 4 MB one takes about 0.2 s.
- A test command is one whose exit code is its tests' (`tests_ran`). Its last command's way
  is testing, and no other command's is, after `\n`, `;` and `&` split it, as for its way,
  with a redirect's `&` (`2>&1`, `&>`) splitting nothing, and a `\n` after `&&` or a
  backslash neither. A quoted string is first one word, whatever it holds (`git commit -m
  "wip; npm test"` runs no tests), and a quote with no end is no test command. Outside its
  quoted strings it has no `|` (so no `||` either): a pipe gives the command its last
  program's exit code, which is not the tests'. It does not end in `&`, which sends the
  tests to the background, and the JSON string's closing quote is in the input's first 512
  bytes, so nothing after them is unread. For `fail` only, every
  command before the tests in their `&&` chain is a `cd`: `npm run build && npm test` fails
  when the build does, but a chain that passed ran all of it to a good end. For one, `fail`
  sets `pixel.result=tests-failed.<pid>` instead of `failed`, and `tools/bee-hook.sh pass`
  on `PostToolUse` sets `pixel.result=tests-passed.<pid>`. `pass` runs after every tool, so
  it parses only the head, as `tool` does, and calls `hc` for nothing else: not another
  tool, not a sub-agent's, and not a command with a `"backgroundTaskId"` after its input,
  which has only started: one sent to the background, or one that outlived its timeout.
  Its output before the key is empty, so the key is in the head unless the command is
  long.
- `tools/bee-hook.sh start|stop|clear` writes the labels from an agent's hooks. It never
  fails or stalls its agent: each `hc` call is killed after 2 seconds. It does nothing
  outside an `hc` terminal. On a compaction's session start `clear` removes `pixel.work`
  only: the sub-agents outlive a compaction. It leaves the labels alone in a sub-agent's own
  session start, and while another live program owns them: `pixel.hive` holds the pid of
  the owning program, the hook's parent process, and `clear` takes ownership when that
  program has died. `clear` removes `pixel.work` and `pixel.result` too.
- `tools/install-hooks.mjs` (`just hooks`) adds the six hooks to Claude Code's
  `settings.json` and Codex's `hooks.json`, which share one shape, and `PostToolUseFailure`
  and `PostToolUse` to Claude Code's only (`CLAUDE_EVENTS`): Codex has no failure event, and
  how its `PostToolUse` acts is unmeasured. It appends, because
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

- Rows follow `agents()` in the order given, with a leaving agent's row kept in its place
  while its exit plays. No agents and none leaving: render an empty `div()` so the
  floating block hides.
- A row is a sprite cell and a text column. The sprite cell is 48 px wide: a 36 px sprite
  with 6 px on each side. The dock script leaves exactly that strip showing (`PEEK = 48`).
- `placement()` decides the shape. On the right edge the sprite cell is on the right. On
  the left edge, and docked in a layout block, it is on the left. On the top and bottom
  edges the sprites stand in a row with names under them.
- The layout never changes on hover: the drawer slides, the content stays. Only the
  creatures move: while `placement().hovered` and not `dragging`, every creature turns
  toward the side the drawer opens to, away from its edge: left on the right edge, right
  on the left edge, down on the top edge and up on the bottom edge. Herdr gives no pointer
  position, so they all turn the same way. Docked in a layout block there is no placement
  and they never turn. Each draw reads `hovered`; that Herdr draws the mod again when it
  changes is not measured, and `types/herdr.d.ts` does not say.
- The text column names the agent and shows its status line: the agent's own message
  (`terminals()` entry's `report.msg`) when it has one.
- A working agent's sprite works the way its terminal's `pixel.work` label names, else its
  own way. The drawer passes the label as it is; `spriteElement` decides what counts.
- Status is shown twice: by the sprite, which carries its own motion and status mark, and
  by a theme-colored stripe on the cell's edge side. A blocked agent is the most visible
  thing in the drawer: its cell and row are tinted as well. The sprite draws the only `!`.
- The current agent's row is marked: the pane with the keyboard when it is an agent, else
  Herdr's current agent (`focused().agent`). It is the agent the commands act on.
- Its creature wears a crown, so a closed drawer shows it too: 6 by 2 cells of 3 px, three
  points over a band in the thumbs up's gold, outlined as the stamp is. It stands at the
  box's top, centered, from 0 to 8 px down with its outline, behind the sprite: a creature's
  eyes start 13 px down at the highest (its fourth row), and the sprite draws over it, so it
  covers no part of the creature. It holds still, whatever the creature does or faces. It
  goes while an arrival or an exit hides the sprite, and a leaving agent wears none.
- Click: `run("pane.focus", { pane })`. Right click: `openPicker(address)`.
- A hit in a repository lands on the agents working in it, else on every agent in it. Only
  agents on this computer are watched. Its numbers sit in the sprite cell, so a closed
  drawer shows them. It holds 90 ms, then each number curves 14 px up and 14 px aside
  (`top` eases out while `left` eases in) and fades; it is gone after 1.4 s. A new
  hit on the same agent replaces the last one.
- A hit's size is `hitSize` of its added and removed lines together, so +3 −300 is a crit.
  A tick's numbers are 10 px, a hit's 13 px, a crit's 16 px (five glyphs such as `+1.2k`
  fit the cell), in rows of 12, 15 and 17 px. A 9 px CRIT tag goes over a crit's numbers,
  at the box's top, in the color of its bigger number and outlined as the numbers are; it
  rises 14 px straight up and fades with them. A crit holds 240 ms, not 90, before it moves.
- A hit on an agent within 2.5 s of its last hit adds one to its combo; a later hit starts
  the count at one. From the third hit the cell shows the count: "3 HIT" over "COMBO", 10 px
  and 7 px, in amber (`#f7b521`, as the bees' count) outlined as the numbers are, over the
  creature's feet in the bottom 20 px of the box, drawn beneath the numbers. Each hit draws
  it anew, with the new count. 2.5 s after the last hit it fades over 400 ms, and is gone; a
  hit while it fades starts a new count. Every hit counts, ticks and crits alike. It plays
  through `play`.
- An agent in a watched repository with uncommitted lines has an XP bar: a strip of its own,
  4 px, between the box and the bees' lanes, so a closed drawer shows it and nothing in the
  box covers it. Its cell grows by the strip while the bar shows. The bar is 36 px, as wide
  as the sprite, 3 px tall: a see-through dark track, filled from the left in periwinkle
  (`#8f9bff`, no hit, fire, douse, confetti, combo or status color) by `uncommitted` of its
  repository over `LEVEL_LINES`, and full from there on. A change of the lines slides the
  fill to its new width over 300 ms. Every agent in the repository shows it; an agent in
  none, a remote agent and a ghost show none.
- A commit cashes the bar in on the agents it stamps, when it had lines: the bar holds the
  lines the commit took while the stamp falls, and drains to what is left over 500 ms from
  370 ms, as the stamp lands. A commit that took a level's worth of lines (`LEVEL_LINES`
  or more, from the lines before it less the lines the read after it left; a reword takes
  none) levels up: a `LEVEL UP` in the bar's color, 8 px, outlined as the numbers are, waits unseen 8 px
  low at the box's top, pops up to 2 px from the top at 1.3 s, once the stamp's tool has
  lifted away and only its mark holds (lower right, clear of it), and rises 8 px more as it
  fades over 600 ms from 2.1 s. The cash-in is gone at 2.7 s, and the strip with it when
  nothing is left uncommitted. It plays through `play`; a commit with nothing to cash in
  plays none.
- A commit in a repository stamps the same agents a hit would, in the box over the sprite's
  lower right, so a closed drawer shows it. The tool, 8 by 9 cells of 3 px, is drawn 14 px
  above its spot and unseen, then 30 ms later falls onto the spot over 340 ms, easing in, as
  it shows. The box dips 3 px as it lands. The tool stays down until 900 ms, then rises back
  and fades over 400 ms, the box rises over 500 ms, and the mark shows where it pressed: a
  bold check, 8 by 6 cells in `theme().done`, outlined dark so it reads on any creature. The
  mark holds, fades over 1 s from 2.7 s, and is gone at 3.8 s. Each step is slow enough to
  follow by eye. A new stamp on the same agent replaces the last, with new ids.
- The same commit makes the other agents in the repository clap: those whose folder is in
  it (`agentsOf`) and the stamp does not land on (`agentsIn`), whatever their status. With
  no agent working the stamp lands on all of them, and none claps. A clap is two gloves in
  the box over the sprite, each 3 by 4 cells of 3 px, white with a grey cuff and outlined
  dark, 22 px down the box. They stand 5 px off its middle and `.loop("left")` in to meet
  there and back out, every 240 ms; three gold 2 px sparks around where they meet
  `.loop("opacity")` from 0 to 1 on the same beat, so they flash as the hands meet. No
  timer runs per clap. After three claps, at 720 ms, the gloves fade over 250 ms, and they
  are gone at 1,020 ms. A clap plays with `play` into `claps`, so a new one replaces the
  last, with new ids.
- A move of HEAD that is no commit lands on the same agents a hit or a stamp would, as the
  one-shot for its kind: one entry per kind in `ONE_SHOTS` (its first step, its steps'
  times, how a step draws in the box over the sprite, and `hides` when it draws the
  creature itself, which keeps the sprite unseen while it plays). It plays with `play` into
  `moves`, by address, so a new move on the same agent replaces the last, with new ids, and
  it is forgotten when it ends. A kind without an entry shows nothing yet, and starts no
  timer.
- A checkout's one-shot is a signpost at the box's lower left, clear of a stamp at its lower
  right: a post and a board, 7 by 9 cells of 3 px in the stamp tool's wood, outlined dark.
  It is planted unseen with the board pointing left, the way HEAD came from, and 30 ms
  later fades in over 200 ms. At 700 ms the board turns edge-on, one plank, and at 820 ms it
  points right, the way HEAD went; each frame of the turn is its own layer, swapped over
  60 ms. The sign holds, fades over 600 ms from 2.4 s, and is gone at 3.1 s.
- A reset's one-shot is a rewind. It hides the sprite and draws the creature itself where
  the sprite stands, a face of `faceRects` every 80 ms: front, turned to its left, back,
  turned to its right, three turns, the other way from where it walks; then it is gone at
  960 ms and the sprite is back. Rows 0-3, 4-7 and 8-11 slip sideways each on its own beat
  (`.loop("left")`, ±1, ±2 and ±1 px, 100, 130 and 110 ms), keeping their ids through the
  turn so the slip runs on. A tracking bar, 2 px of translucent white, rolls up and down
  over it, and a `◀◀`, 6 by 5 cells of 2 px in white over a dark shadow, blinks at the
  box's upper left. The sprite's fire and work props go with it for that second.
- A rebase's one-shot is a deck of six cards shuffled in front of the sprite, which stays.
  Each card is 10 by 14 px, a dark edge, a white border and a blue back with a light mark.
  Squared, the deck stands low in the middle of the box, its bottom on the stamp's floor,
  each card 2 px over the one under it; there it overlaps the left of a stamp, which draws
  over it. Dealt unseen, it fades in at 30 ms over 150 ms. At 350 ms it splits: the even
  cards glide 8 px left and the odd ones 8 px right, each half stacked and lifted 3 px,
  over 160 ms. At 600 ms it riffles: each card falls back into the deck over 90 ms, 45 ms
  after the one under it, so the halves take turns. It splits again at 1,000 ms and riffles
  at 1,250 ms, holds, fades over 500 ms from 2.3 s, and is gone at 2.8 s. Each card keeps
  its id through the shuffle, so it glides; a rebase's many reflog lines in one look are
  one move, so one shuffle.
- Bees sit under the sprite's box, and under its XP bar when it shows, never over the creature: in lanes of three, as wide as
  the sprite cell, so a closed drawer shows them. An agent's cell grows by one lane for
  up to three bees and two for more, and has none without bees. With more than six bees
  the sixth place shows a count of the rest. They can't leave the drawer: Herdr clips a
  floating mod to its frame. A bee not seen before is drawn first in the
  middle of the sprite, unseen, and 40 ms later at its place: it flies there over 450 ms.
- A bee drawn the time before and missing from `beesOf` now has left: its helper ended. It
  stays drawn in its place, with its lane, for its exit, under the same id, so it moves
  from there. A bee flies back to the middle of the sprite over 450 ms, easing in, and
  fades over its last 200 ms; it is gone at 500 ms. A sheep hops off to the side, facing the
  way it goes: over 200 ms it leaps 6 px and 7 px aside, easing out, and over the next 200
  ms lands 14 px aside, easing in, as it fades; it is gone at 420 ms. It hops away from the
  edge the drawer is docked on: left on the right edge, right otherwise. It moves 14 px from
  its own place, within its row, which has that much room on the side it hops to: the text
  column on a side edge, or the 14 px tile margin on a top or bottom edge. So it stays
  inside the drawer. Most places land over the next place in the lane; only the place
  nearest that side leaves the cell. Then the bees after it glide up a place.
  A helper that comes back while its bee leaves stops the exit, and its bee flies out again.
- An agent not drawn the time before arrives by a trick, in the box over its sprite. The
  agents of the first draw were there before the drawer, so they get none; an agent that
  leaves and comes back gets one again, and a new seed for the same agent gets none. The
  sprite is unseen until the reveal. A wand, 7 by 7 cells of 3 px, shows over the box's
  upper right, and at 240 ms taps down toward the middle over 180 ms. At 440 ms it fades
  and a puff goes up over the middle: five round clouds in three greys and four plus-sign
  sparkles, gold and lilac. At 760 ms the clouds drift out to twice their distance and the
  sparkles a cell further, all fading over 520 ms, while the sprite fades in over 360 ms.
  It is gone at 1.5 s. Its status line reads "Abracadabra!" until then.
- An agent drawn the time before and gone now leaves by an exit, the trick in reverse. Its
  row stays as it was last drawn, a ghost, in its place, with the seed it was drawn with,
  so its creature stays the same though its terminal and label are gone. A ghost shows
  only its creature, the exit and its bees leaving: no hit, combo, XP bar, stamp, clap or arrival,
  and it is out of the status changes, the clocks and the current agent. Its bees all leave
  at once, each by its own exit, so they are gone before the puff clears; they stay drawn,
  gone, until the row goes, so the row keeps its height. It does nothing when clicked or right
  clicked. The wand shows over the creature and taps at 240 ms; at 440 ms it fades, the
  puff goes up, and the sprite fades out under it over 360 ms; at 760 ms the puff clears
  over 520 ms to an empty cell. The row is gone at 1.3 s. Its status line reads "Poof!"
  until then. An agent leaving mid-arrival stops arriving. One that comes back mid-exit
  stops leaving and arrives again, in one row.
- A new bee comes out of the same puff at 2 px cells over the middle of the sprite. It
  clears as the bee flies out, 60 ms later, and is gone at 800 ms. Bees of the first draw
  get none. Stamps, claps, tricks, exits, puffs and moves' one-shots share one timeline helper
  (`play`): each step is one render, and a new one on the same agent replaces the last, with
  new ids. A status change's one-shot, its turn, plays through it too, and so does a bee's
  exit, keyed by the bee's id rather than its agent's, since several can leave at once.
- Each status change plays the first of `TURNS` whose `from` and `to` match it, on the draw
  that finds it, and the sprite draws the turn until its last step. A change ends the turn
  an earlier change started on that agent, even when it plays none itself: going to rest
  mid-stretch rests at once, and the ended turn's steps wake nothing. An agent that turns
  blocked jolts: `jump` at once, `land` at 200 ms, `catch` at 400 ms, and the blocked look,
  fire and badge, at 900 ms. Its cell is tinted from the jump on. A block again mid-douse
  ends the douse and jolts. The first draw and a new agent that is blocked get no jolt:
  they burn under the badge at once. A blocked agent that
  goes on is doused: `pour` at once, `splash` at 40 ms, `steam` at 700 ms, and back to work
  at 1.8 s. A blocked agent that turns done or idle, the first draw and a new agent get no
  douse. A working agent that turns done cheers: `pop` at once, `burst` at 40 ms, `fall` at
  600 ms, and the done pose at 1.6 s. It cheers once per finish: a redraw keeps the same
  cheer, and going back to work ends it. A blocked or idle agent that turns done, an agent
  done on the first draw and a new agent that is done get no cheer.
  An idle or done agent that starts work stretches: `yawn` at once, `stretch` at
  500 ms, `wake` at 1 s, and to work at 1.5 s. The first draw and a new agent at work get no
  stretch.
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
- Each draw also finds the results the agents' hooks reported since the draw before
  (`reports`, `{ address, kind }`): a `pixel.result` value an agent did not have then. Only
  agents drawn both times report, as with status changes, and a label taken away is no
  result. A `failed` result makes the sprite cough black smoke, over the box at 2 px
  cells: the puff's clouds, darkest in front and lighter behind so it reads on any theme,
  gather over the face (18 px down the cell) and the sprite lurches 2 px down. At 250 ms the
  clouds drift out and up 3 cells, to the cell's top, and fade over 520 ms while the sprite
  comes back up; it is gone at 1 s. It plays through `play`, and moves the sprite, not the
  box, whose `top` is a stamp's.
- A `tests-passed` or `tests-failed` result plays a verdict (`verdicts`), one per agent: the
  next replaces it. While it shows, the sprite is drawn with `tube: false`, so a testing
  creature holds no tube of its own. Both are in 3 px cells with the stamp's dark outline,
  and stay in the cell through every step. Passed: a gold thumbs up, 7 by 7 cells, its right
  edge at the tube's (42 px), shows from 6 px low and rises to 16 px down the cell at 30 ms,
  holds, and fades over 600 ms from 1.4 s; gone at 2 s. Failed: the tube, glass over the
  theme's accent, drawn first just where the sprite held it (36..42 by 19..40 px). It tips
  left at 80 ms, lies on its side along the cell's floor at 180 ms, and at 480 ms its liquid
  has run out of its mouth into a puddle on the left. It fades over 600 ms from 1.7 s; gone
  at 2.3 s. Each frame of the fall is its own layer, shown in its step, as the signpost's
  turn is. Failed tests make no smoke.
- Each draw reads the local clock and gives every sprite the part of the day (`daytimeOf`
  of the hour). Sprite motion has no timers, so the drawer looks at the clock each minute,
  from `init`, and redraws when the part of the day differs from the last draw's. The draw
  reads the clock itself, so a late look still draws the right prop.
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
