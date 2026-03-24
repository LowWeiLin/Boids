// ─── Spatial-Grid Binning Pass ──────────────────────────────────────────────
// Clears are done via encoder.clearBuffer before dispatch.
// Each boid atomically claims a slot in its grid cell.

struct Boid {
  pos      : vec2f,
  vel      : vec2f,
  boidType : f32,
  _pad     : f32,
}

struct Params {
  numBoids        : u32,   // total = boids + predators
  numPredators    : u32,
  width           : f32,
  height          : f32,
  dt              : f32,
  separationWeight: f32,
  cohesionWeight  : f32,
  alignmentWeight : f32,
  perceptionRadius: f32,
  maxSpeed        : f32,
  numObstacles    : u32,
  numGoals        : u32,
  gridWidth       : u32,
  gridHeight      : u32,
  _pad1           : u32,
  _pad2           : u32,
}

@group(0) @binding(0) var<storage, read>       boids     : array<Boid>;
@group(0) @binding(1) var<uniform>             params    : Params;
@group(0) @binding(2) var<storage, read_write> cellCount : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cellBoids : array<u32>;

const MAX_PER_CELL : u32 = 64u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if i >= params.numBoids { return; }

  let pos = boids[i].pos;
  let cs  = params.perceptionRadius;

  // Clamp to valid cell range
  let rawX = floor(pos.x / cs);
  let rawY = floor(pos.y / cs);
  let cx   = u32(clamp(rawX, 0.0, f32(params.gridWidth  - 1u)));
  let cy   = u32(clamp(rawY, 0.0, f32(params.gridHeight - 1u)));

  let cellIdx = cy * params.gridWidth + cx;

  let slot = atomicAdd(&cellCount[cellIdx], 1u);
  if slot < MAX_PER_CELL {
    cellBoids[cellIdx * MAX_PER_CELL + slot] = i;
  }
}
