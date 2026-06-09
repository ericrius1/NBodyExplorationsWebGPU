// Custom debug inspector for the raw-WebGPU engine, styled after the
// three.js examples inspector: a bottom-right timing tab that expands a
// bottom-docked panel upward from the same anchor (Performance / Memory).

export interface MemoryRow {
  name: string;
  count: number | null;
  bytes: number;
}

export interface InspectorCaps {
  timestamp: boolean;
  jsHeap: boolean;
}

export interface InspectorFrame {
  fps: number;
  frameMs: number;
  solverLabel: string;
  solverCpuMs: number;
  computeGpuMs: number;
  particlesCpuMs: number;
  overlayCpuMs: number;
  jsHeapMB: number;
  particles: number;
  nodes: number;
  getMemory: () => MemoryRow[];
}

export interface Inspector {
  update: (f: InspectorFrame) => void;
  setVisible: (v: boolean) => void;
}

const PANEL_H = 320;

const CSS = `
#nb-inspector { font: 12px/1.5 ui-monospace, Menlo, monospace; color: #cfd3dc; }
#nb-inspector * { box-sizing: border-box; }
#nb-insp-dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10000;
  display: flex; flex-direction: column; align-items: flex-end;
  pointer-events: none;
}
#nb-insp-toggle {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px; margin: 0 8px 8px 0;
  background: rgba(30,30,36,.85); border: 1px solid #4a4a5a55; border-radius: 8px;
  cursor: pointer; backdrop-filter: blur(8px); user-select: none; color: #cfd3dc;
  pointer-events: auto; flex: none;
  transition: margin 0.22s ease, border-radius 0.22s ease, border-color 0.22s ease, background 0.15s;
}
#nb-insp-toggle:hover { background: rgba(48,48,58,.9); color: #fff; }
#nb-insp-toggle svg {
  display: block; flex: none;
  transition: transform 0.22s ease;
}
#nb-insp-dock.open #nb-insp-toggle {
  margin-bottom: 0; border-radius: 8px 8px 0 0; border-bottom-color: transparent;
  background: rgba(24,24,30,.95);
}
#nb-insp-dock.open #nb-insp-toggle .nb-insp-expand-icon { transform: rotate(45deg); }
#nb-insp-panel {
  width: 100%; max-height: 0; overflow: hidden; flex: none;
  display: flex; flex-direction: column;
  background: rgba(24,24,30,.95); backdrop-filter: blur(10px);
  border-top: 1px solid #4a4a5a55;
  pointer-events: none; opacity: 0;
  transition: max-height 0.25s ease, opacity 0.2s ease;
}
#nb-insp-dock.open #nb-insp-panel {
  max-height: ${PANEL_H}px; pointer-events: auto; opacity: 1;
}
.nb-tabs { display: flex; align-items: center; padding: 0 10px; border-bottom: 1px solid #4a4a5a33; flex: none; }
.nb-tab { padding: 9px 14px; cursor: pointer; color: #9aa0ae; border-bottom: 2px solid transparent; font-weight: 600; }
.nb-tab:hover { color: #fff; }
.nb-tab.active { color: #fff; border-bottom-color: #4f9eff; }
.nb-spacer { flex: 1; }
.nb-collapse { cursor: pointer; padding: 2px 12px; color: #9aa0ae; border: 1px solid #4a4a5a55; border-radius: 6px; }
.nb-collapse:hover { color: #fff; background: rgba(48,48,58,.9); }
.nb-content { flex: 1; overflow-y: auto; padding-bottom: 10px; }
.nb-cols, .nb-row, .nb-section { display: flex; align-items: center; padding: 3px 18px; }
.nb-cols { color: #9aa0ae; padding-top: 8px; }
.nb-section { background: rgba(38,56,86,.5); color: #4f9eff; font-weight: 600; margin-top: 8px; }
.nb-name { flex: 1; min-width: 0; }
.nb-num { width: 110px; text-align: right; flex: none; font-variant-numeric: tabular-nums; }
.nb-row .nb-name { color: #cfd3dc; }
.nb-row.nb-misc { background: rgba(46,86,56,.3); }
.nb-row.nb-total .nb-name, .nb-row.nb-total .nb-num { color: #fff; font-weight: 600; }
.nb-graph {
  display: block; width: calc(100% - 36px); height: 110px; margin: 8px 18px 0;
  background: rgba(255,255,255,.03); border: 1px solid #4a4a5a33; border-radius: 4px;
}
`;

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function row(name: string, cols: number, extra = ""): { root: HTMLElement; cells: HTMLElement[] } {
  const root = el("div", `nb-row${extra ? ` ${extra}` : ""}`);
  root.appendChild(el("span", "nb-name", name));
  const cells: HTMLElement[] = [];
  for (let i = 0; i < cols; i++) {
    const c = el("span", "nb-num", "–");
    cells.push(c);
    root.appendChild(c);
  }
  return { root, cells };
}

