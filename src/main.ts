import { initGpu } from "./gpu/context";
import { Engine } from "./engine";
import { config } from "./state";
import { buildPane } from "./ui/pane";
import { hasJsHeap } from "./ui/metrics";
import { buildInspector } from "./ui/inspector";
import { installInput } from "./ui/input";

async function start(): Promise<void> {
  const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
  const ctx = await initGpu(canvas);
  if (!ctx) {
    (document.getElementById("no-webgpu") as HTMLElement).style.display = "grid";
    return;
  }

  const engine = new Engine(ctx);
  const pane = buildPane(engine);
  engine.setRefreshCallback(pane.refresh);
  const inspector = buildInspector({ timestamp: ctx.hasTimestamp, jsHeap: hasJsHeap });

  const syncDebug = (): void => {
    pane.setVisible(engine.debug);
    inspector.setVisible(engine.debug);
  };
  syncDebug();

  installInput(canvas, engine.camera, {
    toggleDebug: () => {
      engine.debug = !engine.debug;
      syncDebug();
    },
    toggleOverlays: () => {
      if (!engine.debug) return;
      const on = config.showQuadtree || config.showProbe;
      config.showQuadtree = !on;
      config.showProbe = !on;
      pane.refresh();
    },
    toggleMode: () => {
      config.mode = config.mode === "naive" ? "barnesHut" : config.mode === "barnesHut" ? "bhGpu" : "naive";
      pane.refresh();
    },
    togglePause: () => {
      engine.paused = !engine.paused;
      pane.setPaused(engine.paused);
    },
    reset: () => engine.rebuild(),
  });

  if (import.meta.env.DEV) {
    (window as unknown as { engine: Engine }).engine = engine;
    (window as unknown as { simConfig: typeof config }).simConfig = config;
  }

  const m = engine.metrics;
  ctx.renderer.setAnimationLoop(() => {
    engine.frame();
    if (engine.debug) {
      inspector.update({
        fps: m.fps,
        frameMs: m.frameMs,
        solverLabel: engine.solverLabel(),
        solverCpuMs: m.solverCpuMs,
        computeGpuMs: m.computeMs,
        particlesCpuMs: m.particlesCpuMs,
        overlayCpuMs: m.overlayCpuMs,
        jsHeapMB: m.jsHeapMB,
        particles: engine.particleCount,
        nodes: m.nodes,
        getMemory: () => engine.memoryRows(),
      });
    }
  });
}

void start();
