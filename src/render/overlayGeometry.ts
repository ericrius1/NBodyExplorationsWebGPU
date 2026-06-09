import type { QuadTree } from "../sim/quadtree";

export type RGBA = [number, number, number, number];

export class LineBuilder {
  private verts: number[] = [];

  get count(): number {
    return this.verts.length / 6;
  }

  line(x1: number, y1: number, x2: number, y2: number, c: RGBA): void {
    this.verts.push(x1, y1, c[0], c[1], c[2], c[3], x2, y2, c[0], c[1], c[2], c[3]);
  }

  rect(cx: number, cy: number, half: number, c: RGBA): void {
    const a = cx - half;
    const b = cx + half;
    const d = cy - half;
    const e = cy + half;
    this.line(a, d, b, d, c);
    this.line(b, d, b, e, c);
    this.line(b, e, a, e, c);
    this.line(a, e, a, d, c);
  }

  cross(x: number, y: number, r: number, c: RGBA): void {
    this.line(x - r, y, x + r, y, c);
    this.line(x, y - r, x, y + r, c);
  }

  toFloat32(): Float32Array {
    return new Float32Array(this.verts);
  }
}

export function addQuadtreeCells(lb: LineBuilder, tree: QuadTree, maxCells: number): void {
  const color: RGBA = [0.2, 0.9, 0.45, 0.25];
  const step = Math.max(1, Math.ceil(tree.nodeCount / maxCells));
  for (let n = 0; n < tree.nodeCount; n += step) {
    if (tree.f32[n * 8 + 2] <= 0) continue;
    lb.rect(tree.cx[n], tree.cy[n], tree.half[n], color);
  }
}

export function addCentersOfMass(lb: LineBuilder, tree: QuadTree, maxNodes: number): void {
  const color: RGBA = [1.0, 0.3, 0.9, 0.7];
  const step = Math.max(1, Math.ceil(tree.nodeCount / maxNodes));
  for (let n = 0; n < tree.nodeCount; n += step) {
    const m = tree.f32[n * 8 + 2];
    if (m <= 0) continue;
    const r = Math.min(0.04, 0.002 + Math.cbrt(m) * 0.0015);
    lb.cross(tree.f32[n * 8], tree.f32[n * 8 + 1], r, color);
  }
}

export function addVelocityField(
  lb: LineBuilder,
  bodies: Float32Array,
  count: number,
  scale: number,
  maxLines: number,
): void {
  const color: RGBA = [0.2, 0.7, 1.0, 0.5];
  const step = Math.max(1, Math.ceil(count / maxLines));
  for (let i = 0; i < count; i += step) {
    const x = bodies[i * 4];
    const y = bodies[i * 4 + 1];
    lb.line(x, y, x + bodies[i * 4 + 2] * scale, y + bodies[i * 4 + 3] * scale, color);
  }
}

export function addNaiveProbe(
  lb: LineBuilder,
  bodies: Float32Array,
  probe: number,
  count: number,
  maxLines: number,
): void {
  const px = bodies[probe * 4];
  const py = bodies[probe * 4 + 1];
  const probeColor: RGBA = [1.0, 0.95, 0.2, 1.0];
  const lineColor: RGBA = [1.0, 0.55, 0.15, 0.35];

  lb.rect(px, py, 0.012, probeColor);

  const step = Math.max(1, Math.ceil(count / maxLines));
  for (let j = 0; j < count; j += step) {
    if (j === probe) continue;
    lb.line(px, py, bodies[j * 4], bodies[j * 4 + 1], lineColor);
  }
}

export function addProbe(
  lb: LineBuilder,
  tree: QuadTree,
  bodies: Float32Array,
  probe: number,
  theta: number,
  softening: number,
): void {
  const px = bodies[probe * 4];
  const py = bodies[probe * 4 + 1];
  const probeColor: RGBA = [1.0, 0.95, 0.2, 1.0];
  const cellColor: RGBA = [1.0, 0.85, 0.1, 0.55];
  const theta2 = theta * theta;

  lb.rect(px, py, 0.012, probeColor);

  const stack = [0];
  while (stack.length > 0) {
    const n = stack.pop()!;
    const m = tree.f32[n * 8 + 2];
    if (m <= 0) continue;
    const comx = tree.f32[n * 8];
    const comy = tree.f32[n * 8 + 1];
    const dx = comx - px;
    const dy = comy - py;
    const r2 = dx * dx + dy * dy + softening;
    const w = tree.half[n] * 2;
    const c0 = tree.i32[n * 8 + 4];
    const c1 = tree.i32[n * 8 + 5];
    const c2 = tree.i32[n * 8 + 6];
    const c3 = tree.i32[n * 8 + 7];
    const leaf = c0 < 0 && c1 < 0 && c2 < 0 && c3 < 0;
    if (leaf || w * w < theta2 * r2) {
      lb.rect(tree.cx[n], tree.cy[n], tree.half[n], cellColor);
      lb.line(px, py, comx, comy, cellColor);
    } else {
      if (c0 >= 0) stack.push(c0);
      if (c1 >= 0) stack.push(c1);
      if (c2 >= 0) stack.push(c2);
      if (c3 >= 0) stack.push(c3);
    }
  }
}
