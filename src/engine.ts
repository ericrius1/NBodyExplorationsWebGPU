import type { GpuContext } from "./gpu/context";
import { resizeCanvas } from "./gpu/context";
import { config } from "./state";
import { generateInitData } from "./sim/initData";
import { buildQuadTree, NODE_FLOATS, type QuadTree } from "./sim/quadtree";
import { createNaivePipeline } from "./sim/naivePipeline";
import { createBhPipeline } from "./sim/bhPipeline";
import { PyramidSolver } from "./sim/pyramidPipeline";
import { buildCpuPyramid, type CpuPyramid } from "./sim/pyramidCpu";
import { createParticlePipeline } from "./render/particlePipeline";
import { createOverlayPipeline } from "./render/overlayPipeline";
import { Camera } from "./render/camera";
import {
  LineBuilder,
  addQuadtreeCells,
  addCentersOfMass,
  addVelocityField,
  addProbe,
  addNaiveProbe,
  addPyramidCells,
  addPyramidCOM,
  addPyramidProbe,
} from "./render/overlayGeometry";
import { Metrics } from "./ui/metrics";
import {
  beginComputePass,
  endComputePass,
  beginParticlePass,
  endParticlePass,
  beginOverlayPass,
  endOverlayPass,
} from "./gpu/inspectorHooks";

