import binningShader   from './shaders/binning.wgsl?raw'
import boidLogicShader from './shaders/boidLogic.wgsl?raw'
import renderShader    from './shaders/render.wgsl?raw'

// ── Buffer-layout constants (must match WGSL structs) ──
const BOID_FLOATS     = 6   // pos(2) vel(2) type(1) pad(1)
const OBSTACLE_FLOATS = 8   // type x y param1 param2 pad*3
const GOAL_FLOATS     = 4   // x y strength pad

// ── Pre-allocated maximums ──
const MAX_TOTAL_BOIDS = 20_100   // 20 000 prey + 100 predators
const MAX_CELLS       = 65_536   // 256 × 256 grid
const MAX_PER_CELL    = 64
const MAX_OBSTACLES   = 64
const MAX_GOALS       = 16
const MAX_GRID_DIM    = 256

export class BoidSimulation {
  constructor (canvas) {
    this.canvas    = canvas
    this.device    = null
    this.context   = null
    this.format    = null

    // GPU buffers
    this.boidBufA        = null
    this.boidBufB        = null
    this.paramsBuf       = null
    this.cellCountBuf    = null
    this.cellBoidsBuf    = null
    this.obstacleBuf     = null
    this.goalBuf         = null
    this.renderParamsBuf = null

    // GPU pipelines
    this.binningPipeline  = null
    this.logicPipeline    = null
    this.renderPipeline   = null

    // Simulation state
    this.numBoids      = 500
    this.numPredators  = 5
    this.width         = 800
    this.height        = 600
    this.gridWidth     = 16
    this.gridHeight    = 12
    this.params = {
      separationWeight : 1.5,
      cohesionWeight   : 1.0,
      alignmentWeight  : 1.0,
      perceptionRadius : 50,
      maxSpeed         : 3.0,
    }
    this.obstacles   = []
    this.goals       = []
    this.initialized = false
  }