function header(cols: string[]): HTMLElement {
  const root = el("div", "nb-cols");
  root.appendChild(el("span", "nb-name", "Name"));
  for (const c of cols) root.appendChild(el("span", "nb-num", c));
  return root;
}

function section(name: string): { root: HTMLElement; value: HTMLElement } {
  const root = el("div", "nb-section");
  root.appendChild(el("span", "nb-name", name));
  const value = el("span", "nb-num", "");
  value.style.width = "auto";
  root.appendChild(value);
  return { root, value };
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const EXPAND_ICON =
  '<svg class="nb-insp-expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 5v14"/><path d="M5 12h14"/></svg>';

const GRAPH_SAMPLES = 300;

export function buildInspector(caps: InspectorCaps): Inspector {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const shell = el("div", "");
  shell.id = "nb-inspector";

  const dock = el("div", "");
  dock.id = "nb-insp-dock";

  const toggle = el("div", "");
  toggle.id = "nb-insp-toggle";
  const toggleStats = el("span", "", "– ms");
  toggle.appendChild(toggleStats);
  toggle.insertAdjacentHTML("beforeend", EXPAND_ICON);
  toggle.title = "Expand performance panel";

  const panel = el("div", "");
  panel.id = "nb-insp-panel";

  const tabBar = el("div", "nb-tabs");
  const perfTab = el("div", "nb-tab active", "Performance");
  const memTab = el("div", "nb-tab", "Memory");
  const collapse = el("div", "nb-collapse", "–");
  tabBar.append(perfTab, memTab, el("div", "nb-spacer"), collapse);

  // Performance tab
  const perfView = el("div", "nb-content");
  perfView.appendChild(header(["CPU", "GPU", "Total"]));
  const graphSection = section("Graph Stats");
  perfView.appendChild(graphSection.root);
  const graph = document.createElement("canvas");
  graph.className = "nb-graph";
  perfView.appendChild(graph);
  const frameSection = section("Frame Stats");
  perfView.appendChild(frameSection.root);
  const solverRow = row("solver", 3);
  const particlesRow = row("Particles", 3);
  const overlayRow = row("Debug overlay", 3);
  const miscRow = row("Miscellaneous & Idle", 3, "nb-misc");
  perfView.append(solverRow.root, particlesRow.root, overlayRow.root, miscRow.root);

  // Memory tab
  const memView = el("div", "nb-content");
  memView.style.display = "none";
  memView.appendChild(header(["Count", "Size"]));
  const gpuSection = section("GPU Buffers");
  memView.appendChild(gpuSection.root);
  const memRowsHost = el("div", "");
  memView.appendChild(memRowsHost);
  const simSection = section("Simulation");
  memView.appendChild(simSection.root);
  const particlesMemRow = row("particles", 2);
  const nodesMemRow = row("BH nodes", 2);
  memView.append(particlesMemRow.root, nodesMemRow.root);
  let heapRow: ReturnType<typeof row> | null = null;
  if (caps.jsHeap) {
    const heapSection = section("JS Heap");
    memView.appendChild(heapSection.root);
    heapRow = row("used", 2);
    memView.appendChild(heapRow.root);
  }

  panel.append(tabBar, perfView, memView);
  panel.style.height = `${PANEL_H}px`;
  dock.append(toggle, panel);
  shell.append(dock);
  document.body.appendChild(shell);

  const isOpen = (): boolean => dock.classList.contains("open");
  const setOpen = (open: boolean): void => {
    dock.classList.toggle("open", open);
    toggle.title = open ? "Collapse performance panel" : "Expand performance panel";
  };
  setOpen(true);

  const selectTab = (perf: boolean): void => {
    perfTab.classList.toggle("active", perf);
    memTab.classList.toggle("active", !perf);
    perfView.style.display = perf ? "" : "none";
    memView.style.display = perf ? "none" : "";
  };
  perfTab.addEventListener("click", () => selectTab(true));
  memTab.addEventListener("click", () => selectTab(false));
  toggle.addEventListener("click", () => setOpen(!isOpen()));
  collapse.addEventListener("click", () => setOpen(false));

  const fpsHistory = new Float32Array(GRAPH_SAMPLES);
  let fpsCount = 0;

  const drawGraph = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = graph.clientWidth * dpr;
    const h = graph.clientHeight * dpr;
    if (w === 0 || h === 0) return;
    if (graph.width !== w || graph.height !== h) {
      graph.width = w;
      graph.height = h;
    }
    const g = graph.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const n = Math.min(fpsCount, GRAPH_SAMPLES);
    if (n < 2) return;
    let max = 60;
    for (let i = 0; i < n; i++) max = Math.max(max, fpsHistory[i]);
    max *= 1.1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ((GRAPH_SAMPLES - n + i) / (GRAPH_SAMPLES - 1)) * w;
      const y = h - (fpsHistory[i] / max) * (h - 6 * dpr) - 3 * dpr;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "#4f9eff";
    g.lineWidth = dpr;
    g.stroke();
    g.lineTo(w, h);
    g.lineTo(((GRAPH_SAMPLES - n) / (GRAPH_SAMPLES - 1)) * w, h);
    g.closePath();
    g.fillStyle = "rgba(79,158,255,.15)";
    g.fill();
  };

  const ms = (v: number): string => `${v.toFixed(2)}`;
  const computeMs = (f: InspectorFrame): number | null =>
    caps.timestamp ? f.computeGpuMs : null;
  const formatCompute = (f: InspectorFrame): string => {
    const gpu = computeMs(f);
    return gpu === null ? "–" : ms(gpu);
  };
  const formatSummary = (f: InspectorFrame): string =>
    `${f.fps.toFixed(0)} FPS  ·  ${ms(f.frameMs)} ms  ·  ${formatCompute(f)} ms compute`;
  const setPerfRow = (r: { cells: HTMLElement[] }, cpu: number, gpu: number | null): void => {
    r.cells[0].textContent = ms(cpu);
    r.cells[1].textContent = gpu === null ? "–" : ms(gpu);
    r.cells[2].textContent = ms(cpu + (gpu ?? 0));
  };

  let lastText = 0;
  let lastGraphPush = 0;
  let visible = true;

  const update = (f: InspectorFrame): void => {
    if (!visible) return;
    const now = performance.now();

    if (now - lastGraphPush > 50) {
      lastGraphPush = now;
      fpsHistory.copyWithin(0, 1);
      fpsHistory[GRAPH_SAMPLES - 1] = f.fps;
      fpsCount++;
      if (isOpen()) drawGraph();
    }

    if (now - lastText < 250) return;
    lastText = now;

    toggleStats.textContent = `${ms(f.frameMs)} ms  ·  ${formatCompute(f)} ms cmp`;
    if (!isOpen()) return;

    graphSection.value.textContent = formatSummary(f);

    const gpu = caps.timestamp ? f.computeGpuMs : null;
    solverRow.cells[0].parentElement!.querySelector(".nb-name")!.textContent = f.solverLabel;
    setPerfRow(solverRow, f.solverCpuMs, gpu);
    setPerfRow(particlesRow, f.particlesCpuMs, null);
    setPerfRow(overlayRow, f.overlayCpuMs, null);
    const used = f.solverCpuMs + f.particlesCpuMs + f.overlayCpuMs + (gpu ?? 0);
    const misc = Math.max(0, f.frameMs - used);
    miscRow.cells[0].textContent = ms(misc);
    miscRow.cells[2].textContent = ms(misc);
    frameSection.value.textContent =
      `${formatSummary(f)}  ·  CPU ${ms(f.solverCpuMs + f.particlesCpuMs + f.overlayCpuMs)}  ·  GPU ${gpu === null ? "–" : ms(gpu)}`;

    if (memView.style.display !== "none") {
      const rows = f.getMemory();
      memRowsHost.replaceChildren();
      let total = 0;
      for (const m of rows) {
        total += m.bytes;
        const r = row(m.name, 2);
        r.cells[0].textContent = m.count === null ? "–" : m.count.toLocaleString();
        r.cells[1].textContent = fmtBytes(m.bytes);
        memRowsHost.appendChild(r.root);
      }
      gpuSection.value.textContent = fmtBytes(total);
      particlesMemRow.cells[0].textContent = f.particles.toLocaleString();
      particlesMemRow.cells[1].textContent = fmtBytes(f.particles * 20);
      nodesMemRow.cells[0].textContent = f.nodes.toLocaleString();
      nodesMemRow.cells[1].textContent = "–";
      if (heapRow) {
        heapRow.cells[0].textContent = "–";
        heapRow.cells[1].textContent = `${f.jsHeapMB.toFixed(0)} MB`;
      }
    }
  };

  return {
    update,
    setVisible: (v: boolean): void => {
      visible = v;
      shell.style.display = v ? "" : "none";
      if (!v) setOpen(false);
    },
  };
}
