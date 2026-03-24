// ─── Boid Logic Pass ────────────────────────────────────────────────────────
// Reads from boidsIn + spatial grid, writes updated state to boidsOut.
// Uses Minimum Image Convention for toroidal (wrap-around) topology.

struct Boid {
  pos      : vec2f,
  vel      : vec2f,
  boidType : f32,
  _pad     : f32,
}

struct Params {
  numBoids        : u32,
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

struct Obstacle {
  obsType : f32,   // 0 = circle, 1 = box
  x       : f32,
  y       : f32,
  param1  : f32,   // radius (circle) | halfW (box)
  param2  : f32,   // 0 (circle)      | halfH (box)
  _p1     : f32,
  _p2     : f32,
  _p3     : f32,
}

struct Goal {
  x        : f32,
  y        : f32,
  strength : f32,
  _pad     : f32,
}

@group(0) @binding(0) var<storage, read>       boidsIn   : array<Boid>;
@group(0) @binding(1) var<storage, read_write> boidsOut  : array<Boid>;
@group(0) @binding(2) var<uniform>             params    : Params;
@group(0) @binding(3) var<storage, read>       cellCount : array<u32>;
@group(0) @binding(4) var<storage, read>       cellBoids : array<u32>;
@group(0) @binding(5) var<storage, read>       obstacles : array<Obstacle>;
@group(0) @binding(6) var<storage, read>       goals     : array<Goal>;

const MAX_PER_CELL : u32 = 64u;

// Minimum Image Convention – shortest vector on torus
fn toroidalDiff(from_p : vec2f, to_p : vec2f, sz : vec2f) -> vec2f {
  var d = to_p - from_p;
  if d.x >  sz.x * 0.5 { d.x -= sz.x; }
  else if d.x < -sz.x * 0.5 { d.x += sz.x; }
  if d.y >  sz.y * 0.5 { d.y -= sz.y; }
  else if d.y < -sz.y * 0.5 { d.y += sz.y; }
  return d;
}

// Returns a repulsion vector away from all obstacles
fn obstacleForce(pos : vec2f) -> vec2f {
  var force    = vec2f(0.0);
  let avoidR   = params.perceptionRadius * 0.7;

  for (var i = 0u; i < params.numObstacles; i = i + 1u) {
    let obs    = obstacles[i];
    let center = vec2f(obs.x, obs.y);
    var sdf    : f32;
    var normal : vec2f;

    if obs.obsType < 0.5 {
      // Circle SDF
      let dp  = pos - center;
      let d   = length(dp);
      sdf     = d - obs.param1;
      normal  = select(vec2f(1.0, 0.0), dp / d, d > 0.001);
    } else {
      // Box SDF
      let dp  = pos - center;
      let q   = abs(dp) - vec2f(obs.param1, obs.param2);
      let ext = length(max(q, vec2f(0.0)));
      sdf     = ext + min(max(q.x, q.y), 0.0);
      // Approximate outward normal
      if abs(dp.x) / max(obs.param1, 0.001) > abs(dp.y) / max(obs.param2, 0.001) {
        normal = vec2f(sign(dp.x), 0.0);
      } else {
        normal = vec2f(0.0, sign(dp.y));
      }
    }

    if sdf < avoidR {
      let t = (avoidR - sdf) / avoidR;
      force += normal * t * t * 5.0;
    }
  }
  return force;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i     = gid.x;
  let total = params.numBoids;
  if i >= total { return; }

  let boid   = boidsIn[i];
  let pos    = boid.pos;
  let vel    = boid.vel;
  let isBoid = boid.boidType < 0.5;
  let sz     = vec2f(params.width, params.height);
  let cs     = params.perceptionRadius;
  let gw     = i32(params.gridWidth);
  let gh     = i32(params.gridHeight);
  let cx     = i32(floor(pos.x / cs));
  let cy     = i32(floor(pos.y / cs));

  // Per-rule accumulators
  var sepForce = vec2f(0.0);
  var cohSum   = vec2f(0.0);
  var aliSum   = vec2f(0.0);
  var predAvoid= vec2f(0.0);
  var neighborN= 0u;
  var predN    = 0u;

  // Predator: track nearby prey centre
  var preyN    = 0u;
  var preySum  = vec2f(0.0);

  // 3 × 3 grid neighbourhood with toroidal wrapping
  for (var dy : i32 = -1; dy <= 1; dy = dy + 1) {
    for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
      let nx      = ((cx + dx) % gw + gw) % gw;
      let ny      = ((cy + dy) % gh + gh) % gh;
      let cellIdx = u32(ny) * params.gridWidth + u32(nx);
      let cnt     = min(cellCount[cellIdx], MAX_PER_CELL);

      for (var k = 0u; k < cnt; k = k + 1u) {
        let j = cellBoids[cellIdx * MAX_PER_CELL + k];
        if j == i { continue; }

        let other     = boidsIn[j];
        let diff      = toroidalDiff(pos, other.pos, sz);
        let dist      = length(diff);

        if dist >= cs || dist < 0.0001 { continue; }

        let otherIsBoid = other.boidType < 0.5;

        if isBoid && otherIsBoid {
          // ── Flocking rules ──
          let sepR = cs * 0.35;
          if dist < sepR {
            sepForce -= diff / (dist * dist + 0.01);
          }
          cohSum   += diff;
          aliSum   += other.vel;
          neighborN = neighborN + 1u;

        } else if isBoid && !otherIsBoid {
          // ── Boid evades predator (extended radius) ──
          if dist < cs * 1.6 {
            let w      = cs * 1.6 - dist;
            predAvoid -= normalize(diff) * w;
            predN      = predN + 1u;
          }

        } else if !isBoid && otherIsBoid {
          // ── Predator tracks prey ──
          preyN   = preyN + 1u;
          preySum = preySum + (pos + diff); // world-space prey pos
        }
      }
    }
  }

