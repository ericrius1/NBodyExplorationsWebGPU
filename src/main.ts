import { initGpu } from "./gpu/context";
import { collapseInspector, setInspectorVisible } from "./gpu/inspectorHooks";
import { Engine } from "./engine";
import { config } from "./state";
import { buildPane } from "./ui/pane";
import { hasJsHeap } from "./ui/metrics";
import { installInput } from "./ui/input";
import { Inspector } from "three/addons/inspector/Inspector.js";

async function start(): Promise<void> {
  const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
  const ctx = await initGpu(canvas, (renderer) => {
    renderer.inspector = new Inspector();
  });
  if (!ctx) {
    (document.getElementById("no-webgpu") as HTMLElement).style.display = "grid";
    return;
  }

  collapseInspector();

  const engine = new Engine(ctx);
  const pane = buildPane(engine, engine.metrics, { timestamp: ctx.hasTimestamp, jsHeap: hasJsHeap });
  engine.setRefreshCallback(pane.refresh);

  const syncDebug = (): void => {
    pane.setVisible(engine.debug);
    setInspectorVisible(ctx.renderer, engine.debug);
  };
  syncDebug();

  installInput(canvas, engine.camera, {
    toggleDebug: () => {
      engine.debug = !engine.debug;
      syncDebug();
    },
    toggleMode: () => {
      config.mode = config.mode === "naive" ? "barnesHut" : "naive";
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
  }

  ctx.renderer.setAnimationLoop(() => {
    engine.frame();
  });
}

void start();
