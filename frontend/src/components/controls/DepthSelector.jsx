import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function DepthSelector({
  selectedMember,
  metadata,
  currentDepthIndex,
  setCurrentDepthIndex,
  isSurfaceOnly
}) {
  const [isDepthOpen, setIsDepthOpen] = useState(false);

  if (!selectedMember || !metadata || !metadata.depths || metadata.depths.length === 0) {
    return null;
  }

  const currentDepth = metadata.depths[currentDepthIndex];
  const depthLabel = isSurfaceOnly
    ? 'Surface (0m)'
    : currentDepth === 0
      ? '0m'
      : `${Math.abs(currentDepth)}m`;

  return (
    <section className="absolute right-3 sm:right-6 bottom-[68px] sm:bottom-[132px] lg:bottom-[54px] bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-2 sm:p-3 rounded-2xl shadow-2xl z-10 flex flex-col items-center gap-1.5 sm:gap-2 pointer-events-auto transition-all">
      <button
        onClick={() => setIsDepthOpen(!isDepthOpen)}
        className="w-full flex items-center justify-between gap-1.5 text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center pb-1 border-b border-slate-900 focus:outline-none"
      >
        <span>Depth ({depthLabel})</span>
        <span className="sm:hidden">
          {isDepthOpen ? (
            <ChevronDown className="w-3 h-3 text-sky-400" />
          ) : (
            <ChevronUp className="w-3 h-3 text-slate-400" />
          )}
        </span>
      </button>

      <div
        className={`flex flex-col gap-1 sm:gap-1.5 mt-0.5 sm:mt-1 max-h-48 sm:max-h-none overflow-y-auto pr-0.5 transition-all duration-200 ${
          isDepthOpen ? 'flex' : 'hidden sm:flex'
        }`}
      >
        {metadata.depths.map((d, idx) => {
          const isSelected = isSurfaceOnly ? idx === 0 : currentDepthIndex === idx;
          return (
            <button
              key={d}
              disabled={isSurfaceOnly}
              onClick={() => {
                setCurrentDepthIndex(idx);
                setIsDepthOpen(false);
              }}
              className={`w-9 sm:w-12 py-1.5 sm:py-2 rounded-xl text-[10px] sm:text-[11px] font-bold border transition-all ${
                isSelected
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/50'
                  : 'bg-slate-900/40 text-slate-400 border-slate-800'
              } ${
                isSurfaceOnly
                  ? 'opacity-40 cursor-not-allowed border-slate-800/20'
                  : 'hover:text-slate-200 hover:border-slate-700'
              }`}
              title={d === 0 ? 'Surface (0m)' : `${Math.abs(d)}m`}
            >
              {d === 0 ? '0m' : `${Math.abs(d)}m`}
            </button>
          );
        })}
      </div>
    </section>
  );
}
