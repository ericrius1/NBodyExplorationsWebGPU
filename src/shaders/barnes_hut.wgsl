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

struct Node {
  com: vec2f,
  mass: f32,
  half: f32,
  children: vec4<i32>,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inBodies: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outBodies: array<vec4f>;
@group(0) @binding(3) var<storage, read> nodes: array<Node>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }

  let b = inBodies[i];
  let pos = b.xy;
  var vel = b.zw;
  var acc = vec2f(0.0, 0.0);

  let theta2 = P.theta * P.theta;

  var stack: array<i32, 64>;
  var sp: i32 = 0;
  stack[0] = 0;
  sp = 1;

  loop {
    if (sp == 0) {
      break;
    }
    sp = sp - 1;
    let n = nodes[stack[sp]];

    let d = n.com - pos;
    let r2 = dot(d, d) + P.softening;
    let w = n.half * 2.0;
    let leaf = n.children.x < 0 && n.children.y < 0 && n.children.z < 0 && n.children.w < 0;

    if (leaf || (w * w < theta2 * r2)) {
      let inv = P.g * n.mass / (r2 * sqrt(r2));
      acc = acc + d * inv;
    } else {
      if (n.children.x >= 0 && sp < 64) { stack[sp] = n.children.x; sp = sp + 1; }
      if (n.children.y >= 0 && sp < 64) { stack[sp] = n.children.y; sp = sp + 1; }
      if (n.children.z >= 0 && sp < 64) { stack[sp] = n.children.z; sp = sp + 1; }
      if (n.children.w >= 0 && sp < 64) { stack[sp] = n.children.w; sp = sp + 1; }
    }
  }

  vel = (vel + acc * P.dt) * P.damping;
  let spd = length(vel);
  if (spd > P.maxSpeed) {
    vel = vel * (P.maxSpeed / spd);
  }
  let np = pos + vel * P.dt;
  outBodies[i] = vec4f(np, vel);
}
