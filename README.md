# 🐟 Boids — High-Performance 2D Flocking Simulation

A real-time, browser-based Boids simulation capable of simulating **10,000+ agents at 60 FPS**, powered by **WebGPU compute shaders** (WGSL) with an automatic **WebGL2 / Canvas CPU fallback**. Built with **Svelte 5** and **Vite**.

🌐 **[Live Demo](https://lowweilin.github.io/Boids/)**

---

## ✨ Features

- **10,000+ agents** rendered at 60 FPS using WebGPU compute shaders
- **Two agent types**:
  - **Boids (Prey)** — exhibit classic flocking: cohesion, alignment, separation, predator avoidance, goal-seeking, and obstacle avoidance
  - **Predators** — pursue the centre of nearby prey flocks and avoid obstacles
- **Toroidal topology** — agents wrap around screen edges; all distance and velocity calculations use the Minimum Image Convention
- **Interactive obstacles**: circle and box shapes, placeable and draggable on the canvas
- **Goal attractors**: place star markers that pull nearby boids toward them
- **Spatial grid acceleration** — GPU-side atomic binning eliminates O(n²) neighbour search
- **WebGL2 / 2D Canvas fallback** — runs everywhere, even without WebGPU
- **Live FPS counter** and GPU/CPU status badge
- **Debug overlays** — spatial grid visualisation and velocity vectors

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Svelte 5](https://svelte.dev) (runes API) |
| Build tool | [Vite 6](https://vitejs.dev) |
| GPU compute | WebGPU (WGSL compute shaders) |
| GPU render | WebGPU render pipeline (instanced triangles) |
| CPU fallback | WebGL2 instanced rendering + JS spatial hash |
| Ultimate fallback | HTML5 2D Canvas |
| Deployment | GitHub Actions → GitHub Pages |

---

## 🏗 Architecture

### GPU Pipeline (WebGPU)

Each frame executes three GPU passes:

```
┌──────────────────────────────────────────────────────────────────┐
│  Pass 1 – Spatial Binning (Compute)                              │
│  • Clears per-cell counters                                      │
│  • Each boid atomically writes its index into a grid cell        │
│  • Grid cell size = perceptionRadius; max 256×256 cells          │
├──────────────────────────────────────────────────────────────────┤
│  Pass 2 – Boid Logic (Compute)  [Buffer A → Buffer B]           │
│  • Each boid reads its 3×3 cell neighbourhood                    │
│  • Computes separation / cohesion / alignment (prey)             │
│  • Predator avoidance (prey) / prey pursuit (predator)           │
│  • Obstacle SDF steering + goal attraction                       │
│  • Writes updated pos/vel to output buffer                       │
├──────────────────────────────────────────────────────────────────┤
│  Pass 3 – Render (Vertex + Fragment)                             │
│  • Reads boid buffer (instanced)                                 │
│  • Draws one triangle per boid, oriented along velocity          │
│  • Prey = blue, Predators = red                                  │
└──────────────────────────────────────────────────────────────────┘
```

Buffers are **ping-ponged** each frame (A→B, B→A) to avoid read/write hazards.

### CPU Fallback Pipeline (WebGL2)

- JavaScript **spatial hash grid** mirrors the GPU grid for O(n) neighbour queries
- Identical flocking rules computed on the CPU
- Boid positions uploaded each frame as a **WebGL2 instanced vertex buffer**
- Falls back to pure **2D Canvas** if WebGL2 is unavailable

### Overlay (2D Canvas)

A transparent 2D canvas sits on top of the main canvas and renders:
- Spatial grid lines (when *Show Grid* is active)
- Goal markers (⭐)
- Obstacle shapes (circles and boxes)
- Velocity debug vectors (when *Debug Vectors* is active)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 22 LTS
- `npm` (bundled with Node)

### Install & Run

```bash
# Clone the repository
git clone https://github.com/LowWeiLin/Boids.git
cd Boids

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173/Boids/`).

### Build for Production

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

---

## 🎮 Controls

### Toolbox

| Button | Action |
|---|---|
| ⭐ Add Goal | Click on the canvas to place a goal attractor |
| ✥ Move Goal | Click and drag an existing goal to reposition it |
| ⬟ Add Circle Obs | Click on the canvas to place a circular obstacle |
| ⬜ Add Box Obs | Click on the canvas to place a rectangular obstacle |
| ⬡ Move Obstacle | Click and drag an existing obstacle to reposition it |
| ✕ Goals | Remove all goals |
| ✕ Obstacles | Remove all obstacles |

### Agents

| Slider | Range | Description |
|---|---|---|
| Boids | 10 – 20,000 | Number of prey boids |
| Predators | 0 – 50 | Number of predators |

### Flocking Weights

| Slider | Range | Description |
|---|---|---|
| Separation | 0 – 5 | Repulsion from nearby boids |
| Cohesion | 0 – 5 | Attraction to the local flock centre |
| Alignment | 0 – 5 | Steering toward the average local velocity |

### Physics

| Slider | Range | Description |
|---|---|---|
| Perception | 10 – 200 px | Neighbourhood radius for flocking rules |
| Max Speed | 0.5 – 10 | Maximum boid velocity (pixels/second) |

### Debug

| Toggle | Description |
|---|---|
| Show Grid | Overlay the spatial grid cells |
| Debug Vectors | Draw velocity vectors for each boid (CPU fallback only) |

---

## 🌍 Browser Compatibility

| Browser | Rendering | Notes |
|---|---|---|
| Chrome / Edge 113+ | ⚡ WebGPU | Full performance |
| Firefox (with flag) | ⚡ WebGPU | Enable `dom.webgpu.enabled` in `about:config` |
| Safari 18+ | ⚡ WebGPU | Available on macOS 15 / iOS 18 |
| Older browsers | 🌐 WebGL2 CPU | Reduced agent count (~5,000 max) |
| Very old browsers | 🖥 2D Canvas | Works but limited performance |

The application automatically detects and selects the best available renderer at startup.

---

## 📦 Project Structure

```
Boids/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions: build + Pages deploy
├── src/
│   ├── main.js                 # Svelte entry point
│   ├── App.svelte              # Root component; canvas setup, interaction, loop
│   ├── components/
│   │   └── ControlPanel.svelte # Side-panel UI (sliders, toolbox, toggles)
│   └── simulation/
│       ├── BoidSimulation.js   # WebGPU engine (3-pass pipeline)
│       ├── WebGLFallback.js    # WebGL2 + 2D Canvas CPU fallback
│       └── shaders/
│           ├── binning.wgsl    # Compute: spatial grid construction
│           ├── boidLogic.wgsl  # Compute: flocking rules + integration
│           └── render.wgsl     # Vertex/Fragment: instanced boid rendering
├── index.html
├── vite.config.js              # base: '/Boids/' for GitHub Pages
└── package.json
```

---

## 🚢 Deployment

The repository ships with a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds and deploys to **GitHub Pages** on every push to `main`.

**One-time setup**: go to *Settings → Pages → Source* and select **GitHub Actions**.

The `vite.config.js` sets `base: '/Boids/'` to match the Pages subdirectory path.

---

## 📄 License

This project is open source. See the repository for details.