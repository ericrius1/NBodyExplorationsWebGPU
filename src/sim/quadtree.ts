const MAX_DEPTH = 24;
export const NODE_FLOATS = 8;

export interface QuadTree {
  nodeCount: number;
  data: ArrayBuffer;
  f32: Float32Array;
  i32: Int32Array;
  cx: Float64Array;
  cy: Float64Array;
  half: Float64Array;
  rootHalf: number;
}

export function buildQuadTree(bodies: Float32Array, masses: Float32Array, count: number): QuadTree {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = bodies[i * 4];
    const y = bodies[i * 4 + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) {
    minX = -1;
    minY = -1;
    maxX = 1;
    maxY = 1;
  }
  const rcx = (minX + maxX) * 0.5;
  const rcy = (minY + maxY) * 0.5;
  const rootHalf = Math.max(maxX - minX, maxY - minY, 1e-6) * 0.5 * 1.0001;

  const cap = count * 4 + 64;
  const cx = new Float64Array(cap);
  const cy = new Float64Array(cap);
  const half = new Float64Array(cap);
  const child = new Int32Array(cap * 4).fill(-1);
  const body = new Int32Array(cap).fill(-1);

  cx[0] = rcx;
  cy[0] = rcy;
  half[0] = rootHalf;
  let next = 1;

  const quad = (px: number, py: number, ncx: number, ncy: number): number =>
    (px >= ncx ? 1 : 0) + (py >= ncy ? 2 : 0);

  for (let i = 0; i < count; i++) {
    const px = bodies[i * 4];
    const py = bodies[i * 4 + 1];
    let ni = 0;
    let depth = 0;
    for (;;) {
      if (child[ni * 4] === -1) {
        if (body[ni] === -1) {
          body[ni] = i;
          break;
        }
        if (depth >= MAX_DEPTH || next + 4 > cap) {
          break;
        }
        const old = body[ni];
        body[ni] = -1;
        const h = half[ni] * 0.5;
        const ncx = cx[ni];
        const ncy = cy[ni];
        for (let q = 0; q < 4; q++) {
          const c = next++;
          cx[c] = ncx + ((q & 1) ? h : -h);
          cy[c] = ncy + ((q & 2) ? h : -h);
          half[c] = h;
          child[ni * 4 + q] = c;
        }
        const oq = quad(bodies[old * 4], bodies[old * 4 + 1], ncx, ncy);
        body[child[ni * 4 + oq]] = old;
      }
      const q = quad(px, py, cx[ni], cy[ni]);
      ni = child[ni * 4 + q];
      depth++;
    }
  }

  const data = new ArrayBuffer(next * NODE_FLOATS * 4);
  const f32 = new Float32Array(data);
  const i32 = new Int32Array(data);

  const comX = new Float64Array(next);
  const comY = new Float64Array(next);
  const mass = new Float64Array(next);

  for (let ni = next - 1; ni >= 0; ni--) {
    let m = 0;
    let mx = 0;
    let my = 0;
    if (child[ni * 4] === -1) {
      const bi = body[ni];
      if (bi >= 0) {
        m = masses[bi];
        mx = bodies[bi * 4] * m;
        my = bodies[bi * 4 + 1] * m;
      }
    } else {
      for (let q = 0; q < 4; q++) {
        const c = child[ni * 4 + q];
        if (c >= 0 && mass[c] > 0) {
          m += mass[c];
          mx += comX[c] * mass[c];
          my += comY[c] * mass[c];
        } else {
          child[ni * 4 + q] = -1;
        }
      }
    }
    mass[ni] = m;
    comX[ni] = m > 0 ? mx / m : cx[ni];
    comY[ni] = m > 0 ? my / m : cy[ni];

    const o = ni * NODE_FLOATS;
    f32[o] = comX[ni];
    f32[o + 1] = comY[ni];
    f32[o + 2] = m;
    f32[o + 3] = half[ni];
    i32[o + 4] = child[ni * 4];
    i32[o + 5] = child[ni * 4 + 1];
    i32[o + 6] = child[ni * 4 + 2];
    i32[o + 7] = child[ni * 4 + 3];
  }

  return { nodeCount: next, data, f32, i32, cx, cy, half, rootHalf };
}
