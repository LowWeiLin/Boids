// ─── Render Shader ───────────────────────────────────────────────────────────
// Vertex-pulling from storage buffer; each boid = one triangle (3 verts).

struct Boid {
  pos      : vec2f,
  vel      : vec2f,
  boidType : f32,
  _pad     : f32,
}

struct RenderParams {
  width  : f32,
  height : f32,
  total  : u32,
  _pad   : u32,
}

@group(0) @binding(0) var<storage, read> boids : array<Boid>;
@group(0) @binding(1) var<uniform>       rp    : RenderParams;

struct VOut {
  @builtin(position) pos   : vec4f,
  @location(0)       color : vec4f,
}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VOut {
  let boidIdx = vi / 3u;
  let triVtx  = vi % 3u;

  let b   = boids[boidIdx];
  let spd = length(b.vel);

  // Forward direction (velocity normalised, default up)
  var fwd = vec2f(0.0, -1.0);
  if spd > 0.001 {
    fwd = b.vel / spd;
  }
  let rgt = vec2f(-fwd.y, fwd.x);

  // Predators are slightly larger
  let sz = select(4.5, 7.0, b.boidType > 0.5);

  // Triangle vertices in model space (tip forward, base behind)
  var lp : vec2f;
  if triVtx == 0u {
    lp = fwd * sz * 2.2;                 // tip
  } else if triVtx == 1u {
    lp = fwd * (-sz) + rgt * sz;        // rear-left
  } else {
    lp = fwd * (-sz) - rgt * sz;        // rear-right
  }

  let wp  = b.pos + lp;
  let ndc = vec2f(
    wp.x / rp.width  *  2.0 - 1.0,
    1.0 - wp.y / rp.height * 2.0,
  );

  // Blue for boids, red for predators
  let color = select(
    vec4f(0.25, 0.55, 0.95, 1.0),   // boid (false)
    vec4f(0.95, 0.22, 0.22, 1.0),   // predator (true)
    b.boidType > 0.5,
  );

  var o : VOut;
  o.pos   = vec4f(ndc, 0.0, 1.0);
  o.color = color;
  return o;
}

@fragment
fn fs_main(i : VOut) -> @location(0) vec4f {
  return i.color;
}
