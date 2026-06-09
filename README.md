# n-body · WebGPU

A 2D gravitational n-body simulation running entirely in WebGPU compute shaders.
Three force solvers — naive **O(n²)**, **Barnes–Hut with a CPU-built quadtree**,
and **Barnes–Hut with a GPU-resident pyramid** — with a live debug HUD and visual
overlays that show what each algorithm is actually doing.

The three solvers are kept side by side on purpose: they are the same physics at
three levels of optimization, and you can switch between them live (`m`) and watch
the cost change. The fastest one runs **millions of particles in real time**; the
sections below explain exactly which ideas buy that speed and why.

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

| Input          | Action                                                  |
| -------------- | ------------------------------------------------------- |
| `/`            | toggle the debug panel + inspector                      |
| `o`            | toggle the quadtree / probe overlays                    |
| `m`            | cycle solver (naive → BH CPU tree → BH GPU pyramid)     |
| `p`            | pause / resume                                          |
| `r`            | re-seed the simulation                                  |
| drag           | pan                                                     |
| scroll / wheel | zoom toward the cursor                                  |

Everything else — particle count, steps per frame, gravity, time step, softening,
Barnes–Hut `theta`, spawn distribution, colours, sizes, and which overlays are
visible — is adjustable in the Tweakpane panel. See
[docs/CONTROLS.md](docs/CONTROLS.md).

## The three solvers

All three integrate the same equations: every particle feels gravity from every
other particle, softened at close range so forces stay finite. They differ only
in how the force sum is approximated and where the work happens.

### 1. Naive O(n²) — the ground truth

Every particle sums the force from every other particle directly. No
approximation, so this is the reference the other solvers are checked against.

The kernel (`src/shaders/naive.wgsl`) is still GPU-smart about it: each
256-thread workgroup cooperatively loads a *tile* of 256 body positions into
fast workgroup (shared) memory, every thread accumulates forces against that
tile, then the group loads the next tile. Each body position is read from slow
global memory once per workgroup instead of once per thread — a 256× cut in
memory traffic. This tiling pattern is the classic first lesson of GPU n-body
(GPU Gems 3, ch. 31).

It doesn't matter how clever the kernel is, though: the interaction count is
n². At 16k particles that is 268M interactions per step — fine. At 1M it is
10¹² — seconds per frame. The only way past this wall is to stop computing
exact pairwise forces.

### 2. Barnes–Hut, CPU tree — better algorithm, wrong residence

Barnes–Hut's insight: a distant *cluster* of bodies pulls on you almost exactly
like a single point at its centre of mass. So build a quadtree over space, store
total mass + centre of mass in each node, and when summing forces walk the tree
from the root: if a node looks small from where you stand (its width `w` over
the distance `r` is below the threshold `theta`), accept it as one pseudo-body
and skip its entire subtree. Only nearby regions get opened down to individual
particles. The sum becomes O(n log n).

This solver (`src/sim/quadtree.ts` + `src/shaders/barnes_hut.wgsl`) builds an
*adaptive* quadtree — cells subdivide only where particles are — which is the
textbook formulation, and the overlays for it are worth watching.

But look at where the work lives. Every frame:

1. the GPU copies all body positions back to the CPU (readback),
2. JavaScript builds the tree, single-threaded, chasing pointers,
3. the nodes get uploaded to the GPU again,
4. the GPU walks the tree.

Steps 1–3 are the bottleneck. GPU↔CPU transfers are slow and high-latency, the
JS build is O(n) pointer-chasing, and because the readback is asynchronous the
GPU is always integrating against a tree that is a few frames stale. Past
~100k particles the algorithm is no longer the limit — the round-trip is.

### 3. Barnes–Hut, GPU pyramid — the whole loop on the GPU

The fix is to never leave the GPU. The obstacle is that building a
pointer-based adaptive tree is an awkward, deeply serial job to do in a
compute shader. So this solver (`src/shaders/pyramid.wgsl` +
`src/sim/pyramidPipeline.ts`) changes the data structure instead of porting
the build: it uses an **implicit complete quadtree**, i.e. a mipmap pyramid of
mass.

A complete quadtree over a 2^F × 2^F grid needs no pointers at all. The children
of cell `(level, ix, iy)` are *by arithmetic* the four cells
`(level+1, 2ix+dx, 2iy+dy)`, and each level is just a contiguous slab of one
flat buffer. No nodes are allocated, no links are written — the structure is
implied by indexing, exactly like texture mipmaps.

Each simulation substep runs this fully-GPU pipeline (~15 small dispatches, one
compute pass):

1. **Bounds** — a parallel reduction finds the bounding square of all particles
   (so the grid always fits the world, even after things fly apart). Floats are
   compared via atomics using an order-preserving float→u32 bit trick, since
   GPUs only provide integer atomic min/max.
2. **Scatter** — every particle atomically adds its mass and mass-weighted
   offset into its grid cell. WGSL has no floating-point atomics, so values are
   accumulated in **fixed-point**: scaled to integers on the way in, divided
   back out on the way out. The scale is chosen from the total mass so the
   worst case (all mass in one cell) cannot overflow 32 bits.
