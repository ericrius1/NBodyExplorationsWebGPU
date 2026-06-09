# n-body · WebGPU

A 2D gravitational n-body simulation where **the algorithms are the product**.
Three force solvers implement the same physics at three levels of optimization —
naive **O(n²)**, **Barnes–Hut with a CPU-built quadtree**, and **Barnes–Hut with a
GPU-resident pyramid** — and you can switch between them live (`m`) while watching
cost, memory, and debug overlays change in real time.

The fastest solver sustains **millions of particles** on a laptop GPU. The README
below explains which ideas buy that speed, where each approach breaks down, and
what to look for in the overlays.

## The problem

Every body pulls on every other body. For `N` particles that is `N(N−1)/2` pairwise
interactions per timestep — **O(n²)** work and memory traffic if done naïvely. At
16k bodies that is ~130M pairs per step (fine). At 1M it is ~5×10¹¹ (minutes per
frame on a GPU). The only way past this wall is to **approximate distant clusters
as point masses** (Barnes–Hut) and to **keep the whole loop on the GPU** so you
are not paying for CPU↔GPU round-trips every frame.

## Physics (shared by all solvers)

Each particle `i` feels softened Newtonian gravity from every other particle `j`:

```
a_i = G · Σ_j  m_j · (p_j − p_i) / (|p_j − p_i|² + ε²)^{3/2}
v_i ← v_i + a_i·dt ;  v_i ← v_i · damping ;  clamp |v_i| ≤ maxSpeed ;  p_i ← v_i·dt
```

| Symbol | Control | Role |
| ------ | ------- | ---- |
| `G` | `gravity` | Force scale |
| `ε²` | `softening` | Plummer softening — keeps the denominator finite at close range. **ε is a length**, so it enters squared. |
| `damping` | `damping` | Bleeds kinetic energy from gravitational collapse (`1.0` = none) |
| `maxSpeed` | `maxSpeed` | Post-step velocity clamp — prevents one bad kick from teleporting a body across the screen |

The solvers differ **only** in how the sum over `j` is computed. Integration,
softening, damping, and clamping are identical across kernels.

### Initialization — balanced self-gravitating disk

Bodies spawn in a uniform-area disk (`r = R·√u`) with tangential velocities near
circular-orbit speed so the disk is self-gravitating instead of collapsing to a
point (`src/sim/initData.ts`):

```
M_enc(r) ≈ M_total · (r/R)²          (uniform area density)
v_circ   = √( G · M_enc / √(r² + ε²) )
v        = spin · v_circ  (tangential)  +  dispersion · v_circ · 𝒩(0,1)
```

`spin ≈ 1` balances infall; `dispersion` seeds spiral structure. Because
`v_circ` uses the same `G` as the solver, `gravity` acts as a rotation-speed
knob without re-tuning the seed.

## Solver comparison

| | Naive O(n²) | BH · CPU tree | BH · GPU pyramid |
| --- | --- | --- | --- |
| **Complexity** | O(n²) exact | O(n log n) approximate | O(n log n) approximate |
| **Tree build** | — | CPU, single-threaded | GPU, ~15 dispatches |
| **Force eval** | GPU tiled kernel | GPU tree walk | GPU implicit-tree walk |
| **GPU↔CPU** | none | readback + upload every frame | none (sim never leaves GPU) |
| **Structure** | — | adaptive quadtree (pointer array) | complete implicit pyramid (no pointers) |
| **Sweet spot** | reference / ≤ ~32k | teaching + overlays | production scale, 100k–1M+ |
| **Shader / code** | `naive.wgsl` | `quadtree.ts` + `barnes_hut.wgsl` | `pyramid.wgsl` + `pyramidPipeline.ts` |

Press `m` to cycle solvers and `o` to toggle the quadtree / probe overlays that
visualize what each algorithm is doing.

---

## 1. Naive O(n²) — the ground truth

Every particle sums the force from every other particle directly. No approximation;
this is the reference the other solvers are checked against.

### GPU tiling (`src/shaders/naive.wgsl`)

The kernel is still GPU-smart: each 256-thread workgroup cooperatively loads a
*tile* of 256 body positions into fast workgroup (shared) memory, every thread
accumulates forces against that tile, then the group loads the next tile. Each
body position is read from slow global memory **once per workgroup** instead of
once per thread — a **256× cut** in memory traffic. This is the classic tiled
n-body pattern (GPU Gems 3, ch. 31).

