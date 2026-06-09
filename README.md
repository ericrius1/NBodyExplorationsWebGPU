# n-body · WebGPU

A 2D gravitational n-body simulation running entirely in WebGPU compute shaders.
Two force solvers — naive **O(n²)** and **Barnes–Hut** — with a live debug HUD and
visual overlays that show what each algorithm is actually doing.

![modes](docs/.gitkeep)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Requires a WebGPU-capable browser (Chrome / Edge 113+, recent Safari Technology
Preview, or Firefox Nightly with the flag). If WebGPU is missing the page shows a
notice instead of a blank canvas.

```bash
npm run build      # tsc --noEmit + vite build -> dist/
npm run preview    # serve the production build
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
```

## Controls

| Input            | Action                                              |
| ---------------- | --------------------------------------------------- |
| `/`              | toggle the debug panel + overlays (on by default)   |
| `m`              | switch solver (naive ↔ Barnes–Hut)                  |
| `r`              | re-seed the simulation                              |
| drag             | pan                                                 |
| scroll / wheel   | zoom toward the cursor                              |

Everything else — particle count, gravity, time step, softening, Barnes–Hut
`theta`, spawn distribution, colours, sizes, and which overlays are visible — is
adjustable in the Tweakpane panel. See [docs/CONTROLS.md](docs/CONTROLS.md).

## What you are looking at

- **Particles** are drawn as additive soft discs on a black background. Colour is
  interpolated from `colorLow` → `colorHigh` by speed; radius scales with mass.
- **Quadtree overlay** (green) shows Barnes–Hut spatial subdivision — cells shrink
  where particles cluster.
- **Probe overlay** (yellow) picks one body and draws a line to every cell it
  approximates as a single point mass, plus the cell itself. This is the
  multipole-acceptance criterion made visible.
- **Centre-of-mass** and **velocity-field** overlays are optional extras.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, GPU buffers, frame loop, readback.
- [docs/ALGORITHMS.md](docs/ALGORITHMS.md) — the two solvers and the overlays in detail.
- [docs/CONTROLS.md](docs/CONTROLS.md) — every tunable and the single-source control table.
- [docs/docs.md/tweakpane-controls.md](docs/docs.md/tweakpane-controls.md) — the UI pattern this project follows.

## Conventions

- Source has **no comments**; rationale and explanation live in these `.md` files.
- Shaders are raw **`.wgsl`** files (`src/shaders/`) imported with Vite's `?raw`
  so editors keep WGSL syntax highlighting.
- Linting is **oxlint**, not eslint.
