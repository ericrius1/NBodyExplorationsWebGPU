export type Mode = "naive" | "barnesHut";

export interface Config {
  numParticles: number;
  mode: Mode;
  gravity: number;
  timeStep: number;
  softening: number;
  theta: number;
  damping: number;
  spawnRadius: number;
  initialSpeed: number;
  massMin: number;
  massMax: number;
  sizeScale: number;
  minSize: number;
  colorScale: number;
  colorLow: string;
  colorHigh: string;
  showQuadtree: boolean;
  showCenterOfMass: boolean;
  showVelocity: boolean;
  showProbe: boolean;
}

export const config: Config = {
  numParticles: 16000,
  mode: "barnesHut",
  gravity: 0.00004,
  timeStep: 0.016,
  softening: 0.0008,
  theta: 0.75,
  damping: 1.0,
  spawnRadius: 0.9,
  initialSpeed: 0.25,
  massMin: 1.0,
  massMax: 6.0,
  sizeScale: 0.0024,
  minSize: 0.0012,
  colorScale: 1.6,
  colorLow: "#1b3cff",
  colorHigh: "#ff4d2e",
  showQuadtree: true,
  showCenterOfMass: false,
  showVelocity: false,
  showProbe: true,
};

export interface Control {
  key: keyof Config;
  folder?: string;
  rebuild?: "last" | "always";
  opts?: Record<string, unknown>;
}

export const CONTROLS: Control[] = [
  { key: "mode", folder: "Simulation", opts: { options: { "naive O(n^2)": "naive", "barnes-hut": "barnesHut" } } },
  { key: "numParticles", folder: "Simulation", rebuild: "last", opts: { min: 256, max: 200000, step: 256 } },
  { key: "gravity", folder: "Physics", opts: { min: 0, max: 0.0004, step: 0.000001 } },
  { key: "timeStep", folder: "Physics", opts: { min: 0, max: 0.05, step: 0.001, label: "dt" } },
  { key: "softening", folder: "Physics", opts: { min: 0.00001, max: 0.01, step: 0.00001 } },
  { key: "theta", folder: "Physics", opts: { min: 0.1, max: 2.0, step: 0.01, label: "theta (BH)" } },
  { key: "damping", folder: "Physics", opts: { min: 0.9, max: 1.0, step: 0.0005 } },
  { key: "spawnRadius", folder: "Spawn", rebuild: "last", opts: { min: 0.1, max: 2.0, step: 0.01 } },
  { key: "initialSpeed", folder: "Spawn", rebuild: "last", opts: { min: 0, max: 1.0, step: 0.01 } },
  { key: "massMin", folder: "Spawn", rebuild: "last", opts: { min: 0.1, max: 10, step: 0.1 } },
  { key: "massMax", folder: "Spawn", rebuild: "last", opts: { min: 0.1, max: 30, step: 0.1 } },
  { key: "sizeScale", folder: "Appearance", opts: { min: 0, max: 0.02, step: 0.0001 } },
  { key: "minSize", folder: "Appearance", opts: { min: 0, max: 0.01, step: 0.0001 } },
  { key: "colorScale", folder: "Appearance", opts: { min: 0, max: 8, step: 0.01, label: "speed→color" } },
  { key: "colorLow", folder: "Appearance", opts: {} },
  { key: "colorHigh", folder: "Appearance", opts: {} },
  { key: "showQuadtree", folder: "Overlays", opts: { label: "quadtree" } },
  { key: "showCenterOfMass", folder: "Overlays", opts: { label: "centers of mass" } },
  { key: "showVelocity", folder: "Overlays", opts: { label: "velocity field" } },
  { key: "showProbe", folder: "Overlays", opts: { label: "probe interactions" } },
];
