export class Metrics {
  fps = 0;
  frameMs = 0;
  computeMs = 0;
  solverCpuMs = 0;
  particlesCpuMs = 0;
  overlayCpuMs = 0;
  nodes = 0;
  bufferMB = 0;
  jsHeapMB = 0;

  private last = performance.now();
  private emaFrame = 16;

  tick(): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.emaFrame += (dt - this.emaFrame) * 0.1;
    this.frameMs = this.emaFrame;
    this.fps = 1000 / this.emaFrame;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) {
      this.jsHeapMB = mem.usedJSHeapSize / (1024 * 1024);
    }
  }
}

export const hasJsHeap = !!(performance as unknown as { memory?: unknown }).memory;
