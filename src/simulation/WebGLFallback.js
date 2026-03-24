// ─── WebGL2 + CPU Fallback ────────────────────────────────────────────────
// Uses JavaScript for boid simulation and WebGL2 (or 2D Canvas) for rendering.

const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

// Per-vertex (triangle template, divisor = 0)
in vec2 aTriVert;

// Per-instance boid data (divisor = 1)
in vec2  aPos;
in vec2  aVel;
in float aType;

uniform vec2 uSize;

out vec4 vColor;

void main() {
  vec2 fwd = length(aVel) > 0.001 ? normalize(aVel) : vec2(0.0, -1.0);
  vec2 rgt = vec2(-fwd.y, fwd.x);
  float sz = aType > 0.5 ? 7.0 : 4.5;

  vec2 world = aPos + fwd * (aTriVert.y * sz) + rgt * (aTriVert.x * sz);
  gl_Position = vec4(
    world.x / uSize.x * 2.0 - 1.0,
    1.0 - world.y / uSize.y * 2.0,
    0.0, 1.0
  );
  vColor = aType > 0.5
    ? vec4(0.95, 0.22, 0.22, 1.0)
    : vec4(0.25, 0.55, 0.95, 1.0);
}
`

const FRAG_SRC = /* glsl */ `#version 300 es
precision mediump float;
in  vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vColor; }
`

// Triangle template in model space (tip forward, base behind)
const TRI_VERTS = new Float32Array([
   0.0,  2.2,   // tip
  -1.0, -1.0,   // rear-left
   1.0, -1.0,   // rear-right
])

export class WebGLFallback {
  constructor (canvas) {
    this.canvas       = canvas
    this.gl           = null
    this.ctx2d        = null   // ultimate fallback
    this.program      = null
    this.vao          = null
    this.triBuf       = null
    this.instanceBuf  = null
    this.uSizeLoc     = null

    this.boids        = []     // { x, y, vx, vy, type }
    this.numBoids     = 500
    this.numPredators = 5
    this.width        = 800
    this.height       = 600
    this.params = {
      separationWeight : 1.5,
      cohesionWeight   : 1.0,
      alignmentWeight  : 1.0,
      perceptionRadius : 50,
      maxSpeed         : 3.0,
    }
    this.obstacles    = []
    this.goals        = []
  }

  async init () {
    const gl = this.canvas.getContext('webgl2')
    if (gl) {
      this.gl = gl
      this._initGL()
    } else {
      // Ultimate fallback: plain 2D canvas
      this.ctx2d = this.canvas.getContext('2d')
    }
    this.width  = Math.max(1, this.canvas.width)
    this.height = Math.max(1, this.canvas.height)
    this._spawnBoids()
  }

  // ── WebGL2 setup ──────────────────────────────────────────────────────────
  _initGL () {
    const gl = this.gl
    const vs = this._compileShader(gl.VERTEX_SHADER,   VERT_SRC)
    const fs = this._compileShader(gl.FRAGMENT_SHADER, FRAG_SRC)

    this.program = gl.createProgram()
    gl.attachShader(this.program, vs)
    gl.attachShader(this.program, fs)
    gl.linkProgram(this.program)
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error('GL link error: ' + gl.getProgramInfoLog(this.program))

    this.uSizeLoc = gl.getUniformLocation(this.program, 'uSize')

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    // Triangle template buffer (shared vertices, divisor 0)
    this.triBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf)
    gl.bufferData(gl.ARRAY_BUFFER, TRI_VERTS, gl.STATIC_DRAW)
    const triLoc = gl.getAttribLocation(this.program, 'aTriVert')
    gl.enableVertexAttribArray(triLoc)
    gl.vertexAttribPointer(triLoc, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(triLoc, 0) // same for every instance vertex

    // Instance buffer (updated every frame, divisor 1)
    this.instanceBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf)
    const stride  = 6 * 4  // x y vx vy type pad
    const posLoc  = gl.getAttribLocation(this.program, 'aPos')
    const velLoc  = gl.getAttribLocation(this.program, 'aVel')
    const typeLoc = gl.getAttribLocation(this.program, 'aType')
    gl.enableVertexAttribArray(posLoc);  gl.vertexAttribPointer(posLoc,  2, gl.FLOAT, false, stride, 0);  gl.vertexAttribDivisor(posLoc,  1)
    gl.enableVertexAttribArray(velLoc);  gl.vertexAttribPointer(velLoc,  2, gl.FLOAT, false, stride, 8);  gl.vertexAttribDivisor(velLoc,  1)
    gl.enableVertexAttribArray(typeLoc); gl.vertexAttribPointer(typeLoc, 1, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(typeLoc, 1)

    gl.bindVertexArray(null)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  _compileShader (type, src) {
    const gl = this.gl
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw new Error('GL shader error: ' + gl.getShaderInfoLog(sh))
    return sh
  }

  // ── Boid initialisation ───────────────────────────────────────────────────
  _spawnBoids () {
    const total = this.numBoids + this.numPredators
    this.boids  = []
    for (let i = 0; i < total; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = (0.4 + Math.random() * 0.6) * this.params.maxSpeed
      this.boids.push({
        x    : Math.random() * this.width,
        y    : Math.random() * this.height,
        vx   : Math.cos(angle) * speed,
        vy   : Math.sin(angle) * speed,
        type : i < this.numBoids ? 0 : 1,
      })
    }
  }

  // ── Spatial grid (CPU) ────────────────────────────────────────────────────
  _buildGrid () {
    const pr   = Math.max(1, this.params.perceptionRadius)
    const gw   = Math.max(1, Math.ceil(this.width  / pr))
    const gh   = Math.max(1, Math.ceil(this.height / pr))
    const grid = new Array(gw * gh).fill(null).map(() => [])
    for (let i = 0; i < this.boids.length; i++) {
      const b  = this.boids[i]
      const cx = Math.floor(b.x / pr) % gw
      const cy = Math.floor(b.y / pr) % gh
      grid[cy * gw + cx].push(i)
    }
    return { grid, gw, gh, pr }
  }

  // Minimum Image Convention
  _minDiff (a, b, W) {
    let d = b - a
    if (d >  W * 0.5) d -= W
    if (d < -W * 0.5) d += W
    return d
  }

  // ── CPU boid update ───────────────────────────────────────────────────────
  _stepCPU (dt) {
    const { separationWeight, cohesionWeight, alignmentWeight, perceptionRadius, maxSpeed } = this.params
    const W  = this.width
    const H  = this.height
    const pr = Math.max(1, perceptionRadius)
    const { grid, gw, gh } = this._buildGrid()

    const next = this.boids.map((b, i) => {
      const cx = Math.floor(b.x / pr) % gw
      const cy = Math.floor(b.y / pr) % gh

      let sepX = 0, sepY = 0
      let cohX = 0, cohY = 0
      let aliX = 0, aliY = 0
      let nn   = 0

      let predAvX = 0, predAvY = 0

      let preyN  = 0, preyX = 0, preyY = 0

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ((cx + dx) % gw + gw) % gw
          const ny = ((cy + dy) % gh + gh) % gh
          const cell = grid[ny * gw + nx]
          for (const j of cell) {
            if (j === i) continue
            const o    = this.boids[j]
            const ddx  = this._minDiff(b.x, o.x, W)
            const ddy  = this._minDiff(b.y, o.y, H)
            const dist = Math.hypot(ddx, ddy)
            if (dist >= pr || dist < 0.0001) continue

            if (b.type === 0 && o.type === 0) {
              const sepR = pr * 0.35
              if (dist < sepR) {
                sepX -= ddx / (dist * dist + 0.01)
                sepY -= ddy / (dist * dist + 0.01)
              }
              cohX += ddx; cohY += ddy
              aliX += o.vx; aliY += o.vy
              nn++
            } else if (b.type === 0 && o.type === 1 && dist < pr * 1.6) {
              const w  = pr * 1.6 - dist
              predAvX -= (ddx / dist) * w
              predAvY -= (ddy / dist) * w
            } else if (b.type === 1 && o.type === 0) {
              preyN++; preyX += b.x + ddx; preyY += b.y + ddy
            }
          }
        }
      }

      let ax = 0, ay = 0

      if (b.type === 0) {
        const nc = Math.max(nn, 1)
        ax += sepX * separationWeight
        ay += sepY * separationWeight
        ax += (cohX / nc) * cohesionWeight * 0.015
        ay += (cohY / nc) * cohesionWeight * 0.015
        ax += (aliX / nc - b.vx) * alignmentWeight * 0.08
        ay += (aliY / nc - b.vy) * alignmentWeight * 0.08
        ax += predAvX * 2.5
        ay += predAvY * 2.5

        // Goal seeking
        for (const g of this.goals) {
          const gdx = this._minDiff(b.x, g.x, W)
          const gdy = this._minDiff(b.y, g.y, H)
          const gd  = Math.hypot(gdx, gdy)
          if (gd > 1) {
            ax += (gdx / gd) * (g.strength ?? 1) * 0.4
            ay += (gdy / gd) * (g.strength ?? 1) * 0.4
          }
        }
      } else {
        // Predator pursuit
        if (preyN > 0) {
          const pcx = preyX / preyN
          const pcy = preyY / preyN
          const pdx = this._minDiff(b.x, pcx, W)
          const pdy = this._minDiff(b.y, pcy, H)
          const pd  = Math.hypot(pdx, pdy)
          if (pd > 1) {
            const desired = { x: (pdx / pd) * maxSpeed * 1.25, y: (pdy / pd) * maxSpeed * 1.25 }
            ax += (desired.x - b.vx) * 0.07
            ay += (desired.y - b.vy) * 0.07
          }
        } else {
          ax += b.vx * -0.005
          ay += b.vy * -0.005
        }
      }

      // Obstacle avoidance
      for (const obs of this.obstacles) {
        let dist, nx2, ny2
        if (obs.type === 0) {
          const dx2  = b.x - obs.x; const dy2 = b.y - obs.y
          const d    = Math.hypot(dx2, dy2)
          dist = d - obs.radius
          nx2  = d > 0.001 ? dx2 / d : 1
          ny2  = d > 0.001 ? dy2 / d : 0
        } else {
          const dx2  = b.x - obs.x; const dy2 = b.y - obs.y
          const qx   = Math.abs(dx2) - obs.halfW; const qy = Math.abs(dy2) - obs.halfH
          dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
          nx2  = Math.abs(dx2) / Math.max(obs.halfW, 0.001) > Math.abs(dy2) / Math.max(obs.halfH, 0.001) ? Math.sign(dx2) : 0
          ny2  = nx2 === 0 ? Math.sign(dy2) : 0
        }
        const ar = pr * 0.7
        if (dist < ar) {
          const t = (ar - dist) / ar
          ax += nx2 * t * t * 5
          ay += ny2 * t * t * 5
        }
      }

      let nvx = b.vx + ax
      let nvy = b.vy + ay
      const maxSpd = b.type === 1 ? maxSpeed * 1.3 : maxSpeed
      const spd    = Math.hypot(nvx, nvy)
      if (spd > maxSpd && spd > 0.0001) { nvx = (nvx / spd) * maxSpd; nvy = (nvy / spd) * maxSpd }
      const minSpd = maxSpd * 0.08
      if (spd < minSpd && spd > 0.0001) { nvx = (nvx / spd) * minSpd; nvy = (nvy / spd) * minSpd }

      let nx3 = b.x + nvx * dt
      let ny3 = b.y + nvy * dt
      nx3 = ((nx3 % W) + W) % W
      ny3 = ((ny3 % H) + H) % H

      return { x: nx3, y: ny3, vx: nvx, vy: nvy, type: b.type }
    })

    this.boids = next
  }

  // ── Rendering (WebGL2) ────────────────────────────────────────────────────
  _renderGL () {
    const gl    = this.gl
    const total = this.boids.length
    gl.viewport(0, 0, this.width, this.height)
    gl.clearColor(0.04, 0.04, 0.08, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (total === 0) return

    // Pack instance data
    const data = new Float32Array(total * 6)
    for (let i = 0; i < total; i++) {
      const b = this.boids[i]
      data[i * 6 + 0] = b.x;  data[i * 6 + 1] = b.y
      data[i * 6 + 2] = b.vx; data[i * 6 + 3] = b.vy
      data[i * 6 + 4] = b.type
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)

    gl.useProgram(this.program)
    gl.uniform2f(this.uSizeLoc, this.width, this.height)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, total)
    gl.bindVertexArray(null)
  }

  // ── Rendering (2D Canvas fallback) ────────────────────────────────────────
  _render2D () {
    const ctx = this.ctx2d
    ctx.fillStyle = 'rgba(10, 10, 20, 1)'
    ctx.fillRect(0, 0, this.width, this.height)

    for (const b of this.boids) {
      const spd = Math.hypot(b.vx, b.vy)
      const fwdX = spd > 0.001 ? b.vx / spd :  0
      const fwdY = spd > 0.001 ? b.vy / spd : -1
      const sz   = b.type === 1 ? 7 : 4.5

      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.beginPath()
      ctx.moveTo( fwdX * sz * 2.2,               fwdY * sz * 2.2)
      ctx.lineTo(-fwdY * sz - fwdX * sz,          fwdX * sz - fwdY * sz)
      ctx.lineTo( fwdY * sz - fwdX * sz,         -fwdX * sz - fwdY * sz)
      ctx.closePath()
      ctx.fillStyle = b.type === 1 ? '#f43' : '#4af'
      ctx.fill()
      ctx.restore()
    }
  }

  // ── Public API (mirrors BoidSimulation) ───────────────────────────────────
  update (dt, params) {
    this.params = { ...this.params, ...params }
    this._stepCPU(Math.min(dt, 0.05))
    if (this.gl)    this._renderGL()
    else if (this.ctx2d) this._render2D()
  }

  resize (w, h) {
    this.width  = Math.max(1, w)
    this.height = Math.max(1, h)
  }

  setObstacles (obstacles) { this.obstacles = obstacles }
  setGoals     (goals)     { this.goals     = goals }
  updateParams (params)    { this.params    = { ...this.params, ...params } }

  setBoidCount (numBoids, numPredators) {
    this.numBoids     = Math.max(0, Math.min(numBoids,     5_000))
    this.numPredators = Math.max(0, Math.min(numPredators, 50))
    this._spawnBoids()
  }

  destroy () {
    const gl = this.gl
    if (!gl) return
    gl.deleteProgram(this.program)
    gl.deleteBuffer(this.triBuf)
    gl.deleteBuffer(this.instanceBuf)
    gl.deleteVertexArray(this.vao)
  }
}
