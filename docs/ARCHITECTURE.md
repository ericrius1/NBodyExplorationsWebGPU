# Architecture

## Module map

```
src/
  main.ts                 entry: init GPU, build pane, wire input, run rAF loop
  state.ts                Config object + CONTROLS table (single source of truth)
  engine.ts               orchestrator: buffers, pipelines, frame loop, readback
  gpu/
    context.ts            adapter/device/canvas setup, capability probe, resize
  sim/
    initData.ts           particle seeding (disk + tangential velocity)
    quadtree.ts           CPU quadtree build + flatten to GPU node array
    naivePipeline.ts      O(n^2) compute pipeline
    bhPipeline.ts         Barnes-Hut compute pipeline
  render/
    camera.ts             pan/zoom state and math
    particlePipeline.ts   instanced additive disc rendering
    overlayPipeline.ts    line-list pipeline for debug overlays
    overlayGeometry.ts    builds overlay line vertices on the CPU
  ui/
    pane.ts               Tweakpane construction from CONTROLS + metrics rows
    metrics.ts            frame/fps EMA, JS heap probe
    input.ts              keyboard + pointer + wheel handlers
  shaders/*.wgsl          raw WGSL (imported with ?raw)
```

`Engine` is the only stateful coordinator. Everything else is a pure factory or
data helper, which keeps pipelines and shaders swappable.

## GPU buffers

| Buffer            | Type                  | Notes                                        |
| ----------------- | --------------------- | -------------------------------------------- |
| `bodies[0/1]`     | storage, vec4 / body  | `xy` = position, `zw` = velocity. Ping-pong. |
| `mass`            | storage, f32 / body   | static per re-seed                           |
| `nodesBuf`        | storage, 32 B / node  | flattened quadtree, grows on demand          |
| `simParams`       | uniform, 32 B         | count, dt, g, softening, theta, damping      |
| `renderParams`    | uniform, 64 B         | camera + appearance for both render passes   |
| `overlayBuf`      | vertex, dynamic       | `x,y,r,g,b,a` per vertex, rewritten each frame |
| `bodyStaging`     | map-read              | readback target for CPU tree/overlay         |
| `ts*`             | query/resolve/map     | timestamp-query, only if supported           |

A body is one `vec4f`. Storing position and velocity together halves binding
count and lets the integrator write a single value.

## Frame loop (`Engine.frame`)

1. Resize canvas to device pixels; recompute aspect.
2. Upload `simParams` and `renderParams`.
3. **Compute pass** reads `bodies[input]`, writes `bodies[1-input]`. Picks the BH
   pipeline only when a tree has been uploaded, otherwise the naive pipeline. A
   `timestampWrites` pair brackets the pass when supported.
4. Swap the ping-pong index so the freshly written buffer becomes current.
5. Resolve timestamps into a map-read buffer.
6. **Render pass** clears to black, draws particles instanced (6 verts × N), then
   — when debug is on — uploads and draws the overlay line buffer.
7. Submit, then kick off async work that must not block the queue:
   - `scheduleReadback` copies the current bodies into `bodyStaging` and maps it.
   - `readTimestamps` maps the timestamp buffer and converts the delta to ms.
8. Update metrics; refresh the pane at ~4 Hz.

## Ping-pong integration

Two body buffers alternate as input/output each frame, so the compute shader
never reads and writes the same memory. Bind groups are pre-built for both
directions (`group[input]`); the engine just toggles `cur`.

## CPU readback for Barnes–Hut

The simulation state is authoritative on the GPU. Barnes–Hut needs positions on
the CPU to build the quadtree, and the overlays need them to draw. Rather than
stall the pipeline, the engine copies the current bodies into a `MAP_READ`
staging buffer and maps it asynchronously. When the map resolves it:

1. copies positions into a reused `Float32Array`,
2. rebuilds the quadtree (`sim/quadtree.ts`),
3. grows `nodesBuf` if needed and uploads the flattened tree,
4. picks a probe body for the overlay.

This makes the tree (and overlays) lag the simulation by ~1 frame, which is
invisible at interactive rates and avoids a GPU→CPU stall. Readback only runs
when something needs it: Barnes–Hut mode, or a CPU-dependent overlay being on.
Until the first tree arrives, BH mode falls back to the naive kernel so motion
starts immediately.

## Capability degradation

`timestamp-query` and `performance.memory` are both optional. The device is
requested with the timestamp feature only if the adapter advertises it, and the
corresponding metric rows are added only when available — see
[docs/docs.md/tweakpane-controls.md](docs.md/tweakpane-controls.md).
