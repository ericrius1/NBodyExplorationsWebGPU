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
}

function leftContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;top:8px;left:8px;width:256px;z-index:10";
  document.body.appendChild(el);
  return el;
}

export function buildPane(host: PaneHost, metrics: Metrics, caps: PaneCaps): DebugPane {
  const controls = new Pane({ title: "n-body · controls  ( / )" });
  const folders: Record<string, ReturnType<Pane["addFolder"]>> = {};

  for (const c of CONTROLS) {
    const parent = c.folder ? (folders[c.folder] ??= controls.addFolder({ title: c.folder })) : controls;
    const b = parent.addBinding(config, c.key, c.opts ?? {});
    if (c.rebuild === "last") b.on("change", (e) => { if (e.last) host.rebuild(); });
    if (c.rebuild === "always") b.on("change", () => host.rebuild());
  }

  const met = new Pane({ title: "metrics", container: leftContainer() });
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

  return {
    refresh: () => {
      controls.refresh();
      met.refresh();
    },
    setVisible: (v: boolean) => {
      const d = v ? "" : "none";
      (controls.element.style as CSSStyleDeclaration).display = d;
      (met.element.style as CSSStyleDeclaration).display = d;
    },
  };
}
