import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { COLOR_SCHEMES, getStopsGradientCss } from '../../utils/colorScales';

export default function ColorSchemeSelector({ value = 'thermal', onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const activeScheme =
    COLOR_SCHEMES.find((s) => s.id === value) || COLOR_SCHEMES[0];

  // Close accordion when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative space-y-1" ref={containerRef}>
      <label className="text-[9px] text-slate-500 block">Color Scheme</label>

      {/* Accordion Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 px-2 py-1 bg-slate-950 border rounded text-left transition-all ${
          isOpen
            ? 'border-sky-500 ring-1 ring-sky-500/30 bg-slate-900'
            : 'border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Active Gradient Swatch */}
          <div
            className="w-10 sm:w-14 h-2.5 rounded-sm shadow-inner ring-1 ring-white/10 shrink-0"
            style={{ background: getStopsGradientCss(activeScheme.stops) }}
          />
          <span className="text-[10px] font-medium text-slate-200 truncate">
            {activeScheme.name}
          </span>
        </div>

        <ChevronDown
          className={`w-3 h-3 text-slate-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-sky-400' : ''
          }`}
        />
      </button>

      {/* Accordion Expanded Panel */}
      {isOpen && (
        <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg space-y-1.5 shadow-2xl z-20 relative mt-1 animate-in fade-in-50 zoom-in-95 duration-150">
          <div className="text-[9px] text-slate-400 font-semibold px-1 pb-1 border-b border-slate-900 flex justify-between items-center">
            <span>Color Palette</span>
            <span className="text-slate-500 font-mono text-[8px]">Actual Spectrum</span>
          </div>

          <div className="space-y-1">
            {COLOR_SCHEMES.map((scheme) => {
              const isSelected = scheme.id === (value || 'thermal');
              return (
                <button
                  key={scheme.id}
                  type="button"
                  onClick={() => {
                    onChange(scheme.id);
                    setIsOpen(false);
                  }}
                  className={`w-full group p-1.5 rounded-md text-left transition-all border flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-sky-950/50 border-sky-600/80 shadow-sm'
                      : 'bg-slate-900/50 hover:bg-slate-900 border-slate-850 hover:border-slate-700'
                  }`}
                >
                  {/* Scheme header row */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[11px] font-semibold ${
                          isSelected ? 'text-sky-300' : 'text-slate-200 group-hover:text-slate-100'
                        }`}
                      >
                        {scheme.name}
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono truncate">
                        ({scheme.description})
                      </span>
                    </div>

                    {isSelected && (
                      <span className="flex items-center gap-0.5 text-[8px] font-bold text-sky-400 uppercase tracking-wider bg-sky-950/80 border border-sky-800/60 px-1 py-0.2 rounded shrink-0">
                        <Check className="w-2.5 h-2.5" />
                        Selected
                      </span>
                    )}
                  </div>

                  {/* Scheme Gradient preview bar */}
                  <div
                    className="w-full h-3 rounded shadow-inner ring-1 ring-white/10"
                    style={{ background: getStopsGradientCss(scheme.stops) }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

