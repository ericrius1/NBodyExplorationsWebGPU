import type { Config } from "../state";

export interface InitData {
  bodies: Float32Array;
  masses: Float32Array;
}

function randn(): number {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateInitData(cfg: Config): InitData {
  const n = cfg.numParticles;
  const bodies = new Float32Array(n * 4);
  const masses = new Float32Array(n);

  let total = 0;
  for (let i = 0; i < n; i++) {
    const m = cfg.massMin + Math.random() * (cfg.massMax - cfg.massMin);
    masses[i] = m;
    total += m;
  }

  const R = cfg.spawnRadius;
  for (let i = 0; i < n; i++) {
    const r = R * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;

    const mEnc = total * ((r * r) / (R * R));
    const rEff = Math.sqrt(r * r + cfg.softening);
    const vCirc = Math.sqrt((cfg.gravity * mEnc) / rEff);

    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const v = cfg.spin * vCirc;
    const disp = cfg.dispersion * vCirc;

    bodies[i * 4 + 0] = x;
    bodies[i * 4 + 1] = y;
    bodies[i * 4 + 2] = tx * v + randn() * disp;
    bodies[i * 4 + 3] = ty * v + randn() * disp;
  }

  return { bodies, masses };
}
