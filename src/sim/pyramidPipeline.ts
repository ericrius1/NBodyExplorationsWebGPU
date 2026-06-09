import shader from "../shaders/pyramid.wgsl?raw";

const WG = 256;
const MIN_LEVEL = 5;
const MAX_LEVEL = 10;
// Fixed-point scale budget: keeps the worst case (all mass in one cell) inside
// u32/i32 atomic range with headroom.
const SCALE_BUDGET = 3.6e9;

export function levelOffset(l: number): number {
  return ((1 << (2 * l)) - 1) / 3;
}

export function chooseFinestLevel(count: number): number {
  const l = Math.ceil(Math.log2(Math.max(count, 2)) / 2);
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, l));
}

export class PyramidSolver {
  finestLevel = 0;
  gridDim = 0;

  private dev: GPUDevice;
  private count = 0;

  private pClear: GPUComputePipeline;
  private pBounds: GPUComputePipeline;
  private pScatter: GPUComputePipeline;
  private pResolve: GPUComputePipeline;
  private pReduce: GPUComputePipeline;
  private pForce: GPUComputePipeline;

  private simParams: GPUBuffer;
  private pyrParams: GPUBuffer;
  private boundsBuf: GPUBuffer;
  private gridBuf: GPUBuffer = null!;
  private nodesBuf: GPUBuffer = null!;
  private levelBuf: GPUBuffer = null!;

  private clearGroup: GPUBindGroup = null!;
  private resolveGroup: GPUBindGroup = null!;
  private reduceGroups: GPUBindGroup[] = [];
  private boundsGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private scatterGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private forceGroup: [GPUBindGroup, GPUBindGroup] = [null!, null!];