Self-interaction is harmless: the `j == i` term has zero direction. Padding lanes
carry mass 0.

Clever tiling does not change asymptotics: interaction count is still n². Tiling
buys a constant factor; Barnes–Hut buys a complexity class.

---

## 2. Barnes–Hut, CPU tree — better algorithm, wrong residence

### The Barnes–Hut idea

A distant *cluster* of bodies pulls on you almost exactly like a single point at
its centre of mass. Build a quadtree over space, store total mass + centre of mass
in each node, and when summing forces walk the tree from the root:

- If a node looks small from where you stand — **(cell width)² < θ² · (distance² + ε²)**
  (the multipole acceptance criterion, MAC) — accept it as one pseudo-body and skip
  its entire subtree.
- Otherwise open its children and continue.

Only nearby regions are resolved down to individual particles. Cost drops to
**O(n log n)**. Smaller `theta` = stricter = more accurate and slower.

### Tree build on CPU (`src/sim/quadtree.ts`)

`buildQuadTree` constructs an *adaptive* quadtree — cells subdivide only where
particles are:

- Bodies insert one at a time; an occupied leaf subdivides into four children.
- `MAX_DEPTH` caps subdivision (coincident points are dropped).
- A reverse pass accumulates mass and centre of mass; empty children prune to `-1`.
- Flattened to 32-byte GPU records: `{ com, mass, half, children[4] }`.

The overlays for this mode are especially instructive: green squares shrink where
particles cluster.

### Force on GPU (`src/shaders/barnes_hut.wgsl`)

One thread per body walks the tree with an explicit stack, applying the MAC at
each node.

### Why this solver stalls at scale

Every frame:

1. GPU copies all body positions back to the CPU (**readback**),
2. JavaScript builds the tree, single-threaded, chasing pointers,
3. nodes upload to the GPU again,
4. GPU walks the tree.

Steps 1–3 dominate past ~100k particles. Transfers are slow and high-latency; the
JS build is O(n) pointer-chasing; and because readback is asynchronous the GPU
integrates against a tree that is **a few frames stale**. The algorithm is right;
the **residence** is wrong.

---

## 3. Barnes–Hut, GPU pyramid — the whole loop on the GPU

The fix: never leave the GPU. The obstacle is that building a pointer-based
adaptive tree is deeply serial — awkward in a compute shader. This solver
(`src/shaders/pyramid.wgsl`, `src/sim/pyramidPipeline.ts`) changes the **data
structure** instead of porting the build: an **implicit complete quadtree**, i.e.
a mipmap pyramid of mass.

### Implicit indexing (no pointers)

A complete quadtree over a 2^F × 2^F grid needs no pointers. Children of cell
`(level, ix, iy)` are *by arithmetic* the four cells `(level+1, 2ix+dx, 2iy+dy)`.
Each level is a contiguous slab in one flat buffer — exactly like texture mipmaps.
No nodes allocated, no links written; the structure is implied by indexing.

Finest level `F` scales with particle count (`ceil(log₂ N / 2)`, clamped 5–10),
so grid resolution grows with fidelity.

### Per-substep GPU pipeline

```mermaid
flowchart LR
  A[clear_grid] --> B[reduce_bounds]
  B --> C[scatter]
  C --> D[resolve]
  D --> E[reduce × F levels]
  E --> F[force]
```

1. **Bounds** — parallel reduction finds the bounding square (grid always fits
   the world). Floats compared via atomics using an order-preserving float→u32
   bit trick (GPUs only provide integer atomic min/max).
2. **Scatter** — each particle atomically adds mass and mass-weighted offset into
   its grid cell. WGSL has no floating-point atomics, so values accumulate in
   **fixed-point** (scaled integers in, divided out on resolve). Scale is chosen
   from total mass so the worst case (all mass in one cell) cannot overflow u32.
3. **Resolve + reduce** — finest level converts sums to (centre of mass, mass) per
   cell; then F passes halve resolution, each parent combining four children —
   building every coarser level in log₂ steps, all parallel.
4. **Force** — each particle walks the implicit tree with a small on-stack array
   of packed `(level, ix, iy)` entries: accept if `w² < θ²·r²`, else push four
   children. At the finest level the particle's own cell would include itself, so
   its self-contribution is subtracted exactly before applying the cell's pull.

