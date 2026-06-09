// CPU mirror of the GPU pyramid, used only for debug overlays. Built from the
// readback copy of bodies, so it lags the sim by a frame or two — fine for
// visualization.

export interface CpuPyramid {
  finest: number;
  originX: number;
  originY: number;
  size: number;
  // levels[l] has (1<<l)^2 cells, 3 floats each: mass, comX, comY.
  levels: Float32Array[];
}

export function buildCpuPyramid(
  bodies: Float32Array,
  masses: Float32Array,
  count: number,
  finest: number,
): CpuPyramid {
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
  const half = Math.max(maxX - minX, maxY - minY, 1e-6) * 0.5 * 1.0001;
  const originX = (minX + maxX) * 0.5 - half;
  const originY = (minY + maxY) * 0.5 - half;
  const size = half * 2;

  const dim = 1 << finest;
  const levels: Float32Array[] = [];
  for (let l = 0; l <= finest; l++) levels.push(new Float32Array((1 << l) * (1 << l) * 3));

  const fine = levels[finest];
  for (let i = 0; i < count; i++) {
    const gx = Math.min(dim - 1, Math.max(0, Math.floor(((bodies[i * 4] - originX) / size) * dim)));
    const gy = Math.min(dim - 1, Math.max(0, Math.floor(((bodies[i * 4 + 1] - originY) / size) * dim)));
    const m = masses[i];
    const c = (gy * dim + gx) * 3;
    fine[c] += m;
    fine[c + 1] += m * bodies[i * 4];
    fine[c + 2] += m * bodies[i * 4 + 1];
  }

  for (let l = finest - 1; l >= 0; l--) {
    const coarse = levels[l];
    const finer = levels[l + 1];
    const d = 1 << l;
    const fd = d * 2;
    for (let iy = 0; iy < d; iy++) {
      for (let ix = 0; ix < d; ix++) {
        const o = (iy * d + ix) * 3;
        for (let q = 0; q < 4; q++) {
          const f = ((iy * 2 + (q >> 1)) * fd + ix * 2 + (q & 1)) * 3;
          coarse[o] += finer[f];
          coarse[o + 1] += finer[f + 1];
          coarse[o + 2] += finer[f + 2];
        }
      }
    }
  }

  // Convert weighted sums to centers of mass in place.
  for (let l = 0; l <= finest; l++) {
    const lv = levels[l];
    for (let c = 0; c < lv.length; c += 3) {
      if (lv[c] > 0) {
        lv[c + 1] /= lv[c];
        lv[c + 2] /= lv[c];
      }
    }
  }

  return { finest, originX, originY, size, levels };
}

export interface PyramidVisit {
  level: number;
  ix: number;
  iy: number;
  mass: number;
  comX: number;
  comY: number;
}

// Mirrors the GPU force kernel's traversal for one probe particle, reporting
// every accepted node.
export function traverseCpuPyramid(
  pyr: CpuPyramid,
  px: number,
  py: number,
  theta: number,
  softening: number,
  visit: (v: PyramidVisit) => void,
): void {
  const theta2 = theta * theta;
  const eps2 = softening * softening;
  const stack: number[] = [0, 0, 0]; // level, ix, iy triples
  while (stack.length > 0) {
    const iy = stack.pop()!;
    const ix = stack.pop()!;
    const level = stack.pop()!;
    const dim = 1 << level;
    const c = (iy * dim + ix) * 3;
    const lv = pyr.levels[level];
    const m = lv[c];
    if (m <= 0) continue;
    const comX = lv[c + 1];
    const comY = lv[c + 2];
    const dx = comX - px;
    const dy = comY - py;
    const r2 = dx * dx + dy * dy + eps2;
    const w = pyr.size / dim;
    if (level === pyr.finest || w * w < theta2 * r2) {
      visit({ level, ix, iy, mass: m, comX, comY });
    } else {
      stack.push(level + 1, ix * 2, iy * 2);
      stack.push(level + 1, ix * 2 + 1, iy * 2);
      stack.push(level + 1, ix * 2, iy * 2 + 1);
      stack.push(level + 1, ix * 2 + 1, iy * 2 + 1);
    }
  }
}
