import React from 'react';

export default function Legends({
  selectedMember,
  metadata,
  showContours,
  showCurrents,
  stops,
  legendValues,
  currentVarDef,
  selectedVariable,
  autoMaxPixels = 15,
  quantizedZoom = 6.0,
  currentMaxSpeed = 1.5,
  viewState
}) {
  if (!selectedMember || !metadata) return null;

  const legendArrowPixels = Math.max(
    5,
    Math.round(autoMaxPixels * Math.pow(2, (viewState?.zoom || 6) - quantizedZoom))
  );

  return (
    <>
      {/* 1. Contour Ramp Legend */}
      {showContours && (
        <section className="absolute bottom-[68px] sm:bottom-[132px] lg:bottom-[54px] left-3 sm:left-6 w-16 sm:w-20 h-64 sm:h-76 bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2.5 sm:p-3.5 rounded-2xl shadow-2xl z-10 flex flex-col items-center justify-between pointer-events-auto">
          {/* Label at the top */}
          <div
            className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center truncate max-w-full pb-1 border-b border-slate-900 w-full"
            title={currentVarDef?.display_name || selectedVariable}
          >
            {currentVarDef?.display_name ||
              (selectedVariable === 'temp' ? 'Temp' : selectedVariable === 'salt' ? 'Salt' : 'SSH')}
          </div>

          {/* Ramp Container */}
          <div className="flex-1 w-full flex justify-center gap-2 sm:gap-2.5 my-2">
            {/* Color bar */}
            <div
              className="w-2 sm:w-2.5 h-full rounded-md shadow-inner"
              style={{
                background: `linear-gradient(to top, ${(stops || []).map(s => `rgb(${s.color.slice(0, 3).join(',')})`).join(', ')})`
              }}
            ></div>

            {/* 5 Values */}
            <div className="flex flex-col justify-between text-[8px] sm:text-[9px] font-mono text-slate-400 h-full text-left py-0.5">
              {(legendValues || []).map((val, i) => (
                <span
                  key={i}
                  className={
                    i === 0 || i === legendValues.length - 1
                      ? 'text-slate-200 font-medium'
                      : i === 2
                        ? 'text-slate-300'
                        : 'text-slate-500'
                  }
                >
                  {val}
                </span>
              ))}
            </div>
          </div>

          {/* Unit at the bottom */}
          <div className="text-[9px] font-bold text-slate-500 text-center pt-1 border-t border-slate-900 w-full">
            {currentVarDef?.unit ||
              (selectedVariable === 'temp' ? '°C' : selectedVariable === 'salt' ? 'g/kg' : 'm')}
          </div>
        </section>
      )}

      {/* 2. Vector Scale Legend */}
      {showCurrents && (
        <section
          className={`absolute bottom-[68px] sm:bottom-[132px] lg:bottom-[54px] ${
            showContours ? 'left-22 sm:left-28' : 'left-3 sm:left-6'
          } bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2.5 sm:p-3.5 rounded-2xl shadow-2xl z-10 flex flex-col gap-1.5 sm:gap-2 pointer-events-auto transition-all`}
        >
          {/* Legend Title */}
          <div className="flex items-center justify-between border-b border-slate-850/60 pb-1 gap-2 sm:gap-4">
            <span className="text-[9px] sm:text-[10px] font-bold text-slate-300 uppercase tracking-wider">
              Vector Scale
            </span>
            <span className="text-[8px] sm:text-[9px] font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-800/50 px-1 py-0.5 rounded-md">
              m/s
            </span>
          </div>

          {/* Reference Arrow */}
          <div className="flex items-center justify-between gap-2 sm:gap-4 py-0.5 sm:py-1">
            <div className="flex items-center justify-center min-w-[30px] sm:min-w-[35px]">
              <svg
                style={{ width: `${Math.max(legendArrowPixels, 12)}px`, height: '14px' }}
                viewBox={`0 0 ${Math.max(legendArrowPixels, 12)} 14`}
                className="overflow-visible"
              >
                <line
                  x1="0"
                  y1="7"
                  x2={Math.max(0, legendArrowPixels - 5)}
                  y2="7"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${Math.max(0, legendArrowPixels - 5)},4 ${legendArrowPixels},7 ${Math.max(0, legendArrowPixels - 5)},10`}
                  fill="#38bdf8"
                />
              </svg>
            </div>
            <span className="text-[9px] sm:text-[10px] font-mono text-slate-200 font-medium whitespace-nowrap">
              {Number(currentMaxSpeed || 0).toFixed(2)} m/s
            </span>
          </div>
        </section>
      )}
    </>
  );
}