  constructor(dev: GPUDevice, simParams: GPUBuffer) {
    this.dev = dev;
    this.simParams = simParams;
    const module = dev.createShaderModule({ code: shader });
    const mk = (entryPoint: string): GPUComputePipeline =>
      dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint } });
    this.pClear = mk("clear_grid");
    this.pBounds = mk("reduce_bounds");
    this.pScatter = mk("scatter");
    this.pResolve = mk("resolve");
    this.pReduce = mk("reduce");
    this.pForce = mk("force");

    this.pyrParams = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.boundsBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
  }

  get nodeCount(): number {
    return this.gridBuf ? levelOffset(this.finestLevel + 1) : 0;
  }

  // Frees all per-resolution GPU memory. Safe to call when inactive; the next
  // rebuild() reallocates from scratch.
  release(): void {
    this.gridBuf?.destroy();
    this.nodesBuf?.destroy();
    this.levelBuf?.destroy();
    this.gridBuf = null!;
    this.nodesBuf = null!;
    this.levelBuf = null!;
    this.finestLevel = 0;
    this.gridDim = 0;
    this.reduceGroups = [];
    this.clearGroup = null!;
    this.resolveGroup = null!;
    this.boundsGroup = [null!, null!];
    this.scatterGroup = [null!, null!];
    this.forceGroup = [null!, null!];
  }

  get bufferBytes(): number {
    return (this.gridBuf ? this.gridBuf.size : 0) + (this.nodesBuf ? this.nodesBuf.size : 0) + 32;
  }

  rebuild(count: number, totalMass: number, bodies: [GPUBuffer, GPUBuffer], mass: GPUBuffer): void {
    this.count = count;
    const level = chooseFinestLevel(count);
    if (level !== this.finestLevel) {
      this.finestLevel = level;
      this.gridDim = 1 << level;
      this.gridBuf?.destroy();
      this.nodesBuf?.destroy();
      this.levelBuf?.destroy();
      this.gridBuf = this.dev.createBuffer({
        size: this.gridDim * this.gridDim * 16,
        usage: GPUBufferUsage.STORAGE,
      });
      this.nodesBuf = this.dev.createBuffer({
        size: this.nodeCount * 16,
        usage: GPUBufferUsage.STORAGE,
      });
      this.levelBuf = this.dev.createBuffer({
        size: level * 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      for (let l = 0; l < level; l++) {
        this.dev.queue.writeBuffer(this.levelBuf, l * 256, new Uint32Array([l]));
      }
      this.buildStaticGroups();
    }

    const scale = SCALE_BUDGET / Math.max(totalMass, 1e-9);
    const params = new ArrayBuffer(16);
    const dv = new DataView(params);
    dv.setUint32(0, this.finestLevel, true);
    dv.setUint32(4, this.gridDim, true);
    dv.setFloat32(8, scale, true);
    dv.setFloat32(12, scale, true);
    this.dev.queue.writeBuffer(this.pyrParams, 0, params);

    this.buildBodyGroups(bodies, mass);
  }

  private buildStaticGroups(): void {
    this.clearGroup = this.dev.createBindGroup({
      layout: this.pClear.getBindGroupLayout(0),
      entries: [
        { binding: 4, resource: { buffer: this.gridBuf } },
        { binding: 6, resource: { buffer: this.boundsBuf } },
        { binding: 7, resource: { buffer: this.pyrParams } },
      ],
    });
    this.resolveGroup = this.dev.createBindGroup({
      layout: this.pResolve.getBindGroupLayout(0),
      entries: [
        { binding: 4, resource: { buffer: this.gridBuf } },
        { binding: 5, resource: { buffer: this.nodesBuf } },
        { binding: 6, resource: { buffer: this.boundsBuf } },
        { binding: 7, resource: { buffer: this.pyrParams } },
      ],
    });
    this.reduceGroups = [];
    for (let l = 0; l < this.finestLevel; l++) {
      this.reduceGroups.push(
        this.dev.createBindGroup({
          layout: this.pReduce.getBindGroupLayout(0),
          entries: [
            { binding: 5, resource: { buffer: this.nodesBuf } },
            { binding: 8, resource: { buffer: this.levelBuf, offset: l * 256, size: 16 } },
          ],
        }),
      );
    }
  }

  private buildBodyGroups(bodies: [GPUBuffer, GPUBuffer], mass: GPUBuffer): void {
    const mkBounds = (inB: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: this.pBounds.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.simParams } },
          { binding: 1, resource: { buffer: inB } },
          { binding: 6, resource: { buffer: this.boundsBuf } },
        ],
      });
    const mkScatter = (inB: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: this.pScatter.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.simParams } },
          { binding: 1, resource: { buffer: inB } },
          { binding: 3, resource: { buffer: mass } },
          { binding: 4, resource: { buffer: this.gridBuf } },
          { binding: 6, resource: { buffer: this.boundsBuf } },
          { binding: 7, resource: { buffer: this.pyrParams } },
        ],
      });
    const mkForce = (inB: GPUBuffer, outB: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: this.pForce.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.simParams } },
          { binding: 1, resource: { buffer: inB } },
          { binding: 2, resource: { buffer: outB } },
          { binding: 3, resource: { buffer: mass } },
          { binding: 5, resource: { buffer: this.nodesBuf } },
          { binding: 6, resource: { buffer: this.boundsBuf } },
          { binding: 7, resource: { buffer: this.pyrParams } },
        ],
      });
    this.boundsGroup = [mkBounds(bodies[0]), mkBounds(bodies[1])];
    this.scatterGroup = [mkScatter(bodies[0]), mkScatter(bodies[1])];
    this.forceGroup = [mkForce(bodies[0], bodies[1]), mkForce(bodies[1], bodies[0])];
  }

  // Encodes one full simulation substep. WebGPU synchronizes storage writes
  // between dispatches in the same pass, so ordering here is sufficient.
  encode(cpass: GPUComputePassEncoder, parity: 0 | 1): void {
    const cells = this.gridDim * this.gridDim;
    const bodyWGs = Math.ceil(this.count / WG);

    cpass.setPipeline(this.pClear);
    cpass.setBindGroup(0, this.clearGroup);
    cpass.dispatchWorkgroups(Math.ceil((cells * 4) / WG));

    cpass.setPipeline(this.pBounds);
    cpass.setBindGroup(0, this.boundsGroup[parity]);
    cpass.dispatchWorkgroups(bodyWGs);

    cpass.setPipeline(this.pScatter);
    cpass.setBindGroup(0, this.scatterGroup[parity]);
    cpass.dispatchWorkgroups(bodyWGs);

    cpass.setPipeline(this.pResolve);
    cpass.setBindGroup(0, this.resolveGroup);
    cpass.dispatchWorkgroups(Math.ceil(cells / WG));

    cpass.setPipeline(this.pReduce);
    for (let l = this.finestLevel - 1; l >= 0; l--) {
      cpass.setBindGroup(0, this.reduceGroups[l]);
      cpass.dispatchWorkgroups(Math.max(1, Math.ceil((1 << (2 * l)) / WG)));
    }

    cpass.setPipeline(this.pForce);
    cpass.setBindGroup(0, this.forceGroup[parity]);
    cpass.dispatchWorkgroups(bodyWGs);
  }
}
