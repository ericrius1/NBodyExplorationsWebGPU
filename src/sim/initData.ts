import type { Config } from "../state";

export interface InitData {
  bodies: Float32Array;
  masses: Float32Array;
}

export function generateInitData(cfg: Config): InitData {
  const n = cfg.numParticles;
  const bodies = new Float32Array(n * 4);
  const masses = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r = cfg.spawnRadius * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;

    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const v = cfg.initialSpeed * (r / cfg.spawnRadius);

    bodies[i * 4 + 0] = x;
    bodies[i * 4 + 1] = y;
    bodies[i * 4 + 2] = tx * v;
    bodies[i * 4 + 3] = ty * v;

    masses[i] = cfg.massMin + Math.random() * (cfg.massMax - cfg.massMin);
  }

  return { bodies, masses };
}
