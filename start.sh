#!/bin/bash

# Clean up background jobs on exit (Ctrl+C)
trap "kill 0" EXIT

echo "=================================================="
echo "🚀 Starting Ocean Model Visualizer System"
echo "=================================================="

# Start backend server
echo "📡 Starting FastAPI backend on port 8001..."
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8001 &

# Wait for backend
sleep 2

# Start frontend
echo "💻 Starting Vite React frontend..."
cd frontend
npm run dev

# Wait for all processes to finish
wait
