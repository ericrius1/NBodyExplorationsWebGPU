# Algorithms

Both solvers integrate the same system: each body feels Newtonian gravity from
every other body, with a softening term to avoid singularities at close range.

```
a_i = G * Σ_j  m_j * (p_j - p_i) / (|p_j - p_i|² + ε²)^{3/2}
v_i += a_i · dt ;  v_i *= damping ;  clamp |v_i| ≤ maxSpeed ;  p_i += v_i · dt
```

`ε²` is the `softening` control, `damping` bleeds energy (1.0 = none). Both
solvers share one integrator (`integrate()` logic inlined in each kernel) with
two stability measures that keep motion graceful across the parameter space:

- **softening** keeps the `(r² + ε²)^{3/2}` denominator away from zero, so a close
  encounter can no longer produce a near-infinite force. Larger `ε` = softer,
  smoother cores.
- **maxSpeed** clamps the post-integration velocity magnitude, so even if a body
  does get a large kick it cannot slingshot across the screen in one step. This is
  what removes the "glitchy" teleporting at high gravity / small softening.

A mild `damping` (< 1) additionally bleeds the kinetic energy that gravitational
collapse converts from potential energy, so the system settles into flowing
structure instead of heating up into chaos. The two solvers differ only in how
the sum over `j` is computed.

## Naive O(n²) — `shaders/naive.wgsl`

One thread per body. To avoid `N` global-memory reads per thread, bodies are
streamed through workgroup shared memory in tiles of 256:

1. Each thread loads its own body.
2. The workgroup cooperatively loads a tile of 256 `(x, y, mass)` into
   `shared_pos`, with a barrier.
3. Every thread accumulates acceleration against all 256 cached bodies.
4. Advance to the next tile until all `N` are covered.

Self-interaction is harmless: the `j == i` term has zero direction, so it adds
nothing. Padding lanes carry mass 0 and contribute nothing. This is exact and
GPU-friendly but scales as `O(n²)` — great up to tens of thousands of bodies.

## Barnes–Hut — `sim/quadtree.ts` + `shaders/barnes_hut.wgsl`

Barnes–Hut approximates the force from a distant clump of bodies by a single
point mass at their centre of mass, reducing cost to `O(n log n)`.

### Tree build (CPU)

`buildQuadTree` constructs a quadtree over the bounding square of all bodies
using a flat, preallocated, array-of-structs layout (no per-node objects):

- Bodies are inserted one at a time. An occupied leaf subdivides into four
  children and pushes its existing body down; insertion then descends into the
  quadrant of the new body.
- `MAX_DEPTH` caps subdivision (coincident points are dropped rather than
  recursing forever).
- A single reverse pass over the node array (children always have higher indices
  than their parent) accumulates each node's total mass and centre of mass, and
  prunes empty children to `-1`.

The result is flattened into 32-byte records:

```
struct Node { com: vec2f, mass: f32, half: f32, children: vec4<i32> }
```

`children` are indices into the same array, or `-1`. A node is a leaf when all
four are `-1`.

### Traversal (GPU) — `shaders/barnes_hut.wgsl`

One thread per body walks the tree with an explicit stack starting at the root.
For each popped node it applies the **multipole acceptance criterion** (MAC):

```
accept if  (cell width)² < theta² · (distance² + ε²)
```

If the node is a leaf or passes the MAC, it is treated as one point mass and its
contribution is added. Otherwise its children are pushed and the walk continues.
Smaller `theta` = stricter = more accurate and slower; larger `theta` = more
approximate and faster.

### Why the tree is built on the CPU

Building a quadtree on the GPU (Morton codes + sort + hierarchy) is involved and
hard to visualise. Building on the CPU from a one-frame-stale readback keeps the
*force evaluation* — the expensive part — fully on the GPU while making the tree
trivially available for the overlays. The trade-off is that very large counts are
bottlenecked by CPU tree construction; the naive GPU kernel is the better choice
for raw particle counts.

## Overlays — `render/overlayGeometry.ts`

Overlays are line geometry rebuilt on the CPU each frame and drawn with a
line-list pipeline sharing the camera uniform.

- **Quadtree** — one square per node with mass, subsampled to a cell budget.
  Visualises adaptive subdivision: dense regions get fine cells.
- **Centres of mass** — a cross at each node's COM, sized by mass.
- **Velocity field** — a short segment per body along its velocity.
- **Probe** — picks the body farthest from the origin, re-runs the exact MAC walk
  on the CPU, and highlights every accepted cell plus a line from the body to that
  cell's COM. This is a direct picture of what the GPU traversal does for one
  body.