  var newVel = vel;

  if isBoid {
    let nc = f32(max(neighborN, 1u));

    // Separation
    newVel += sepForce * params.separationWeight;
    // Cohesion: steer toward local centre
    newVel += (cohSum / nc) * params.cohesionWeight * 0.015;
    // Alignment: match neighbours' velocity
    newVel += (aliSum / nc - vel) * params.alignmentWeight * 0.08;

    // Predator avoidance
    if predN > 0u {
      newVel += predAvoid * 2.5;
    }

    // Goal seeking
    for (var g = 0u; g < params.numGoals; g = g + 1u) {
      let gp   = vec2f(goals[g].x, goals[g].y);
      let gd   = toroidalDiff(pos, gp, sz);
      let gdst = length(gd);
      if gdst > 1.0 {
        newVel += normalize(gd) * goals[g].strength * 0.4;
      }
    }

  } else {
    // ── Predator: pursue prey flock centre ──
    if preyN > 0u {
      let preyCenter = preySum / f32(preyN);
      let pd         = toroidalDiff(pos, preyCenter, sz);
      let pdst       = length(pd);
      if pdst > 1.0 {
        let desired = normalize(pd) * params.maxSpeed * 1.25;
        newVel     += (desired - vel) * 0.07;
      }
    } else {
      newVel *= 0.995; // slow wandering
    }
  }

  // Obstacle avoidance for all agents
  newVel += obstacleForce(pos);

  // ── Speed clamping ──
  let maxSpd = select(params.maxSpeed, params.maxSpeed * 1.3, !isBoid);
  let spd    = length(newVel);
  if spd > maxSpd && spd > 0.0001 {
    newVel = (newVel / spd) * maxSpd;
  }
  let minSpd = maxSpd * 0.08;
  if spd < minSpd && spd > 0.0001 {
    newVel = (newVel / spd) * minSpd;
  }

  // ── Toroidal position update ──
  var newPos = pos + newVel * params.dt;
  newPos.x   = ((newPos.x % params.width)  + params.width)  % params.width;
  newPos.y   = ((newPos.y % params.height) + params.height) % params.height;

  boidsOut[i] = Boid(newPos, newVel, boid.boidType, 0.0);
}
