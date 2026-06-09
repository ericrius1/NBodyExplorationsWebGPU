import { initGpu } from "./gpu/context";
import { Engine } from "./engine";
import { config } from "./state";
import { buildPane } from "./ui/pane";
import { hasJsHeap } from "./ui/metrics";
import { installInput } from "./ui/input";

async function start(): Promise<void> {
  const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
  const ctx = await initGpu(canvas);
  if (!ctx) {
    (document.getElementById("no-webgpu") as HTMLElement).style.display = "grid";
    return;
  }

  const engine = new Engine(ctx);
  const pane = buildPane(engine, engine.metrics, { timestamp: ctx.hasTimestamp, jsHeap: hasJsHeap });
  engine.setRefreshCallback(pane.refresh);
  pane.setVisible(engine.debug);

  installInput(canvas, engine.camera, {
    toggleDebug: () => {
      engine.debug = !engine.debug;
      pane.setVisible(engine.debug);
    },
    toggleMode: () => {
      config.mode = config.mode === "naive" ? "barnesHut" : "naive";
      pane.refresh();
    },
    reset: () => engine.rebuild(),
  });

  const loop = (): void => {
    engine.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
