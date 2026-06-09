struct RenderParams {
  center: vec2f,
  zoom: f32,
  aspect: f32,
  sizeScale: f32,
  minSize: f32,
  colorScale: f32,
  pad: f32,
  colorLow: vec4f,
  colorHigh: vec4f,
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> bodies: array<vec4f>;
@group(0) @binding(2) var<storage, read> mass: array<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = bodies[ii];
  let world = b.xy;
  let speed = length(b.zw);
  let m = mass[ii];
  let r = max(R.minSize, R.sizeScale * pow(m, 0.3333));
  let q = QUAD[vi];
  let wp = world + q * r;

  var o: VOut;
  o.pos = vec4f((wp.x - R.center.x) * R.zoom / R.aspect, (wp.y - R.center.y) * R.zoom, 0.0, 1.0);
  o.uv = q;
  let t = clamp(speed * R.colorScale, 0.0, 1.0);
  o.color = mix(R.colorLow.rgb, R.colorHigh.rgb, t);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  let a = smoothstep(1.0, 0.0, d);
  return vec4f(in.color * a, a);
}
