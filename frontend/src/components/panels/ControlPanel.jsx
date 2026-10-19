import React, { useState } from 'react';
import {
  Activity,
  MapPin,
  Layers,
  ArrowLeft,
  ArrowRight,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Loader2,
  Thermometer,
  Droplets,
  Waves
} from 'lucide-react';

export default function ControlPanel({
  products,
  clickedProduct,
  setClickedProduct,
  handleProductClick,
  loadingMembers,
  productMembers,
  setProductMembers,
  selectedMember,
  setSelectedMember,
  selectedGroup,
  setSelectedGroup,
  handleSelectMember,
  handleSelectVariableGroup,
  metadata,
  setMetadata,
  selectedVariable,
  setSelectedVariable,
  setCurrentDepthIndex,
  availableContourVars,
  hasContoursOption,
  hasCurrents,
  showContours,
  setShowContours,
  showCurrents,
  setShowCurrents,
  showPoints,
  setShowPoints,
  onResetViewport
}) {
  const [isPanelOpen, setIsPanelOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : false
  );

  return (
    <div
      className={`absolute top-[72px] sm:top-[106px] left-3 sm:left-6 w-[calc(100vw-24px)] sm:w-auto lg:w-96 z-20 flex flex-col sm:flex-row lg:flex-col sm:items-start gap-2 sm:gap-4 pointer-events-auto transition-all duration-300 ${
        isPanelOpen
          ? 'max-h-[calc(100vh-220px)] sm:max-h-[calc(100vh-186px)] lg:max-h-[calc(100vh-160px)] overflow-y-auto overflow-x-hidden pr-1'
          : 'max-h-12 sm:max-h-none overflow-hidden sm:overflow-visible'
      }`}
    >
      {/* Mobile Collapse Toggle Bar */}
      <button
        onClick={() => setIsPanelOpen(!isPanelOpen)}
        className="sm:hidden w-full bg-slate-950/95 border border-slate-800/90 backdrop-blur-xl px-4 py-3 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-100 shadow-2xl shrink-0 active:scale-[0.99] transition-all"
      >
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-4 h-4 text-sky-400" />
          <span className="tracking-wide">Control Panel</span>
        </div>
        <div className="flex items-center gap-1.5 text-sky-400 font-bold text-[11px] bg-sky-950/80 border border-sky-800/60 px-2.5 py-1 rounded-xl shadow-sm">
          <span>{isPanelOpen ? 'Hide Menu' : 'Open Menu'}</span>
          {isPanelOpen ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
          )}
        </div>
      </button>

      {/* Main Model Visualization / Product Browser Card */}
      <main className="w-full sm:w-96 bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col shrink-0">
        {/* Card Header */}
        <div className="border-b border-slate-900/60 px-5 py-4 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2">
            {selectedMember ? (
              <>
                <Activity className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Model Visualization
                </span>
              </>
            ) : clickedProduct ? (
              <>
                <MapPin className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Product Models
                </span>
              </>
            ) : (
              <>
                <Layers className="w-4 h-4 text-sky-400" />
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Available Regions
                </span>
              </>
            )}
          </div>

          {(selectedMember || clickedProduct) && (
            <button
              onClick={() => {
                if (selectedMember) {
                  setSelectedMember(null);
                  setSelectedGroup(null);
                  setMetadata(null);
                } else {
                  setClickedProduct(null);
                  setProductMembers([]);
                  onResetViewport?.();
                }
              }}
              className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition-colors uppercase"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
          )}
        </div>

        {/* Card Body */}
        {selectedMember ? (
          <div className="p-5 space-y-4">
            {/* Variable Group Radios */}
            {selectedMember.variable_groups && selectedMember.variable_groups.length > 1 && (
              <div className="space-y-1.5 border-b border-slate-900/60 pb-3">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Dataset / Variable Group
                </label>
                <div className="space-y-1 bg-slate-900/40 p-1.5 rounded-xl border border-slate-800/40 max-h-32 overflow-y-auto">
                  {selectedMember.variable_groups.map((group, idx) => (
                    <label
                      key={idx}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-lg cursor-pointer text-xs font-medium transition-all ${
                        selectedGroup?.file_path === group.file_path
                          ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="activeGroup"
                          checked={selectedGroup?.file_path === group.file_path}
                          onChange={() => handleSelectVariableGroup(group, selectedMember)}
                          className="rounded-full border-slate-800 bg-slate-950 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3 h-3"
                        />
                        <span className="truncate max-w-[200px]">
                          {group.name || `Dataset ${idx + 1}`}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-500 uppercase">
                        {(group.variables || [])
                          .map((v) =>
                            typeof v === 'string'
                              ? v
                              : v.display_name || v.id || v.nc_var
                          )
                          .join(', ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {selectedMember.variable_groups && selectedMember.variable_groups.length === 1 && (
              <div className="text-[10px] text-slate-500 uppercase font-semibold pb-1 border-b border-slate-900/60">
                Active Dataset:{' '}
                <span className="text-slate-300 normal-case font-normal">
                  {selectedGroup?.name || 'Default'}
                </span>
              </div>
            )}

            {/* Variable Toggles */}
            {availableContourVars && availableContourVars.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Variable
                </label>
                <div
                  className={`grid ${
                    availableContourVars.length >= 3
                      ? 'grid-cols-3'
                      : availableContourVars.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-1'
                  } gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/60`}
                >
                  {availableContourVars.map((v) => {
                    const isSelected = selectedVariable === v.id;
                    const Icon =
                      v.id === 'temp'
                        ? Thermometer
                        : v.id === 'salt'
                          ? Droplets
                          : Waves;
                    return (
                      <button
                        key={v.id}
                        onClick={() => {
                          setSelectedVariable(v.id);
                          if (v.is_surface_only) setCurrentDepthIndex(0);
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all truncate ${
                          isSelected
                            ? 'bg-slate-800 text-sky-400 shadow shadow-sky-500/10'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title={v.display_name || v.id}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{v.display_name || v.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : clickedProduct ? (
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <h3 className="text-xs font-bold text-slate-300">Model Outputs (Members)</h3>
              <p className="text-[10px] text-slate-500">
                Select one of the member models below to load and visualize its data layers on the map.
              </p>
            </div>
            {loadingMembers ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                <span className="text-xs text-slate-500">Loading models...</span>
              </div>
            ) : productMembers.length === 0 ? (
              <div className="py-8 text-center space-y-2 border border-dashed border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500">No member models added yet.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {productMembers.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleSelectMember(m)}
                    className="w-full text-left p-3.5 bg-slate-900/60 hover:bg-slate-850 border border-slate-850 hover:border-slate-750 rounded-xl transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400 transition-colors">
                        {m.name}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-1 flex items-center gap-2">
                        <span>{m.variable_groups?.length || 0} datasets</span>
                        {m.time_steps && m.time_steps.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{m.time_steps.length} steps</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] text-slate-500">
                Select a highlighted bounding box on the map or choose a region below to inspect active model outputs.
              </p>
            </div>
            {products.length === 0 ? (
              <div className="py-8 text-center space-y-2 border border-dashed border-slate-800 rounded-xl">
                <p className="text-xs text-slate-500">No regions or products configured.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {products.map((p) => {
                  const hasRegion = !!p.region;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleProductClick(p.id, p.name)}
                      className="w-full text-left p-3.5 bg-slate-900/60 hover:bg-slate-850 border border-slate-850 hover:border-slate-750 rounded-xl transition-all flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400 transition-colors">
                          {p.name}
                        </div>
                        <div className="text-[9px] text-slate-500 mt-1 flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              hasRegion
                                ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                                : 'bg-amber-500'
                            }`}
                          ></span>
                          <span>{hasRegion ? 'Bounding Shape Derived' : 'No Shape Derived'}</span>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Map Layers Options (Overlays) */}
      {selectedMember && metadata && (
        <section className="w-full sm:w-auto sm:min-w-[280px] lg:w-full bg-slate-950/85 border border-slate-800/80 backdrop-blur-lg p-3 sm:p-4 rounded-2xl shadow-2xl space-y-3 shrink-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-slate-900/80 pb-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Map Layers
              </span>
              <span className="text-[9px] font-mono text-sky-400 bg-sky-950/60 border border-sky-800/50 px-1.5 py-0.5 rounded-md">
                Overlays
              </span>
            </div>
            <div
              className={`grid ${
                (hasContoursOption ? 1 : 0) + (hasCurrents ? 1 : 0) + 1 >= 3
                  ? 'grid-cols-3 sm:flex sm:flex-wrap lg:grid lg:grid-cols-3'
                  : 'grid-cols-2 sm:flex sm:flex-wrap lg:grid lg:grid-cols-2'
              } gap-2`}
            >
              {hasContoursOption && (
                <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 px-3 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                  <input
                    type="checkbox"
                    checked={showContours}
                    onChange={(e) => setShowContours(e.target.checked)}
                    className="rounded border-slate-800 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                  />
                  Contours
                </label>
              )}
              {hasCurrents && (
                <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 px-3 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                  <input
                    type="checkbox"
                    checked={showCurrents}
                    onChange={(e) => setShowCurrents(e.target.checked)}
                    className="rounded border-slate-800 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 w-3.5 h-3.5"
                  />
                  Currents
                </label>
              )}
              <label className="flex items-center justify-center gap-2 cursor-pointer text-xs font-semibold py-2 px-3 rounded-xl bg-slate-900/60 border border-slate-850 hover:border-slate-750 transition-colors text-slate-300">
                <input
                  type="checkbox"
                  checked={showPoints}
                  onChange={(e) => setShowPoints(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-900 text-slate-200 focus:ring-white focus:ring-offset-slate-950 w-3.5 h-3.5"
                />
                Grid Points
              </label>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
