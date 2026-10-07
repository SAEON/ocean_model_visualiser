# Ocean Model Visualiser

A high-performance interactive GIS visualisation dashboard for regional oceanographic NetCDF models. The application calculates and renders sea surface height contours, temperature/salinity levels, and 3D current velocity vectors over multiple depth layers and time steps with South African coastal land-masking support.

---

## 🏗️ System Architecture

1. **Database**: MongoDB — Stores product regions, model members, and variable group configurations.
2. **Backend**: FastAPI / Python (Containerised) — Performs lazy-load operations on NetCDF files (`xarray`), computes dynamic percentiles, extracts contours using a dedicated process pool, and generates velocity vector fields.
3. **Frontend**: React / Vite / Deck.gl (Host-run) — Renders the interactive map interface, layers, timeline playback, and administrative dashboard.

---

## ⚙️ Prerequisites

Ensure the deployment environment has the following installed:
- **Docker** & **Docker Compose (v2)**
- **Node.js (v18+)** and **npm**

---

## 🚀 Deployment Steps

### 1. Environment & Data Configuration
Copy `.env.example` to `.env` if you wish to override local data paths:
```bash
cp .env.example .env
```
- **Local Machine**: Set `DATA_DIR=/home/dylan/srv/test_ocean_models/` and `PORT=8081` (or another port if 8080 is in use) in `.env`.
- **Production Server**: Leave `DATA_DIR` and `PORT` unset or empty — `docker-compose.yml` defaults automatically to `/mnt/ocims-somisana/public-facing/` and port `8080`.

### 2. Start Backend & Database Services
Build and start containerised services (MongoDB, FastAPI backend, and Cache Warmer) in detached mode:
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
- **Custom Ports**: By default, MongoDB is exposed on port `27017` and the backend is exposed on port `8080` (or your configured `${PORT}`). You can customize these mappings via `.env`.

### 3. Create or Manage Admin Users
Use the admin creation CLI tool to manage admin credentials.

#### Interactive Mode (Prompted Username & Password)
```bash
docker exec -it ocean-backend python3 -m backend.create_admin_user
```

#### Non-Interactive Mode (Command Line Flags)
```bash
docker exec -it ocean-backend python3 -m backend.create_admin_user -u admin -p mysecretpassword
```

#### Local Execution (Without Docker)
```bash
.venv/bin/python -m backend.create_admin_user
```

### 4. Start the Frontend Application
The frontend resolves API requests dynamically based on the browser address.

#### Option A: Run in Development Mode
```bash
cd frontend
npm install
npm run dev -- --host --port 5173
```

#### Option B: Serve a Production Build
```bash
cd frontend
npm install
npm run build
npx serve -s dist -l 5173
```

---

## 📂 Managing NetCDF Files

- Place any NetCDF `.nc` files in your configured `DATA_DIR` (or root path).
- Configure dataset variable groups, titles, and NetCDF file paths via the **Admin Portal** link in the top right corner of the dashboard interface.