3. **Resolve + reduce** — the finest level converts those sums into
   (centre of mass, mass) per cell, then F successive passes halve the
   resolution, each parent combining its four children — building every coarser
   level of the pyramid, log₂ steps, all parallel.
4. **Force** — each particle walks the implicit tree with a small on-stack
   array of packed `(level, ix, iy)` entries: accept a cell as one point mass
   if `w² < θ²·r²`, otherwise push its four children. At the finest level the
   particle's *own* cell would include the particle itself, so its self
   contribution is subtracted exactly before applying the cell's pull.

No readback, no JS, no staleness — and the structure costs a fixed ~10–40 MB
regardless of how particles cluster. The trade against solver 2 is adaptivity:
resolution is uniform, so the near field is only as fine as the finest level
(the grid resolution scales with particle count, and softening covers the
sub-cell scale). For a real-time visual simulation that trade is heavily
worth it.

**Measured on this machine (Apple Silicon, 120 Hz):** ~0.2 ms/step at 16k,
~3 ms at 500k, ~9–14 ms at 1M — where the naive solver would need minutes and
the CPU-tree solver is bound by its round-trip. 1M particles × 8 substeps
sustains ~600M particle-steps/second.

## The supporting optimizations

These are smaller than the solver change but each one teaches something.

**Steps per frame.** The sim used to advance exactly once per rendered frame,
so simulation speed was locked to your monitor's refresh rate. Now the
`steps / frame` slider encodes K substeps into a single compute pass per frame
— the GPU runs them back-to-back without waiting for vsync or the CPU. Compute
cost is linear in K; if one step takes 1 ms you can afford a lot of them before
you miss a frame.

**Total mass is constant; particle count is resolution.** Particle masses are
normalized so the disk always weighs the same no matter how many particles
sample it. Without this, doubling the particle count doubled gravity, and the
dynamics changed character with N — at ~1M particles the spawn orbital speeds
exceeded the `max speed` clamp, the clamp silently drained kinetic energy every
step, and the whole disk death-spiralled into a point. With normalization, N
is purely a fidelity knob: 16k and 2M particles produce the same physics,
sampled more or less finely. (General lesson: velocity clamps are energy sinks;
if a system mysteriously collapses, look for where energy leaves.)

**Softening is a length, squared.** Close encounters are softened with the
standard Plummer form `r² + ε²`. An earlier version added un-squared `ε` to
`r²`, which made the slider behave nonphysically (its effect changed magnitude
with scale). Mind your units: ε is a length, so it enters the denominator
squared. ε also sets the scale below which the pyramid's uniform cells don't
need to resolve structure.

**Solver-scoped memory.** Each solver's buffers (pyramid levels, quadtree
nodes, readback staging) are allocated only while that solver — or an overlay
that needs them — is active, and freed on switch. The metrics panel shows the
per-buffer breakdown live, so you can watch memory move when you press `m`.

**Know which pipeline is the bottleneck.** At 1M+ particles the force solver is
~10 ms but the *renderer* can be far slower: a million large, alpha-blended,
overlapping discs is a fill-rate (overdraw) problem, not a compute problem.
Shrink `sizeScale`/`minSize` and fps jumps right back. The metrics panel
separates compute time from frame time precisely so you can tell which side of
the pipeline you're fighting — a 5-second frame with a 2 ms compute pass is a
rendering problem.

## What you are looking at

- **Particles** are drawn as additive soft discs on a black background. Colour is
  interpolated from `colorLow` → `colorHigh` by speed; radius scales with mass.
- **Quadtree overlay** (green) shows the active solver's spatial structure: the
  adaptive tree in CPU-tree mode (cells shrink where particles cluster), the
  uniform pyramid occupancy in GPU mode.
- **Probe overlay** (yellow) picks one body and draws a line to every cell it
  accepts as a single point mass, plus the cell itself. This is the
  multipole-acceptance criterion (`theta`) made visible — drag the slider and
  watch the far field coarsen.
- **Centre-of-mass** and **velocity-field** overlays are optional extras.

In GPU-pyramid mode the overlays come from a small CPU-side mirror of the
pyramid, rebuilt a few times per second from an asynchronous readback — the
overlays may lag the sim by a frame or two, the sim itself never waits.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, GPU buffers, frame loop, readback.
- [docs/ALGORITHMS.md](docs/ALGORITHMS.md) — the solvers and the overlays in detail.
- [docs/CONTROLS.md](docs/CONTROLS.md) — every tunable and the single-source control table.
- [docs/docs.md/tweakpane-controls.md](docs/docs.md/tweakpane-controls.md) — the UI pattern this project follows.

## Conventions

- Source comments are kept minimal — non-obvious constraints only. Longer
  rationale and teaching material live in these `.md` files.
- Shaders are raw **`.wgsl`** files (`src/shaders/`) imported with Vite's `?raw`
  so editors keep WGSL syntax highlighting.
- Linting is **oxlint**, not eslint.
