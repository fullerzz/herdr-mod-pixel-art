// A stand-in for the `herdr` module: live data comes from `mock.state`, and everything a
// mod asks Herdr to do is recorded in `mock.calls`. `hc label` really edits the terminals'
// labels, so a test can follow a choice from the click to the next render.

const blank = () => ({
  agents: [],
  terminals: [],
  panes: [],
  spaces: [],
  machines: [],
  focused: null,
  placement: null,
  props: {},
  shared: {},
  layout: null,
});

const pending = [];
const queued = [];

export const mock = {
  state: blank(),
  /** Every recorded request: { fn, args }. */
  calls: [],
  /** Fresh state (with overrides) and no recorded calls. */
  reset(overrides = {}) {
    mock.state = { ...blank(), ...overrides };
    mock.calls.length = 0;
    pending.length = 0;
    queued.length = 0;
  },
  /** The recorded calls to one function, as argument lists. */
  of: (fn) => mock.calls.filter((call) => call.fn === fn).map((call) => call.args),
  /** Delivers a key command (`pixel-party.<command>`) to `nextCommand()`. */
  send(command) {
    const waiter = pending.shift();
    if (waiter) waiter(command);
    else queued.push(command);
  },
  /** An agent and its terminal record, as `agents()` and `terminals()` give them. */
  agent(address, fields = {}) {
    const agent = {
      address,
      pane: `p-${address}`,
      space: "sp1",
      space_name: "repo",
      tab: "tb1",
      tab_index: 0,
      tab_name: "1",
      status: "idle",
      app: "claude-code",
      program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, tile: null, color: null, shell: false, agent: true },
      title: `agent ${address}`,
      seq: 1,
      pinned: false,
      focused: false,
      ...fields,
    };
    mock.state.agents.push(agent);
    mock.state.terminals.push({ address, labels: {}, state: "live", status: agent.status, report: { app: agent.app, msg: "", state: agent.status }, parent: null });
    return agent;
  },
};

const record = (fn, args, result = null) => {
  mock.calls.push({ fn, args });
  return result;
};
const recorder = (fn, result = null) => (...args) => record(fn, args, typeof result === "function" ? result(...args) : result);
const ok = { code: 0, stdout: "", stderr: "" };

// ---- live data ----
export const agents = () => mock.state.agents;
export const terminals = () => mock.state.terminals;
export const panes = () => mock.state.panes;
export const spaces = () => mock.state.spaces;
export const machines = () => mock.state.machines;
export const focused = () => mock.state.focused;
export const placement = () => mock.state.placement;
export const props = () => mock.state.props;
export const layout = () => mock.state.layout;
export const layouts = () => ["main"];
export const settings = () => ({ dark: true, zoom: 1 });
export const window = () => ({ platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false, active: true });
export const keys = () => [];
export const commands = () => [];
export const fonts = () => [];
export const themes = () => [];
export const updates = () => null;
export const telemetry = () => null;
export const home = () => "/home/test";
export const appHome = () => "/home/test/.config/herdr-app";

// Every theme color by name, each a different valid hex, so a test can tell them apart.
const colorOf = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `#${(h & 0xffffff).toString(16).padStart(6, "0")}`;
};
export const theme = () => new Proxy({}, { get: (_t, name) => (typeof name === "string" ? colorOf(name) : undefined) });

export const shared = (key) => mock.state.shared[key];
export const setShared = (key, value) => {
  mock.state.shared[key] = value;
  return record("setShared", [key, value]);
};

// ---- actions ----
export const run = recorder("run");
export const notify = recorder("notify", "n1");
export const openOverlay = recorder("openOverlay", "ov1");
export const closeOverlay = recorder("closeOverlay");
export const setAgentOrder = recorder("setAgentOrder");
export const playSound = recorder("playSound");
export const presentUpdateNotes = recorder("presentUpdateNotes");
export const exec = recorder("exec", () => Promise.resolve(ok));
export const knownAgents = recorder("knownAgents", () => Promise.resolve([]));
export const pickFolder = recorder("pickFolder", () => Promise.resolve(null));
export const readTextFile = recorder("readTextFile", () => Promise.resolve(null));
export const writeTextFile = recorder("writeTextFile", () => Promise.resolve(null));
export const watchFolder = recorder("watchFolder", () => new Promise(() => {}));
export const feedbackPreview = recorder("feedbackPreview");
export const feedbackPasteImage = recorder("feedbackPasteImage");
export const feedbackPickImages = recorder("feedbackPickImages", () => Promise.resolve([]));
export const feedbackAttachImages = recorder("feedbackAttachImages", []);
export const feedbackClearImages = recorder("feedbackClearImages");
export const sendFeedback = recorder("sendFeedback", () => Promise.resolve(null));

/** `hc label <terminal> k=v...` edits the terminal's labels like the core (`k=` removes). */
export function hc(args) {
  record("hc", [args]);
  if (args[0] !== "label") return Promise.resolve(ok);
  const terminal = mock.state.terminals.find((t) => t.address === args[1]);
  if (!terminal) return Promise.resolve({ code: 3, stdout: "", stderr: "not_found" });
  const labels = { ...terminal.labels };
  for (const pair of args.slice(2)) {
    const at = pair.indexOf("=");
    const [key, value] = [pair.slice(0, at), pair.slice(at + 1)];
    if (value === "") delete labels[key];
    else labels[key] = value;
  }
  // A new object, as live data is: nothing may rely on mutating what `terminals()` gave.
  mock.state.terminals = mock.state.terminals.map((t) => (t === terminal ? { ...t, labels } : t));
  return Promise.resolve(ok);
}

export function nextCommand() {
  if (queued.length) return Promise.resolve(queued.shift());
  return new Promise((resolve) => pending.push(resolve));
}
