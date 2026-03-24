<script>
  import { onMount } from 'svelte'
  import ControlPanel from './components/ControlPanel.svelte'
  import { BoidSimulation } from './simulation/BoidSimulation.js'
  import { WebGLFallback } from './simulation/WebGLFallback.js'

  // ── DOM references (non-reactive) ──────────────────────────────────────────
  let gpuCanvas     // WebGPU / WebGL2 canvas
  let overlayCanvas // 2D canvas overlay (grid, goals, obstacles)

  // ── Reactive simulation params ─────────────────────────────────────────────
  let boidCount        = $state(500)
  let predatorCount    = $state(5)
  let separationWeight = $state(1.5)
  let cohesionWeight   = $state(1.0)
  let alignmentWeight  = $state(1.0)
  let perceptionRadius = $state(50)
  let maxSpeed         = $state(3.0)
  let showGrid         = $state(false)
  let debugVectors     = $state(false)
  let activeTool       = $state('none')
  let goals            = $state([])
  let obstacles        = $state([])

  let fps       = $state(0)
  let gpuStatus = $state('Initialising…')

  // ── Private mutable state (not reactive) ──────────────────────────────────
  let simulation  = null
  let animFrame   = null
  let prevTime    = 0
  let frameCount  = 0
  let fpsAccum    = 0
  let dragTarget  = null
  let dragType    = null

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getParams () {
    return { separationWeight, cohesionWeight, alignmentWeight, perceptionRadius, maxSpeed }
  }

  // ── Effects: keep simulation in sync with UI state ─────────────────────────
  $effect(() => {
    const n = boidCount, p = predatorCount
    simulation?.setBoidCount(n, p)
  })

  $effect(() => {
    const g = goals
    simulation?.setGoals(g)
  })

  $effect(() => {
    const o = obstacles
    simulation?.setObstacles(o)
  })

  // ── Mouse / pointer interaction ────────────────────────────────────────────
  function canvasXY (e) {
    const r = gpuCanvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function handlePointerDown (e) {
    gpuCanvas.setPointerCapture(e.pointerId)
    const { x, y } = canvasXY(e)

    if (activeTool === 'addGoal') {
      goals      = [...goals, { x, y, strength: 1.0 }]
      activeTool = 'none'
      return
    }
    if (activeTool === 'addObstacle') {
      obstacles  = [...obstacles, { type: 0, x, y, radius: 40 }]
      activeTool = 'none'
      return
    }
    if (activeTool === 'addBoxObs') {
      obstacles  = [...obstacles, { type: 1, x, y, halfW: 50, halfH: 35 }]
      activeTool = 'none'
      return
    }
    if (activeTool === 'moveGoal') {
      let best = -1, bestD = 30
      goals.forEach((g, i) => {
        const d = Math.hypot(g.x - x, g.y - y)
        if (d < bestD) { bestD = d; best = i }
      })
      if (best >= 0) { dragTarget = best; dragType = 'goal' }
      return
    }
    if (activeTool === 'moveObstacle') {
      let best = -1, bestD = 60
      obstacles.forEach((o, i) => {
        const d = Math.hypot(o.x - x, o.y - y)
        if (d < bestD) { bestD = d; best = i }
      })
      if (best >= 0) { dragTarget = best; dragType = 'obstacle' }
    }
  }

  function handlePointerMove (e) {
    if (dragTarget === null) return
    const { x, y } = canvasXY(e)
    if (dragType === 'goal') {
      goals = goals.map((g, i) => i === dragTarget ? { ...g, x, y } : g)
    } else if (dragType === 'obstacle') {
      obstacles = obstacles.map((o, i) => i === dragTarget ? { ...o, x, y } : o)
    }
  }

  function handlePointerUp () {
    dragTarget = null
    dragType   = null
  }

  // ── Overlay drawing ────────────────────────────────────────────────────────
  function drawOverlay () {
    if (!overlayCanvas) return
    const ctx = overlayCanvas.getContext('2d')
    const W   = overlayCanvas.width
    const H   = overlayCanvas.height
    ctx.clearRect(0, 0, W, H)

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(70,70,180,0.18)'
      ctx.lineWidth   = 0.5
      const cs = perceptionRadius
      for (let x = 0; x <= W; x += cs) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      for (let y = 0; y <= H; y += cs) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }
    }

    // Goals
    for (const g of goals) {
      ctx.beginPath()
      ctx.arc(g.x, g.y, 14, 0, Math.PI * 2)
      ctx.fillStyle   = 'rgba(255,200,20,0.3)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,200,20,0.9)'
      ctx.lineWidth   = 1.5
      ctx.stroke()
      ctx.fillStyle     = '#ffe'
      ctx.font          = 'bold 13px sans-serif'
      ctx.textAlign     = 'center'
      ctx.textBaseline  = 'middle'
      ctx.fillText('★', g.x, g.y)
    }

    // Obstacles
    for (const o of obstacles) {
      ctx.fillStyle   = 'rgba(200,110,50,0.4)'
      ctx.strokeStyle = 'rgba(220,140,80,0.85)'
      ctx.lineWidth   = 1.5
      if (o.type === 0) {
        ctx.beginPath()
        ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.rect(o.x - o.halfW, o.y - o.halfH, o.halfW * 2, o.halfH * 2)
        ctx.fill(); ctx.stroke()
      }
    }

    // Debug velocity vectors (CPU fallback or when enabled)
    if (debugVectors && simulation?.boids) {
      ctx.strokeStyle = 'rgba(100,255,150,0.55)'
      ctx.lineWidth   = 1
      for (const b of simulation.boids) {
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x + b.vx * 5, b.y + b.vy * 5)
        ctx.stroke()
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onMount(() => {
    async function setup () {
      const panelW = 270
      const W = Math.max(1, window.innerWidth  - panelW)
      const H = Math.max(1, window.innerHeight)
      gpuCanvas.width     = W; gpuCanvas.height     = H
      overlayCanvas.width = W; overlayCanvas.height = H

      // Attempt WebGPU first
      if (navigator.gpu) {
        try {
          simulation = new BoidSimulation(gpuCanvas)
          await simulation.init()
          gpuStatus  = '⚡ WebGPU'
        } catch (err) {
          console.warn('[App] WebGPU init failed, using CPU fallback:', err.message)
          simulation = null
        }
      }

      // Fall back to WebGL2 / 2D canvas CPU sim
      if (!simulation) {
        simulation = new WebGLFallback(gpuCanvas)
        await simulation.init()
        gpuStatus  = '🌐 CPU'
      }

      simulation.setBoidCount(boidCount, predatorCount)
      simulation.setGoals(goals)
      simulation.setObstacles(obstacles)

      prevTime = performance.now()

      function loop (timestamp) {
        const dt = Math.min((timestamp - prevTime) / 1000, 0.05)
        prevTime = timestamp

        frameCount++; fpsAccum += dt
        if (fpsAccum >= 0.5) {
          fps        = Math.round(frameCount / fpsAccum)
          frameCount = 0; fpsAccum = 0
        }

        simulation.update(dt, getParams())
        drawOverlay()
        animFrame = requestAnimationFrame(loop)
      }
      animFrame = requestAnimationFrame(loop)
    }

    setup().catch(err => { console.error('[App] setup error:', err); gpuStatus = '❌ Error' })

    // Resize handler
    function onResize () {
      const panelW = 270
      const W = Math.max(1, window.innerWidth  - panelW)
      const H = Math.max(1, window.innerHeight)
      gpuCanvas.width     = W; gpuCanvas.height     = H
      overlayCanvas.width = W; overlayCanvas.height = H
      simulation?.resize(W, H)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animFrame)
      simulation?.destroy()
      window.removeEventListener('resize', onResize)
    }
  })
</script>

<div class="app">
  <!-- Simulation canvas area -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="canvas-wrap"
    class:crosshair={activeTool !== 'none'}
    role="application"
    aria-label="Boids simulation canvas"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
  >
    <canvas bind:this={gpuCanvas}     class="layer"></canvas>
    <canvas bind:this={overlayCanvas} class="layer overlay"></canvas>
  </div>

  <!-- Control panel -->
  <ControlPanel
    bind:boidCount
    bind:predatorCount
    bind:separationWeight
    bind:cohesionWeight
    bind:alignmentWeight
    bind:perceptionRadius
    bind:maxSpeed
    bind:showGrid
    bind:debugVectors
    bind:activeTool
    {fps}
    {gpuStatus}
    onclearGoals={() => { goals = [] }}
    onclearObstacles={() => { obstacles = [] }}
  />
</div>

<style>
  :global(body) {
    margin: 0;
    overflow: hidden;
    background: #08080f;
  }

  .app {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .canvas-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
    cursor: default;
  }
  .canvas-wrap.crosshair { cursor: crosshair; }

  .layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .overlay {
    pointer-events: none;
  }
</style>
