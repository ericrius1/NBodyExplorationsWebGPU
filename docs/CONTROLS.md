# Controls

## Keyboard & pointer

| Input          | Action                                          |
| -------------- | ----------------------------------------------- |
| `/`            | toggle debug panel + overlays (default: on)     |
| `m`            | switch solver (naive ↔ Barnes–Hut)              |
| `p`            | pause / resume simulation                       |
| `r`            | re-seed particles                               |
| drag           | pan                                             |
| wheel          | zoom toward cursor                              |

## Single source of truth

Every tunable is declared once in `src/state.ts`: its default lives on the
`config` object, and its slider range / widget options live in the `CONTROLS`
table next to it. `ui/pane.ts` loops over `CONTROLS`, binds each entry into its
folder, and wires the rebuild behaviour. Adding a control is one `config` field
plus one `CONTROLS` row — defaults and ranges never drift apart. This follows the
pattern in [docs.md/tweakpane-controls.md](docs.md/tweakpane-controls.md).

`rebuild` semantics:

- `"last"` — reallocate GPU buffers on slider release only (`ev.last`); used for
  particle count and spawn parameters that re-seed the system.
- omitted — read fresh from `config` into the uniforms every frame; used for
  physics and appearance, which need no reallocation.

## Folders

**Simulation**
- `mode` — naive O(n²) or barnes-hut.
- `numParticles` — re-seeds on release.

**Physics**
- `gravity` — strength `G`.
- `dt` — integration time step.
- `softening` — `ε`, smooths close-range forces.
- `theta (BH)` — Barnes–Hut accuracy/speed trade-off (smaller = more accurate).
- `damping` — per-step velocity multiplier (1.0 = energy conserving). Default 0.999
  gently bleeds collapse energy.
- `max speed` — hard cap on velocity magnitude; prevents close-encounter
  slingshots. The main knob keeping motion graceful at high gravity.

**Spawn** (re-seed on release)
- `spawnRadius` — disk radius.
- `spin (orbit)` — fraction of the circular-orbit velocity each body is seeded
  with. `1.0` = balanced rotating disk that holds together; `0` = no rotation,
  pure gravitational collapse; `>1` = bodies fly outward.
- `dispersion` — random velocity spread (as a fraction of orbital speed); seeds
  the density fluctuations that grow into spiral/flocculent structure.
- `massMin`, `massMax` — mass range; drives both gravity and draw size.

`gravity` also re-seeds (it sets the orbital velocity scale), so changing it gives
a fresh balanced disk at a new rotation speed rather than collapsing the current
one.

**Appearance**
- `sizeScale`, `minSize` — disc radius (world units) from mass.
- `speed→color` — speed value mapped to the `colorLow`→`colorHigh` gradient.
- `colorLow`, `colorHigh` — gradient endpoints.

**Overlays**
- `quadtree`, `centers of mass`, `velocity field`, `probe interactions`.

**Metrics** (read-only, ~4 Hz)
- `fps`, `frame` (ms) with graphs.
- `compute` (ms) — GPU compute-pass time; only present with `timestamp-query`.
- `bh nodes` — current quadtree node count.
- `gpu buffers` — estimated buffer memory.
- `js heap` — only present where `performance.memory` exists (Chromium).
