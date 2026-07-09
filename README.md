# Ocean Model Visualiser

A high-performance interactive GIS visualisation dashboard for regional oceanographic NetCDF models. The application calculates and renders sea surface height contours, temperature/salinity levels, and 3D current velocity vectors over multiple depth layers and time steps with South African coastal land-masking support.

---

## 🏗️ System Architecture

1. **Database**: MongoDB — Stores product regions, model members, and variable group configurations.
2. **Backend**: FastAPI / Python (Containerised) — Performs lazy-load operations on NetCDF files (`xarray`), computes dynamic percentiles (`5%/95%` scaling), extracts contours, and generates velocity vector fields.
3. **Frontend**: React / Vite / Deck.gl (Host-run) — Renders the interactive map interface, layers, timeline playback, and administrative dashboard.

---

## ⚙️ Prerequisites

Ensure the deployment server has the following installed:
- **Docker** & **Docker Compose (v2)**
- **Node.js (v18+)** and **npm**

---

## 🚀 Deployment Steps

### 1. Start the Backend and Database Services
Build and start the containerised services (MongoDB and the FastAPI backend) in detached mode:
```bash
docker compose up -d --build
```

- **Verify Container Status**:
  ```bash
  docker compose ps
  ```
- **Check Backend Logs**:
  ```bash
  docker compose logs -f backend
  ```
- **Custom Ports**: By default, MongoDB is exposed on port `27017` and the backend is exposed on port `8001`. You can customize these mappings by editing the `ports` sections in `docker-compose.yml`.

### 3. Start the Frontend Application
The frontend resolves API requests dynamically. It detects the IP address or VPN hostname you use in your browser and automatically redirects data calls to the backend container on port `8001`.

#### Option A: Run in Development Mode
Best for testing or lightweight VPN access:
```bash
cd frontend
npm install
npm run dev -- --host --port 5173
```
*Note: The `--host` flag is necessary to expose Vite to your VPN or local network.*

#### Option B: Serve a Production Build
For optimal performance, compile the assets and serve them via a static file server:
```bash
cd frontend
npm install
npm run build
npx serve -s dist -l 5173
```

---

## 📂 Managing NetCDF Files

- Place any NetCDF `.nc` files in the project root. The file paths can be resolved by the backend container using:
  - `/home/dylan/srv/ocean_model_visualiser/filename.nc`
- Add variables, titles, and NetCDF file paths via the **Admin Portal** link in the top right corner of the dashboard.
