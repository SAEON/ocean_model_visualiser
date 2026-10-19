import React, { useState } from 'react';
import { Activity, MapPin, X, Loader2 } from 'lucide-react';

export default function TimeSeriesPanel({
  clickedPoint,
  setClickedPoint,
  selectedGroup,
  timeSeriesVariable,
  setTimeSeriesVariable,
  timeSeriesData,
  loadingTimeSeries,
  metadata,
  currentDepthIndex
}) {
  if (!clickedPoint) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]">
      <div
        className="w-full max-w-[640px] bg-slate-900/95 border border-slate-800/80 backdrop-blur-xl rounded-3xl p-6 shadow-2xl space-y-4 text-slate-100 relative pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-sky-400 animate-pulse" /> Time Series Analysis
            </h3>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-400" />
              Lat: <span className="font-mono text-slate-300">{clickedPoint.lat.toFixed(4)}</span>,
              Lng: <span className="font-mono text-slate-300">{clickedPoint.lng.toFixed(4)}</span>
            </p>
          </div>
          <button
            onClick={() => setClickedPoint(null)}
            className="p-1.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 text-slate-400 hover:text-slate-200 rounded-xl transition-all"
            title="Close Panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Variable Select / Depth indicator */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-850 pb-3">
          {/* Select tabs */}
          <div className="flex gap-1.5 p-0.5 bg-slate-950/60 rounded-xl border border-slate-850/50">
            {(selectedGroup?.variables || [])
              .filter(v => {
                const id = typeof v === 'string' ? v : (v.id || v.nc_var);
                const type = typeof v === 'object' ? v.type : (id === 'currents' ? 'vector_pair' : 'scalar_contour');
                return type === 'scalar_contour';
              })
              .map(v => {
                const id = typeof v === 'string' ? v : (v.id || v.nc_var);
                const label = typeof v === 'string' ? (v === 'temp' ? 'Temp' : v === 'salt' ? 'Salinity' : v === 'zeta' ? 'SSH' : v) : (v.display_name || v.id);
                const activeColor = id === 'temp' ? 'text-sky-400' : id === 'salt' ? 'text-emerald-400' : 'text-amber-400';
                return (
                  <button
                    key={id}
                    onClick={() => setTimeSeriesVariable(id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${
                      timeSeriesVariable === id
                        ? `bg-slate-900 ${activeColor} border border-slate-800`
                        : 'text-slate-500 hover:text-slate-300 border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
          </div>

          {/* Depth indicator if not surface-only */}
          {timeSeriesVariable !== 'zeta' && metadata?.depths && (
            <div className="text-[10px] text-slate-400 bg-slate-900/60 border border-slate-850/40 px-3 py-1.5 rounded-xl">
              Depth:{' '}
              <span className="font-bold text-sky-400">
                {metadata.depths[currentDepthIndex] === 0 ? '0m' : `${Math.abs(metadata.depths[currentDepthIndex])}m`}
              </span>
            </div>
          )}
        </div>

        {/* Graph component */}
        <TimeSeriesGraph data={timeSeriesData} loading={loadingTimeSeries} />
      </div>
    </div>
  );
}

function TimeSeriesGraph({ data, loading }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (loading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
        <span className="text-xs">Fetching time series data...</span>
      </div>
    );
  }

  if (!data || !data.values || data.values.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
        No time series data available for this location.
      </div>
    );
  }

  const validValues = data.values.filter(v => v !== null && v !== undefined);
  if (validValues.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-xs">
        All time series values are NaN at this coordinate.
      </div>
    );
  }

  const vMin = Math.min(...validValues);
  const vMax = Math.max(...validValues);
  const vRange = vMax - vMin === 0 ? 1 : vMax - vMin;

  const yMin = vMin - vRange * 0.1;
  const yMax = vMax + vRange * 0.1;
  const yRange = yMax - yMin;

  const width = 600;
  const height = 260;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (index) => paddingLeft + (index / (data.values.length - 1)) * chartWidth;
  const getY = (val) => {
    if (val === null || val === undefined) return null;
    return paddingTop + chartHeight - ((val - yMin) / yRange) * chartHeight;
  };

  let pathD = "";
  const points = [];
  data.values.forEach((val, idx) => {
    const x = getX(idx);
    const y = getY(val);
    if (y !== null) {
      points.push({ x, y, val, time: data.times[idx], index: idx });
      if (pathD === "") {
        pathD = `M ${x} ${y}`;
      } else {
        pathD += ` L ${x} ${y}`;
      }
    }
  });

  const formatTime = (timeStr) => {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return timeStr;
    }
  };

  const formatXAxisTime = (timeStr) => {
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return timeStr;
    }
  };

  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const val = yMin + (i / 4) * yRange;
    yTicks.push({
      val: val,
      y: getY(val),
      label: val.toFixed(2)
    });
  }

  const xTicks = [];
  const numTimes = data.times.length;
  if (numTimes > 1) {
    const indices = [0, Math.floor(numTimes / 3), Math.floor((2 * numTimes) / 3), numTimes - 1];
    indices.forEach(idx => {
      if (idx < numTimes && data.times[idx]) {
        xTicks.push({
          x: getX(idx),
          label: formatXAxisTime(data.times[idx])
        });
      }
    });
  }

  const handleMouseMove = (e) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;

    let closest = null;
    let minDiff = Infinity;
    points.forEach(p => {
      const diff = Math.abs(p.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    });

    if (minDiff < 30) {
      setHoveredPoint(closest);
    } else {
      setHoveredPoint(null);
    }
  };

  return (
    <div className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible select-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <defs>
          <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Gridlines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={tick.y}
              x2={width - paddingRight}
              y2={tick.y}
              stroke="#64748b"
              strokeWidth="1"
              strokeDasharray="3,3"
              className="opacity-20"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              fill="#cbd5e1"
              fontSize="9"
              textAnchor="end"
              className="font-mono font-medium"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* X axis labels */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={height - paddingBottom + 16}
            fill="#cbd5e1"
            fontSize="9"
            textAnchor="middle"
            className="font-medium"
          >
            {tick.label}
          </text>
        ))}

        {/* Shaded Area under path */}
        {points.length > 1 && (
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`}
            fill="url(#chart-glow)"
          />
        )}

        {/* SVG Line path */}
        <path
          d={pathD}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-[0_2px_8px_rgba(14,165,233,0.3)]"
        />

        {/* Interactive hover elements */}
        {hoveredPoint && (
          <g>
            <line
              x1={hoveredPoint.x}
              y1={paddingTop}
              x2={hoveredPoint.x}
              y2={paddingTop + chartHeight}
              stroke="#0ea5e9"
              strokeWidth="1.5"
              strokeDasharray="2,2"
              className="opacity-50"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="5"
              fill="#0ea5e9"
              stroke="#ffffff"
              strokeWidth="1.5"
              className="drop-shadow-[0_0_6px_rgba(14,165,233,0.8)]"
            />
          </g>
        )}
      </svg>

      {/* Floating HTML Tooltip */}
      {hoveredPoint && (
        <div
          className="absolute z-20 pointer-events-none bg-slate-950/95 border border-slate-700/80 backdrop-blur rounded-xl p-2.5 shadow-2xl text-xs flex flex-col gap-1 text-slate-100 transition-all duration-75"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100 - 65}%`,
            transform: 'translateX(-50%)'
          }}
        >
          <div className="text-[9px] font-bold text-slate-500 uppercase">{formatTime(hoveredPoint.time)}</div>
          <div className="font-semibold text-sky-400">
            {hoveredPoint.val.toFixed(3)} <span className="text-[10px] text-slate-400">{data.unit}</span>
          </div>
        </div>
      )}
    </div>
  );
}
