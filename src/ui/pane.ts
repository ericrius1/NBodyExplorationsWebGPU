import { Pane } from "tweakpane";
import { config, CONTROLS } from "../state";
import type { Metrics } from "./metrics";

export interface PaneCaps {
  timestamp: boolean;
  jsHeap: boolean;
}

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
  el.style.cssText =
    `position:fixed;top:8px;${side}:8px;width:256px;z-index:10;` +
    "max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain";
  document.body.appendChild(el);
  return el;
}

const HELP_ROWS: [string, string][] = [
  ["/", "toggle debug panel"],
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

export function buildPane(host: PaneHost, metrics: Metrics, caps: PaneCaps): DebugPane {
  const controlsHost = paneContainer("right");
  const controls = new Pane({ title: "n-body · controls  ( / )", container: controlsHost });
  const folders: Record<string, ReturnType<Pane["addFolder"]>> = {};

  for (const c of CONTROLS) {
    const parent = c.folder ? (folders[c.folder] ??= controls.addFolder({ title: c.folder })) : controls;
    const b = parent.addBinding(config, c.key, c.opts ?? {});
    if (c.rebuild === "last") b.on("change", (e) => { if (e.last) host.rebuild(); });
    if (c.rebuild === "always") b.on("change", () => host.rebuild());
  }

  const metricsHost = paneContainer("left");
  const met = new Pane({ title: "metrics", container: metricsHost });
  met.addBinding(metrics, "fps", { readonly: true, format: (v: number) => v.toFixed(0) });
  met.addBinding(metrics, "fps", { readonly: true, view: "graph", min: 0, max: 165, label: " " });
  met.addBinding(metrics, "frameMs", { readonly: true, format: (v: number) => `${v.toFixed(2)} ms`, label: "frame" });
  met.addBinding(metrics, "frameMs", { readonly: true, view: "graph", min: 0, max: 33, label: " " });
  if (caps.timestamp) {
    met.addBinding(metrics, "computeMs", { readonly: true, format: (v: number) => `${v.toFixed(3)} ms`, label: "compute" });
    met.addBinding(metrics, "computeMs", { readonly: true, view: "graph", min: 0, max: 16, label: " " });
  }
  met.addBinding(metrics, "nodes", { readonly: true, format: (v: number) => v.toFixed(0), label: "bh nodes" });
  met.addBinding(metrics, "bufferMB", { readonly: true, format: (v: number) => `${v.toFixed(1)} MB`, label: "gpu buffers" });
  if (caps.jsHeap) {
    met.addBinding(metrics, "jsHeapMB", { readonly: true, format: (v: number) => `${v.toFixed(0)} MB`, label: "js heap" });
  }

  const help = buildHelp();
  help.setPaused(false);

  return {
    refresh: () => {
      controls.refresh();
      met.refresh();
    },
    setVisible: (v: boolean) => {
      const d = v ? "" : "none";
      controlsHost.style.display = d;
      metricsHost.style.display = d;
      help.el.style.display = v ? "" : "none";
    },
    setPaused: help.setPaused,
  };
}
