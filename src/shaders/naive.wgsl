struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
  theta: f32,
  damping: f32,
  maxSpeed: f32,
  pad1: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inBodies: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outBodies: array<vec4f>;
@group(0) @binding(3) var<storage, read> mass: array<f32>;

const TILE: u32 = 256u;
var<workgroup> shared_pos: array<vec3f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let valid = i < P.count;
  var pos = vec2f(0.0, 0.0);
  var vel = vec2f(0.0, 0.0);
  if (valid) {
    let b = inBodies[i];
    pos = b.xy;
    vel = b.zw;
  }

  var acc = vec2f(0.0, 0.0);
  let eps2 = P.softening * P.softening;
  let tiles = (P.count + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < tiles; t = t + 1u) {
    let j = t * TILE + lid.x;
    if (j < P.count) {
      let bj = inBodies[j];
      shared_pos[lid.x] = vec3f(bj.xy, mass[j]);
    } else {
      shared_pos[lid.x] = vec3f(0.0, 0.0, 0.0);
    }
    workgroupBarrier();

    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      let o = shared_pos[k];
      let d = o.xy - pos;
      let r2 = dot(d, d) + eps2;
      let inv = P.g * o.z / (r2 * sqrt(r2));
      acc = acc + d * inv;
    }
    workgroupBarrier();
  }

  if (valid) {
    vel = (vel + acc * P.dt) * P.damping;
    let sp = length(vel);
    if (sp > P.maxSpeed) {
      vel = vel * (P.maxSpeed / sp);
    }
    pos = pos + vel * P.dt;
    outBodies[i] = vec4f(pos, vel);
  }
}