No readback, no JS, no staleness. Structure costs a fixed ~10–40 MB regardless of
clustering.

### Trade-off vs adaptive CPU tree

Resolution is **uniform** — the near field is only as fine as the finest pyramid
level (grid resolution scales with N; softening covers sub-cell scale). For a
real-time visual simulation that trade is heavily worth it.

**Measured on Apple Silicon @ 120 Hz:** ~0.2 ms/step at 16k, ~3 ms at 500k,
~9–14 ms at 1M — where naive would need minutes and the CPU-tree solver is
bound by round-trip. 1M particles × 8 substeps ≈ **600M particle-steps/second**.

---

## Supporting optimizations

Smaller than the solver change, but each one teaches something.

### Steps per frame

The sim used to advance once per rendered frame, locking speed to monitor refresh.
The `steps / frame` slider encodes K substeps into a **single compute pass** — the
GPU runs them back-to-back without waiting for vsync or the CPU. Cost is linear in
K.

### Total mass is constant; particle count is resolution

Particle masses normalize so the disk always weighs the same regardless of N.
Without this, doubling N doubled gravity and dynamics changed character — at ~1M
particles orbital speeds exceeded `maxSpeed`, the clamp silently drained kinetic
energy every step, and the disk collapsed. With normalization, N is purely a
fidelity knob: 16k and 2M produce the same physics, sampled more or less finely.

*General lesson: velocity clamps are energy sinks. If a system mysteriously
collapses, look for where energy leaves.*

### Solver-scoped memory

Each solver's buffers (pyramid levels, quadtree nodes, readback staging) allocate
only while that solver — or an overlay that needs them — is active, and free on
switch. The metrics panel shows per-buffer breakdown live.

### Know which pipeline is the bottleneck

At 1M+ particles the force solver may be ~10 ms but the **renderer** can be far
slower: a million large, alpha-blended, overlapping discs is a fill-rate (overdraw)
problem, not a compute problem. Shrink `sizeScale` / `minSize` and fps jumps.
The metrics panel separates compute time from frame time so you can tell which
side you are fighting.

### Ping-pong body buffers

Position and velocity live in one `vec4f` per body (`xy` pos, `zw` vel), halving
binding count. Compute reads `bodies[in]`, writes `bodies[out]`; indices swap each
step.

---

## What the overlays show

Overlays rebuild on the CPU each frame as line geometry (`src/render/overlayGeometry.ts`).

- **Quadtree** (green) — spatial structure of the active solver: adaptive cells in
  CPU-tree mode; uniform pyramid occupancy in GPU mode.
- **Probe** (yellow) — picks one body and draws a line to every cell it accepts as
  a single point mass, plus the cell itself. This is the MAC (`theta`) made visible
  — drag the slider and watch the far field coarsen.
- **Centre-of-mass** and **velocity-field** — optional extras.

In GPU-pyramid mode overlays come from a small CPU mirror of the pyramid, rebuilt
a few times per second via async readback. Overlays may lag the sim by a frame or
two; **the sim itself never waits**.

Particles render as additive soft discs; colour interpolates `colorLow` → `colorHigh`
by speed; radius scales with mass.

---

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

| Input          | Action                                              |
| -------------- | --------------------------------------------------- |
| `/`            | toggle debug panel + inspector                      |
| `o`            | toggle quadtree / probe overlays                    |
| `m`            | cycle solver (naive → BH CPU tree → BH GPU pyramid) |
| `p`            | pause / resume                                      |
| `r`            | re-seed simulation                                  |
| drag           | pan                                                 |
| scroll / wheel | zoom toward cursor                                  |

Everything else — particle count, steps per frame, gravity, time step, softening,
Barnes–Hut `theta`, spawn distribution, colours, sizes, overlays — is in the
Tweakpane panel. See [docs/CONTROLS.md](docs/CONTROLS.md).

## Further reading

- [docs/ALGORITHMS.md](docs/ALGORITHMS.md) — solvers and overlays in more detail.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, GPU buffers, frame loop.
- [docs/CONTROLS.md](docs/CONTROLS.md) — every tunable and the control table.

## Conventions

- Source comments are minimal — non-obvious constraints only. Rationale lives in
  these `.md` files.
- Shaders are raw `.wgsl` (`src/shaders/`), imported with Vite's `?raw`.
- Linting is oxlint, not eslint.