  // ── Public: initialise WebGPU ─────────────────────────────────────────────
  async init () {
    if (!navigator.gpu) throw new Error('WebGPU not supported')

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter available')

    this.device = await adapter.requestDevice()
    this.device.addEventListener('uncapturederror', ev =>
      console.error('[WebGPU device error]', ev.error))

    this.context = this.canvas.getContext('webgpu')
    if (!this.context) throw new Error('Cannot get WebGPU context from canvas')

    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.width  = Math.max(1, this.canvas.width)
    this.height = Math.max(1, this.canvas.height)

    this.context.configure({
      device    : this.device,
      format    : this.format,
      alphaMode : 'premultiplied',
    })

    this._createBuffers()
    await this._createPipelines()
    this._initBoids()
    this.initialized = true
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  _createBuffers () {
    const d    = this.device
    const bSz  = MAX_TOTAL_BOIDS * BOID_FLOATS * 4

    this.boidBufA = d.createBuffer({
      label : 'boids-A',
      size  : bSz,
      usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.boidBufB = d.createBuffer({
      label : 'boids-B',
      size  : bSz,
      usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Params uniform (16 × f32/u32 = 64 bytes)
    this.paramsBuf = d.createBuffer({
      label : 'params',
      size  : 64,
      usage : GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Spatial grid
    this.cellCountBuf = d.createBuffer({
      label : 'cellCount',
      size  : MAX_CELLS * 4,
      usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.cellBoidsBuf = d.createBuffer({
      label : 'cellBoids',
      size  : MAX_CELLS * MAX_PER_CELL * 4,
      usage : GPUBufferUsage.STORAGE,
    })

    this.obstacleBuf = d.createBuffer({
      label : 'obstacles',
      size  : Math.max(MAX_OBSTACLES * OBSTACLE_FLOATS * 4, 32),
      usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.goalBuf = d.createBuffer({
      label : 'goals',
      size  : Math.max(MAX_GOALS * GOAL_FLOATS * 4, 32),
      usage : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Render params uniform (16 bytes)
    this.renderParamsBuf = d.createBuffer({
      label : 'renderParams',
      size  : 16,
      usage : GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  async _createPipelines () {
    const d = this.device

    // Binning
    const binMod = d.createShaderModule({ label: 'binning', code: binningShader })
    this.binningPipeline = d.createComputePipeline({
      label   : 'binning-pipeline',
      layout  : 'auto',
      compute : { module: binMod, entryPoint: 'main' },
    })

    // Boid logic
    const logicMod = d.createShaderModule({ label: 'boidLogic', code: boidLogicShader })
    this.logicPipeline = d.createComputePipeline({
      label   : 'boidLogic-pipeline',
      layout  : 'auto',
      compute : { module: logicMod, entryPoint: 'main' },
    })

    // Render
    const renderMod = d.createShaderModule({ label: 'render', code: renderShader })
    this.renderPipeline = d.createRenderPipeline({
      label    : 'render-pipeline',
      layout   : 'auto',
      vertex   : { module: renderMod, entryPoint: 'vs_main' },
      fragment : {
        module  : renderMod,
        entryPoint : 'fs_main',
        targets : [{
          format : this.format,
          blend  : {
            color : { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha : { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive : { topology: 'triangle-list' },
    })

    // Surface any shader compilation errors
    for (const [name, mod] of [['binning', binMod], ['boidLogic', logicMod], ['render', renderMod]]) {
      const info = await mod.getCompilationInfo()
      for (const msg of info.messages) {
        if (msg.type === 'error')
          throw new Error(`[${name}] shader error at line ${msg.lineNum}: ${msg.message}`)
        if (msg.type === 'warning')
          console.warn(`[${name}] shader warning at line ${msg.lineNum}: ${msg.message}`)
      }
    }
  }

  _initBoids () {
    const total = this.numBoids + this.numPredators
    const data  = new Float32Array(MAX_TOTAL_BOIDS * BOID_FLOATS)
    for (let i = 0; i < total; i++) {
      const base  = i * BOID_FLOATS
      const angle = Math.random() * Math.PI * 2
      const speed = (0.4 + Math.random() * 0.6) * this.params.maxSpeed
      data[base + 0] = Math.random() * this.width
      data[base + 1] = Math.random() * this.height
      data[base + 2] = Math.cos(angle) * speed
      data[base + 3] = Math.sin(angle) * speed
      data[base + 4] = i < this.numBoids ? 0 : 1
      data[base + 5] = 0
    }
    this.device.queue.writeBuffer(this.boidBufA, 0, data)
  }

  _writeParamsBuffer (dt) {
    const p   = this.params
    const pr  = Math.max(1, p.perceptionRadius ?? 50)

    // Compute grid dimensions (capped to MAX_GRID_DIM)
    this.gridWidth  = Math.max(1, Math.min(MAX_GRID_DIM, Math.ceil(this.width  / pr)))
    this.gridHeight = Math.max(1, Math.min(MAX_GRID_DIM, Math.ceil(this.height / pr)))

    const buf = new ArrayBuffer(64)
    const f   = new Float32Array(buf)
    const u   = new Uint32Array(buf)
    u[0]  = this.numBoids + this.numPredators
    u[1]  = this.numPredators
    f[2]  = this.width
    f[3]  = this.height
    f[4]  = Math.min(dt, 0.05)
    f[5]  = p.separationWeight ?? 1.5
    f[6]  = p.cohesionWeight   ?? 1.0
    f[7]  = p.alignmentWeight  ?? 1.0
    f[8]  = pr
    f[9]  = p.maxSpeed ?? 3.0
    u[10] = Math.min(this.obstacles.length, MAX_OBSTACLES)
    u[11] = Math.min(this.goals.length,     MAX_GOALS)
    u[12] = this.gridWidth
    u[13] = this.gridHeight
    u[14] = 0
    u[15] = 0
    this.device.queue.writeBuffer(this.paramsBuf, 0, buf)
  }

  _writeRenderParamsBuffer () {
    const buf = new ArrayBuffer(16)
    const f   = new Float32Array(buf)
    const u   = new Uint32Array(buf)
    f[0] = this.width
    f[1] = this.height
    u[2] = this.numBoids + this.numPredators
    u[3] = 0
    this.device.queue.writeBuffer(this.renderParamsBuf, 0, buf)
  }

  // ── Public: per-frame update + render ────────────────────────────────────
  update (dt, params) {
    if (!this.initialized || !this.device) return
    this.params = { ...this.params, ...params }

    const total = this.numBoids + this.numPredators
    if (total === 0) return

    this._writeParamsBuffer(dt)
    this._writeRenderParamsBuffer()

    const encoder = this.device.createCommandEncoder({ label: 'frame' })

    // ── Pass 1a: clear cell counts ──
    const clearSize = this.gridWidth * this.gridHeight * 4
    encoder.clearBuffer(this.cellCountBuf, 0, clearSize)

    // ── Pass 1b: spatial binning ──
    {
      const bg = this.device.createBindGroup({
        layout  : this.binningPipeline.getBindGroupLayout(0),
        entries : [
          { binding: 0, resource: { buffer: this.boidBufA } },
          { binding: 1, resource: { buffer: this.paramsBuf } },
          { binding: 2, resource: { buffer: this.cellCountBuf } },
          { binding: 3, resource: { buffer: this.cellBoidsBuf } },
        ],
      })
      const pass = encoder.beginComputePass({ label: 'binning' })
      pass.setPipeline(this.binningPipeline)
      pass.setBindGroup(0, bg)
      pass.dispatchWorkgroups(Math.ceil(total / 64))
      pass.end()
    }

    // ── Pass 2: boid logic (A → B) ──
    {
      const bg = this.device.createBindGroup({
        layout  : this.logicPipeline.getBindGroupLayout(0),
        entries : [
          { binding: 0, resource: { buffer: this.boidBufA } },
          { binding: 1, resource: { buffer: this.boidBufB } },
          { binding: 2, resource: { buffer: this.paramsBuf } },
          { binding: 3, resource: { buffer: this.cellCountBuf } },
          { binding: 4, resource: { buffer: this.cellBoidsBuf } },
          { binding: 5, resource: { buffer: this.obstacleBuf } },
          { binding: 6, resource: { buffer: this.goalBuf } },
        ],
      })
      const pass = encoder.beginComputePass({ label: 'boidLogic' })
      pass.setPipeline(this.logicPipeline)
      pass.setBindGroup(0, bg)
      pass.dispatchWorkgroups(Math.ceil(total / 64))
      pass.end()
    }

    // ── Pass 3: render boids from B (just written) ──
    {
      const bg = this.device.createBindGroup({
        layout  : this.renderPipeline.getBindGroupLayout(0),
        entries : [
          { binding: 0, resource: { buffer: this.boidBufB } },
          { binding: 1, resource: { buffer: this.renderParamsBuf } },
        ],
      })
      const pass = encoder.beginRenderPass({
        label             : 'render',
        colorAttachments  : [{
          view       : this.context.getCurrentTexture().createView(),
          clearValue : { r: 0.04, g: 0.04, b: 0.08, a: 1.0 },
          loadOp     : 'clear',
          storeOp    : 'store',
        }],
      })
      pass.setPipeline(this.renderPipeline)
      pass.setBindGroup(0, bg)
      pass.draw(total * 3)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])

    // Ping-pong: B is now current
    ;[this.boidBufA, this.boidBufB] = [this.boidBufB, this.boidBufA]
  }

  // ── Public: resize canvas ─────────────────────────────────────────────────
  resize (w, h) {
    this.width  = Math.max(1, w)
    this.height = Math.max(1, h)
    if (this.context && this.device) {
      this.context.configure({
        device    : this.device,
        format    : this.format,
        alphaMode : 'premultiplied',
      })
    }
  }

  // ── Public: update obstacle data ─────────────────────────────────────────
  setObstacles (obstacles) {
    this.obstacles = obstacles
    if (!this.device) return
    const data = new Float32Array(MAX_OBSTACLES * OBSTACLE_FLOATS)
    const n    = Math.min(obstacles.length, MAX_OBSTACLES)
    for (let i = 0; i < n; i++) {
      const o    = obstacles[i]
      const base = i * OBSTACLE_FLOATS
      data[base + 0] = o.type === 0 ? 0 : 1
      data[base + 1] = o.x
      data[base + 2] = o.y
      data[base + 3] = o.type === 0 ? o.radius : o.halfW
      data[base + 4] = o.type === 0 ? 0        : o.halfH
    }
    this.device.queue.writeBuffer(this.obstacleBuf, 0, data)
  }

  // ── Public: update goal data ──────────────────────────────────────────────
  setGoals (goals) {
    this.goals = goals
    if (!this.device) return
    const data = new Float32Array(MAX_GOALS * GOAL_FLOATS)
    const n    = Math.min(goals.length, MAX_GOALS)
    for (let i = 0; i < n; i++) {
      const g    = goals[i]
      const base = i * GOAL_FLOATS
      data[base + 0] = g.x
      data[base + 1] = g.y
      data[base + 2] = g.strength ?? 1.0
    }
    this.device.queue.writeBuffer(this.goalBuf, 0, data)
  }

  // ── Public: params (weights etc.) ─────────────────────────────────────────
  updateParams (params) {
    this.params = { ...this.params, ...params }
  }

  // ── Public: change boid / predator count ──────────────────────────────────
  setBoidCount (numBoids, numPredators) {
    this.numBoids     = Math.max(0, Math.min(numBoids,     20_000))
    this.numPredators = Math.max(0, Math.min(numPredators, 100))
    if (!this.device) return
    // Re-scatter all agents in the scene
    this._initBoids()
  }

  // ── Public: cleanup ───────────────────────────────────────────────────────
  destroy () {
    this.initialized = false
    ;[
      this.boidBufA, this.boidBufB, this.paramsBuf,
      this.cellCountBuf, this.cellBoidsBuf,
      this.obstacleBuf, this.goalBuf, this.renderParamsBuf,
    ].forEach(b => b?.destroy())
    this.context?.unconfigure()
    this.device?.destroy()
  }
}
