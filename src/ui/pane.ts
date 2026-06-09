import { Pane } from "tweakpane";
import { config, CONTROLS } from "../state";

export interface PaneHost {
  rebuild: () => void;
}

export interface DebugPane {
  refresh: () => void;
  setVisible: (v: boolean) => void;
  setPaused: (v: boolean) => void;
}

function paneContainer(side: "left" | "right"): HTMLElement {
  const el = document.createElement("div");
  const top = side === "right" ? "58px" : "8px";
  el.style.cssText =
    `position:fixed;top:${top};${side}:8px;width:256px;z-index:10;` +
    "max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain";
  document.body.appendChild(el);
  return el;
}

const HELP_ROWS: [string, string][] = [
  ["/", "toggle debug + inspector"],
  ["o", "toggle overlays (debug)"],
  ["m", "switch solver"],
  ["p", "pause / resume"],
  ["r", "re-seed particles"],
  ["drag", "pan"],
  ["wheel", "zoom to cursor"],
];

function buildHelp(): { el: HTMLElement; setPaused: (v: boolean) => void } {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;bottom:8px;left:8px;z-index:10;padding:8px 10px;border-radius:6px;" +
    "background:rgba(0,0,0,0.6);color:#cfd3dc;font:11px/1.6 ui-monospace,monospace;" +
    "pointer-events:none;user-select:none";
  const status = document.createElement("div");
  status.style.cssText = "color:#7fff9f;margin-bottom:4px;min-height:1.6em";
  el.appendChild(status);
  for (const [key, action] of HELP_ROWS) {
    const row = document.createElement("div");
    const k = document.createElement("span");
    k.textContent = key;
    k.style.cssText = "display:inline-block;min-width:42px;color:#fff;font-weight:600";
    const a = document.createElement("span");
    a.textContent = action;
    row.appendChild(k);
    row.appendChild(a);
    el.appendChild(row);
  }
  document.body.appendChild(el);
  return {
    el,
    setPaused: (v: boolean) => {
      status.textContent = v ? "❚❚ paused" : "▶ running";
      status.style.color = v ? "#ffcf5f" : "#7fff9f";
    },
  };
}

export function buildPane(host: PaneHost): DebugPane {
  const controlsHost = paneContainer("right");
  const controls = new Pane({ title: "n-body · controls  ( / )", container: controlsHost });
  const folders: Record<string, ReturnType<Pane["addFolder"]>> = {};

  for (const c of CONTROLS) {
    const parent = c.folder ? (folders[c.folder] ??= controls.addFolder({ title: c.folder })) : controls;
    const b = parent.addBinding(config, c.key, c.opts ?? {});
    if (c.rebuild === "last") b.on("change", (e) => { if (e.last) host.rebuild(); });
    if (c.rebuild === "always") b.on("change", () => host.rebuild());
  }

  const help = buildHelp();
  help.setPaused(false);

  return {
    refresh: () => {
      controls.refresh();
    },
    setVisible: (v: boolean) => {
      controlsHost.style.display = v ? "" : "none";
      help.el.style.display = v ? "" : "none";
    },
    setPaused: help.setPaused,
  };
}
