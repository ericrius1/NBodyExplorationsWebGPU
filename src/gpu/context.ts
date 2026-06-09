import { WebGPURenderer } from "three/webgpu";

interface WebGpuBackend {
  isWebGPUBackend: boolean;
  device: GPUDevice;
  context: GPUCanvasContext;
}

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
  hasTimestamp: boolean;
  renderer: WebGPURenderer;
}

export async function initGpu(
  canvas: HTMLCanvasElement,
  setup?: (renderer: WebGPURenderer) => void,
): Promise<GpuContext | null> {
  if (!navigator.gpu) {
    return null;
  }

  const renderer = new WebGPURenderer({ canvas, antialias: false });
  setup?.(renderer);
  try {
    await renderer.init();
  } catch {
    return null;
  }

  const backend = renderer.backend as unknown as WebGpuBackend;
  if (!backend.isWebGPUBackend) {
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), false);

  return {
    device: backend.device,
    context: backend.context,
    canvas,
    format: navigator.gpu.getPreferredCanvasFormat(),
    hasTimestamp: renderer.hasFeature("timestamp-query"),
    renderer,
  };
}

export function resizeCanvas(ctx: GpuContext): { width: number; height: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(1, ctx.canvas.clientWidth);
  const cssH = Math.max(1, ctx.canvas.clientHeight);
  const width = Math.max(1, Math.floor(cssW * dpr));
  const height = Math.max(1, Math.floor(cssH * dpr));

  if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
    ctx.renderer.setPixelRatio(dpr);
    ctx.renderer.setSize(cssW, cssH, false);
  }

  return { width: ctx.canvas.width, height: ctx.canvas.height };
}