function hex(s: string): [number, number, number] {
  const n = parseInt(s.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const WG = 256;

export class Engine {
  readonly camera = new Camera();
  readonly metrics = new Metrics();
  debug = true;
  paused = false;

  private dev: GPUDevice;
  private ctx: GpuContext;

  private naive: GPUComputePipeline;
  private bh: GPUComputePipeline;
  private pyr: PyramidSolver;
  private particle: GPURenderPipeline;
  private overlay: GPURenderPipeline;

  private simParams: GPUBuffer;
  private renderParams: GPUBuffer;
  private bodies: [GPUBuffer, GPUBuffer] = [null!, null!];
  private mass: GPUBuffer = null!;
  private nodesBuf: GPUBuffer = null!;
  private nodesCapBytes = 0;
  private overlayBuf: GPUBuffer = null!;
  private overlayCapBytes = 0;

  private bodyStaging: GPUBuffer = null!;
  private cpuBodies: Float32Array = new Float32Array(0);
  private cpuMass: Float32Array = new Float32Array(0);

  private naiveGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private bhGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private particleGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private overlayGroup: GPUBindGroup = null!;

  private cur = 0;
  private count = 0;

  private tree: QuadTree | null = null;
  private treeReady = false;
  private pyrMirror: CpuPyramid | null = null;
  private probe = 0;

  private bodyMapInFlight = false;

  private querySet: GPUQuerySet | null = null;
  private tsResolve: GPUBuffer | null = null;
  private tsRead: GPUBuffer | null = null;
  private tsMapInFlight = false;

  private lastRefresh = 0;
  private lastMirror = 0;
  private lastVizReadback = 0;
  private onRefresh: (() => void) | null = null;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.dev = ctx.device;
    this.naive = createNaivePipeline(this.dev);
    this.bh = createBhPipeline(this.dev);
    this.particle = createParticlePipeline(this.dev, ctx.format);
    this.overlay = createOverlayPipeline(this.dev, ctx.format);

    this.simParams = this.dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.renderParams = this.dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.pyr = new PyramidSolver(this.dev, this.simParams);

    if (ctx.hasTimestamp) {
      this.querySet = this.dev.createQuerySet({ type: "timestamp", count: 2 });
      this.tsResolve = this.dev.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.tsRead = this.dev.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    }

    this.rebuild();
  }

  setRefreshCallback(cb: () => void): void {
    this.onRefresh = cb;
  }

  rebuild(): void {
    this.count = config.numParticles;
    const data = generateInitData(config);
    this.cpuMass = data.masses;
    this.cpuBodies = new Float32Array(data.bodies);

    for (const b of this.bodies) b?.destroy();
    const bodyBytes = this.count * 16;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.bodies = [
      this.dev.createBuffer({ size: bodyBytes, usage }),
      this.dev.createBuffer({ size: bodyBytes, usage }),
    ];
    this.dev.queue.writeBuffer(this.bodies[0], 0, data.bodies as BufferSource);

    this.mass?.destroy();
    this.mass = this.dev.createBuffer({ size: this.count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.dev.queue.writeBuffer(this.mass, 0, data.masses as BufferSource);

    this.bodyStaging?.destroy();
    this.bodyStaging = this.dev.createBuffer({ size: bodyBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.bodyMapInFlight = false;

    this.ensureNodesBuffer(WG * NODE_FLOATS * 4);
    this.cur = 0;
    this.tree = null;
    this.treeReady = false;
    this.pyrMirror = null;
    this.probe = 0;

    let totalMass = 0;
    for (let i = 0; i < this.count; i++) totalMass += this.cpuMass[i];
    this.pyr.rebuild(this.count, totalMass, this.bodies, this.mass);

    this.buildComputeGroups();
    this.buildParticleGroups();
    this.overlayGroup = this.dev.createBindGroup({
      layout: this.overlay.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.renderParams } }],
    });

    this.updateMemoryMetric();
  }

  private ensureNodesBuffer(bytes: number): void {
    if (bytes <= this.nodesCapBytes && this.nodesBuf) return;
    this.nodesBuf?.destroy();
    this.nodesCapBytes = Math.max(bytes, Math.floor(this.nodesCapBytes * 1.5));
    this.nodesBuf = this.dev.createBuffer({ size: this.nodesCapBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.buildBhGroups();
  }

  private buildComputeGroups(): void {
    this.buildNaiveGroups();
    this.buildBhGroups();
  }

  private buildNaiveGroups(): void {
    const layout = this.naive.getBindGroupLayout(0);
    const mk = (inB: GPUBuffer, outB: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.simParams } },
          { binding: 1, resource: { buffer: inB } },
          { binding: 2, resource: { buffer: outB } },
          { binding: 3, resource: { buffer: this.mass } },
        ],
      });
    this.naiveGroup = [mk(this.bodies[0], this.bodies[1]), mk(this.bodies[1], this.bodies[0])];
  }

  private buildBhGroups(): void {
    if (!this.nodesBuf || !this.bodies[0]) return;
    const layout = this.bh.getBindGroupLayout(0);
    const mk = (inB: GPUBuffer, outB: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.simParams } },
          { binding: 1, resource: { buffer: inB } },
          { binding: 2, resource: { buffer: outB } },
          { binding: 3, resource: { buffer: this.nodesBuf } },
        ],
      });
    this.bhGroup = [mk(this.bodies[0], this.bodies[1]), mk(this.bodies[1], this.bodies[0])];
  }

  private buildParticleGroups(): void {
    const layout = this.particle.getBindGroupLayout(0);
    const mk = (b: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.renderParams } },
          { binding: 1, resource: { buffer: b } },
          { binding: 2, resource: { buffer: this.mass } },
        ],
      });
    this.particleGroup = [mk(this.bodies[0]), mk(this.bodies[1])];
  }

  private writeSimParams(): void {
    const buf = new ArrayBuffer(32);
    const dv = new DataView(buf);
    dv.setUint32(0, this.count, true);
    dv.setFloat32(4, config.timeStep, true);
    dv.setFloat32(8, config.gravity, true);
    dv.setFloat32(12, config.softening, true);
    dv.setFloat32(16, config.theta, true);
    dv.setFloat32(20, config.damping, true);
    dv.setFloat32(24, config.maxSpeed, true);
    this.dev.queue.writeBuffer(this.simParams, 0, buf);
  }

  private writeRenderParams(aspect: number): void {
    const f = new Float32Array(16);
    f[0] = this.camera.centerX;
    f[1] = this.camera.centerY;
    f[2] = this.camera.zoom;
    f[3] = aspect;
    f[4] = config.sizeScale;
    f[5] = config.minSize;
    f[6] = config.colorScale;
    const lo = hex(config.colorLow);
    const hi = hex(config.colorHigh);
    f[8] = lo[0]; f[9] = lo[1]; f[10] = lo[2]; f[11] = 1;
    f[12] = hi[0]; f[13] = hi[1]; f[14] = hi[2]; f[15] = 1;
    this.dev.queue.writeBuffer(this.renderParams, 0, f);
  }

  private updateMemoryMetric(): void {
    const bytes =
      this.count * 16 * 2 + this.count * 4 + this.nodesCapBytes + this.overlayCapBytes + this.pyr.bufferBytes + 96;
    this.metrics.bufferMB = bytes / (1024 * 1024);
  }

  frame(): void {
    const { width, height } = resizeCanvas(this.ctx);
    const aspect = width / height;
    this.writeSimParams();
    this.writeRenderParams(aspect);

    const mode = config.mode;
    const useBh = mode === "barnesHut" && this.treeReady;
    const profile = this.debug;

    const enc = this.dev.createCommandEncoder();

    if (!this.paused) {
      const label = mode === "bhGpu" ? "Barnes–Hut (GPU pyramid)" : useBh ? "Barnes–Hut (CPU tree)" : "Naive O(n²)";
      if (profile) beginComputePass(this.ctx.renderer, label);
      const tsWrites = this.querySet
        ? { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
        : undefined;
      const cpass = enc.beginComputePass(tsWrites ? { timestampWrites: tsWrites } : {});
      const steps = Math.max(1, Math.floor(config.stepsPerFrame));
      for (let s = 0; s < steps; s++) {
        const parity = this.cur as 0 | 1;
        if (mode === "bhGpu") {
          this.pyr.encode(cpass, parity);
        } else {
          cpass.setPipeline(useBh ? this.bh : this.naive);
          cpass.setBindGroup(0, useBh ? this.bhGroup[parity] : this.naiveGroup[parity]);
          cpass.dispatchWorkgroups(Math.ceil(this.count / WG));
        }
        this.cur = 1 - this.cur;
      }
      cpass.end();
      if (profile) endComputePass(this.ctx.renderer);

      if (this.querySet && this.tsResolve && this.tsRead && !this.tsMapInFlight) {
        enc.resolveQuerySet(this.querySet, 0, 2, this.tsResolve, 0);
        enc.copyBufferToBuffer(this.tsResolve, 0, this.tsRead, 0, 16);
      }
    }

    const view = this.ctx.context.getCurrentTexture().createView();
    const rpass = enc.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    if (profile) beginParticlePass(this.ctx.renderer);
    rpass.setPipeline(this.particle);
    rpass.setBindGroup(0, this.particleGroup[this.cur]);
    rpass.draw(6, this.count);
    if (profile) endParticlePass(this.ctx.renderer);

    const overlayVerts = this.debug ? this.buildOverlay() : null;
    if (overlayVerts && overlayVerts.length > 0) {
      if (profile) beginOverlayPass(this.ctx.renderer);
      this.ensureOverlayBuffer(overlayVerts.byteLength);
      this.dev.queue.writeBuffer(this.overlayBuf, 0, overlayVerts as BufferSource);
      rpass.setPipeline(this.overlay);
      rpass.setBindGroup(0, this.overlayGroup);
      rpass.setVertexBuffer(0, this.overlayBuf);
      rpass.draw(overlayVerts.length / 6);
      if (profile) endOverlayPass(this.ctx.renderer);
    }
    rpass.end();

    this.dev.queue.submit([enc.finish()]);

    this.scheduleReadback();
    this.readTimestamps();

    this.metrics.tick();
    this.metrics.nodes =
      mode === "bhGpu" ? this.pyr.nodeCount : this.tree && mode === "barnesHut" ? this.tree.nodeCount : 0;
    const now = performance.now();
    if (this.debug && this.onRefresh && now - this.lastRefresh > 250) {
      this.lastRefresh = now;
      this.onRefresh();
    }
  }

  private needTree(): boolean {
    return config.mode === "barnesHut";
  }

  private needReadback(): boolean {
    if (this.needTree()) return true;
    if (!this.debug) return false;
    if (config.showVelocity || config.showProbe) return true;
    return config.mode === "bhGpu" && (config.showQuadtree || config.showCenterOfMass);
  }

  private scheduleReadback(): void {
    if (this.bodyMapInFlight || !this.needReadback()) return;
    if (!this.needTree()) {
      // Viz-only readback: cap the GPU->CPU traffic at high particle counts.
      const now = performance.now();
      if (now - this.lastVizReadback < 100) return;
      this.lastVizReadback = now;
    }
    const src = this.bodies[this.cur];
    const bytes = this.count * 16;
    const enc = this.dev.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, this.bodyStaging, 0, bytes);
    this.dev.queue.submit([enc.finish()]);
    this.bodyMapInFlight = true;
    const staging = this.bodyStaging;
    staging.mapAsync(GPUMapMode.READ).then(() => {
      this.cpuBodies.set(new Float32Array(staging.getMappedRange()).subarray(0, this.count * 4));
      staging.unmap();
      this.bodyMapInFlight = false;
      if (this.needTree()) {
        this.rebuildTree();
      } else {
        // The CPU mirror is viz-only; rebuilding it every readback costs
        // O(n) JS time, so throttle it at high particle counts.
        const wantMirror =
          config.mode === "bhGpu" &&
          this.debug &&
          (config.showQuadtree || config.showCenterOfMass || config.showProbe);
        const now = performance.now();
        if (wantMirror && now - this.lastMirror > 250) {
          this.lastMirror = now;
          this.pyrMirror = buildCpuPyramid(this.cpuBodies, this.cpuMass, this.count, this.pyr.finestLevel);
        }
        if (this.debug && config.showProbe) this.pickProbe();
      }
    }).catch(() => { this.bodyMapInFlight = false; });
  }

  private rebuildTree(): void {
    const tree = buildQuadTree(this.cpuBodies, this.cpuMass, this.count);
    this.ensureNodesBuffer(tree.nodeCount * NODE_FLOATS * 4);
    this.dev.queue.writeBuffer(this.nodesBuf, 0, tree.data);
    this.tree = tree;
    this.treeReady = true;
    this.pickProbe();
    this.updateMemoryMetric();
  }

  private pickProbe(): void {
    let best = 0;
    let bestR = -1;
    const step = Math.max(1, Math.floor(this.count / 4096));
    for (let i = 0; i < this.count; i += step) {
      const x = this.cpuBodies[i * 4];
      const y = this.cpuBodies[i * 4 + 1];
      const r = x * x + y * y;
      if (r > bestR) { bestR = r; best = i; }
    }
    this.probe = best;
  }

  private buildOverlay(): Float32Array | null {
    const lb = new LineBuilder();
    if (config.mode === "barnesHut") {
      if (this.tree && config.showQuadtree) addQuadtreeCells(lb, this.tree, 12000);
      if (this.tree && config.showCenterOfMass) addCentersOfMass(lb, this.tree, 4000);
      if (this.tree && config.showProbe) addProbe(lb, this.tree, this.cpuBodies, this.probe, config.theta, config.softening);
    } else if (config.mode === "bhGpu") {
      const pyr = this.pyrMirror;
      if (pyr && config.showQuadtree) addPyramidCells(lb, pyr, 6);
      if (pyr && config.showCenterOfMass) addPyramidCOM(lb, pyr, 6);
      if (pyr && config.showProbe && this.cpuBodies.length) {
        addPyramidProbe(lb, pyr, this.cpuBodies, this.probe, config.theta, config.softening);
      }
    } else if (config.showProbe && this.cpuBodies.length) {
      addNaiveProbe(lb, this.cpuBodies, this.probe, this.count, 6000);
    }
    if (config.showVelocity && this.cpuBodies.length) addVelocityField(lb, this.cpuBodies, this.count, config.timeStep * 8, 6000);
    return lb.count > 0 ? lb.toFloat32() : null;
  }

  private ensureOverlayBuffer(bytes: number): void {
    if (bytes <= this.overlayCapBytes && this.overlayBuf) return;
    this.overlayBuf?.destroy();
    this.overlayCapBytes = Math.max(bytes, Math.floor(this.overlayCapBytes * 1.5), 4096);
    this.overlayBuf = this.dev.createBuffer({ size: this.overlayCapBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.updateMemoryMetric();
  }

  private readTimestamps(): void {
    if (!this.tsRead || this.tsMapInFlight) return;
    this.tsMapInFlight = true;
    const buf = this.tsRead;
    buf.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(buf.getMappedRange());
      const ms = Number(t[1] - t[0]) / 1e6;
      if (ms >= 0 && ms < 1000) this.metrics.computeMs = ms;
      buf.unmap();
      this.tsMapInFlight = false;
    }).catch(() => { this.tsMapInFlight = false; });
  }
}
