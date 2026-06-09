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

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vs(@location(0) world: vec2f, @location(1) color: vec4f) -> VOut {
  var o: VOut;
  o.pos = vec4f((world.x - R.center.x) * R.zoom / R.aspect, (world.y - R.center.y) * R.zoom, 0.0, 1.0);
  o.color = color;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return in.color;
}
