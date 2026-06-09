import { OrthographicCamera, Scene } from "three";
import type { ComputeNode } from "three/webgpu";
import type { Inspector } from "three/addons/inspector/Inspector.js";
import type { WebGPURenderer } from "three/webgpu";

const computeStub = { name: "n-body integration", isComputeNode: true } as unknown as ComputeNode;
const particleScene = new Scene();
particleScene.name = "Particles";
const overlayScene = new Scene();
overlayScene.name = "Debug overlay";
const camera = new OrthographicCamera();

type RendererInspector = Inspector & { isRendererInspector: true };

function inspector(renderer: WebGPURenderer): RendererInspector | null {
  const insp = renderer.inspector;
  return insp && "isRendererInspector" in insp && insp.isRendererInspector ? (insp as RendererInspector) : null;
}

function frameUid(renderer: WebGPURenderer, label: string): string {
  return `nbody:${label}:f${renderer.info.frame}`;
}

export function collapseInspector(): void {
  document.getElementById("profiler-panel")?.classList.remove("visible");
  document.getElementById("profiler-toggle")?.classList.remove("panel-open");
  document.getElementById("profiler-mini-panel")?.classList.remove("visible", "panel-open");
}

// Profiler is not part of the addon's public types; saved layouts can restore
// the panel docked to the right, so force the examples-style bottom dock.
type ProfilerLike = {
  position: "bottom" | "right";
  setPosition(position: "bottom" | "right"): void;
};

export function dockInspectorBottom(renderer: WebGPURenderer): void {
  const profiler = (renderer.inspector as unknown as { profiler?: ProfilerLike } | null)?.profiler;
  if (profiler && profiler.position !== "bottom") profiler.setPosition("bottom");
}

export function beginComputePass(renderer: WebGPURenderer, label: string): void {
  const insp = inspector(renderer);
  if (!insp) return;
  computeStub.name = label;
  insp.beginCompute(frameUid(renderer, "compute"), computeStub);
}

export function endComputePass(renderer: WebGPURenderer): void {
  inspector(renderer)?.finishCompute(frameUid(renderer, "compute"));
}

export function beginParticlePass(renderer: WebGPURenderer): void {
  const insp = inspector(renderer);
  if (!insp) return;
  insp.beginRender(frameUid(renderer, "particles"), particleScene, camera, null!);
}

export function endParticlePass(renderer: WebGPURenderer): void {
  inspector(renderer)?.finishRender(frameUid(renderer, "particles"));
}

export function beginOverlayPass(renderer: WebGPURenderer): void {
  const insp = inspector(renderer);
  if (!insp) return;
  insp.beginRender(frameUid(renderer, "overlay"), overlayScene, camera, null!);
}

export function endOverlayPass(renderer: WebGPURenderer): void {
  inspector(renderer)?.finishRender(frameUid(renderer, "overlay"));
}

// The engine records raw WebGPU passes, so the backend never sees the
// inspector's timestamp uids and resolveTimestamp() can never mark a frame
// resolved — without this the Performance/Timeline tabs stay empty forever.
// Resolve frames manually, injecting the engine's own compute-pass GPU timing.
type StatsLike = { gpu: number; gpuNotAvailable?: boolean };
type FrameLike = {
  frameId: number;
  resolvedCompute: boolean;
  resolvedRender: boolean;
  computes: StatsLike[];
  renders: StatsLike[];
};
type ResolvableInspector = {
  frames: FrameLike[];
  getFrameById(frameId: number): FrameLike | null;
  resolveFrame(frame: FrameLike): void;
};

export function resolveInspectorFrames(renderer: WebGPURenderer, computeGpuMs: number): void {
  const insp = inspector(renderer) as unknown as ResolvableInspector | null;
  if (!insp) return;
  const frames = insp.frames;
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.resolvedCompute && frame.resolvedRender) break;
    if (!insp.getFrameById(frame.frameId + 1)) continue;
    for (const stats of frame.computes) stats.gpu = computeGpuMs;
    for (const stats of frame.renders) {
      stats.gpu = 0;
      stats.gpuNotAvailable = true;
    }
    frame.resolvedCompute = true;
    frame.resolvedRender = true;
    insp.resolveFrame(frame);
  }
}

export function setInspectorVisible(renderer: WebGPURenderer, visible: boolean): void {
  const shell = (renderer.inspector as Inspector | null)?.domElement;
  if (!shell) return;
  shell.style.display = visible ? "" : "none";
  if (!visible) collapseInspector();
}
