# Controls

## Keyboard & pointer

| Input          | Action                                          |
| -------------- | ----------------------------------------------- |
| `/`            | toggle debug panel + overlays (default: on)     |
| `m`            | switch solver (naive ↔ Barnes–Hut)              |
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
- `damping` — per-step velocity multiplier (1.0 = energy conserving).

**Spawn** (re-seed on release)
- `spawnRadius`, `initialSpeed` — disk size and tangential speed.
- `massMin`, `massMax` — mass range; drives both gravity and draw size.

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
