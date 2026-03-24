<script>
  let {
    boidCount        = $bindable(500),
    predatorCount    = $bindable(5),
    separationWeight = $bindable(1.5),
    cohesionWeight   = $bindable(1.0),
    alignmentWeight  = $bindable(1.0),
    perceptionRadius = $bindable(50),
    maxSpeed         = $bindable(3.0),
    showGrid         = $bindable(false),
    debugVectors     = $bindable(false),
    activeTool       = $bindable('none'),
    fps              = 0,
    gpuStatus        = '',
    onclearGoals     = () => {},
    onclearObstacles = () => {},
  } = $props()

  const tools = [
    { id: 'addGoal',      label: '⭐ Add Goal' },
    { id: 'moveGoal',     label: '✥ Move Goal' },
    { id: 'addObstacle',  label: '⬟ Add Circle Obs' },
    { id: 'addBoxObs',    label: '⬜ Add Box Obs' },
    { id: 'moveObstacle', label: '⬡ Move Obstacle' },
  ]
</script>

<aside class="panel">
  <!-- Header -->
  <div class="header">
    <span class="title">🐟 Boids</span>
    <span class="badge" class:gpu={gpuStatus.includes('WebGPU')}>{gpuStatus}</span>
  </div>

  <div class="fps">
    <span class="fps-val">{fps}</span>
    <span class="fps-lbl"> FPS</span>
  </div>

  <!-- Toolbox -->
  <section>
    <h3>Toolbox</h3>
    <div class="tool-grid">
      {#each tools as tool}
        <button
          class="tool-btn"
          class:active={activeTool === tool.id}
          onclick={() => activeTool = activeTool === tool.id ? 'none' : tool.id}
        >{tool.label}</button>
      {/each}
    </div>
    <div class="row">
      <button class="clear-btn" onclick={onclearGoals}>✕ Goals</button>
      <button class="clear-btn" onclick={onclearObstacles}>✕ Obstacles</button>
    </div>
  </section>

  <!-- Counts -->
  <section>
    <h3>Agents</h3>
    <label>
      <span>Boids <em>{boidCount}</em></span>
      <input type="range" min="10" max="20000" step="10" bind:value={boidCount} />
    </label>
    <label>
      <span>Predators <em>{predatorCount}</em></span>
      <input type="range" min="0" max="50" step="1" bind:value={predatorCount} />
    </label>
  </section>

  <!-- Flocking weights -->
  <section>
    <h3>Flocking</h3>
    <label>
      <span>Separation <em>{separationWeight.toFixed(2)}</em></span>
      <input type="range" min="0" max="5" step="0.05" bind:value={separationWeight} />
    </label>
    <label>
      <span>Cohesion <em>{cohesionWeight.toFixed(2)}</em></span>
      <input type="range" min="0" max="5" step="0.05" bind:value={cohesionWeight} />
    </label>
    <label>
      <span>Alignment <em>{alignmentWeight.toFixed(2)}</em></span>
      <input type="range" min="0" max="5" step="0.05" bind:value={alignmentWeight} />
    </label>
  </section>

  <!-- Physics -->
  <section>
    <h3>Physics</h3>
    <label>
      <span>Perception <em>{perceptionRadius}</em>px</span>
      <input type="range" min="10" max="200" step="1" bind:value={perceptionRadius} />
    </label>
    <label>
      <span>Max Speed <em>{maxSpeed.toFixed(1)}</em></span>
      <input type="range" min="0.5" max="10" step="0.1" bind:value={maxSpeed} />
    </label>
  </section>

  <!-- Debug -->
  <section>
    <h3>Debug</h3>
    <div class="toggle-row">
      <label class="toggle">
        <input type="checkbox" bind:checked={showGrid} />
        <span>Show Grid</span>
      </label>
      <label class="toggle">
        <input type="checkbox" bind:checked={debugVectors} />
        <span>Debug Vectors</span>
      </label>
    </div>
  </section>

  <!-- Instructions -->
  <div class="hint">
    Select a tool, then click on the canvas to place goals / obstacles.
    Drag to move items.
  </div>
</aside>

<style>
  .panel {
    width: 270px;
    min-width: 270px;
    height: 100vh;
    background: #0d0d1a;
    border-left: 1px solid #2a2a44;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0;
    color: #ccd;
    font-family: 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    scrollbar-width: thin;
    scrollbar-color: #2a2a44 transparent;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 6px;
    border-bottom: 1px solid #1e1e32;
  }
  .title { font-size: 16px; font-weight: 700; color: #e8eaf6; letter-spacing: 0.03em; }
  .badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    background: #1e1e38;
    color: #667;
    border: 1px solid #333;
  }
  .badge.gpu { color: #8cf; border-color: #48f; background: #0d1830; }

  .fps {
    text-align: center;
    padding: 6px 0;
    border-bottom: 1px solid #1e1e32;
  }
  .fps-val { font-size: 26px; font-weight: 700; color: #7cf; }
  .fps-lbl { font-size: 12px; color: #556; }

  section {
    padding: 10px 14px 6px;
    border-bottom: 1px solid #1e1e32;
  }
  h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #557;
    margin: 0 0 8px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
  }
  label span {
    display: flex;
    justify-content: space-between;
    color: #aab;
  }
  label em { color: #9cf; font-style: normal; }

  input[type='range'] {
    width: 100%;
    accent-color: #48f;
    cursor: pointer;
    height: 4px;
  }

  .tool-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
    margin-bottom: 8px;
  }
  .tool-btn {
    padding: 5px 4px;
    font-size: 11px;
    background: #16162a;
    color: #99b;
    border: 1px solid #2a2a44;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-align: center;
  }
  .tool-btn:hover  { background: #1e1e40; color: #cce; }
  .tool-btn.active { background: #1a2860; color: #8cf; border-color: #48f; }

  .row {
    display: flex;
    gap: 6px;
  }
  .clear-btn {
    flex: 1;
    padding: 4px 0;
    font-size: 11px;
    background: #1a0e0e;
    color: #c77;
    border: 1px solid #422;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .clear-btn:hover { background: #2a1212; }

  .toggle-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .toggle {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin-bottom: 0;
  }
  .toggle input[type='checkbox'] { accent-color: #48f; width: 15px; height: 15px; cursor: pointer; }
  .toggle span { color: #aab; }

  .hint {
    padding: 10px 14px;
    font-size: 11px;
    color: #445;
    line-height: 1.5;
  }
</style>
