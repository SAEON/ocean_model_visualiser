import React from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';

export default function PlaybackControls({
  selectedMember,
  metadata,
  isPlaying,
  setIsPlaying,
  currentTimeIndex,
  setCurrentTimeIndex,
  playbackSpeed,
  setPlaybackSpeed,
  bufferedRange,
  formatTime
}) {
  if (!selectedMember || !metadata || !metadata.times || metadata.times.length === 0) {
    return null;
  }

  const numSteps = metadata.times.length;

  return (
    <section className="absolute bottom-2 sm:bottom-[54px] left-2 sm:left-1/2 right-2 sm:right-auto sm:-translate-x-1/2 bg-slate-950/90 border border-slate-800/80 backdrop-blur-lg px-3 py-2 sm:px-6 sm:py-3 rounded-2xl shadow-2xl z-10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 sm:gap-6 pointer-events-auto w-auto sm:w-[960px] max-w-[calc(100vw-16px)] sm:max-w-[calc(100vw-32px)]">
      {/* Play/Pause Button Group */}
      <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-900/60 p-0.5 rounded-xl border border-slate-800/40 shrink-0">
        <button
          onClick={() => setCurrentTimeIndex((prev) => (prev - 1 + numSteps) % numSteps)}
          className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          title="Previous Step"
        >
          <SkipBack className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-1.5 sm:p-2 rounded-xl transition-all ${
            isPlaying
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/20'
              : 'text-slate-300 hover:bg-slate-800/50'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          ) : (
            <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          )}
        </button>
        <button
          onClick={() => setCurrentTimeIndex((prev) => (prev + 1) % numSteps)}
          className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
          title="Next Step"
        >
          <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Timeline Slider & Buffered Progress */}
      <div className="flex-1 flex flex-col gap-1 min-w-[140px] sm:min-w-[200px]">
        <div className="relative group flex items-center h-4">
          <div className="absolute left-0 right-0 h-1.5 bg-slate-900 rounded-lg overflow-hidden pointer-events-none border border-slate-800/80">
            <div
              className="absolute top-0 bottom-0 bg-sky-500/30 border-r border-sky-400/80 rounded-r transition-all duration-300 shadow-[0_0_8px_rgba(56,189,248,0.5)]"
              style={{
                left: `${(currentTimeIndex / Math.max(1, numSteps - 1)) * 100}%`,
                width: `${((bufferedRange?.count || 0) / Math.max(1, numSteps - 1)) * 100}%`
              }}
            ></div>
          </div>

          <input
            type="range"
            min="0"
            max={numSteps - 1}
            value={currentTimeIndex}
            onChange={(e) => setCurrentTimeIndex(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-transparent rounded-lg appearance-none cursor-pointer accent-sky-400 z-10"
          />
        </div>
        <div className="flex items-center justify-between text-[8px] sm:text-[9px] text-slate-500 font-mono leading-none">
          <span>0h</span>
          <span className="flex items-center gap-1 truncate max-w-[110px] sm:max-w-none">
            <span className="hidden sm:inline">Timeline Progress</span>
            {bufferedRange?.count > 0 && (
              <span className="text-sky-400 font-bold">({bufferedRange.count}h)</span>
            )}
          </span>
          <span>{numSteps - 1}h</span>
        </div>
      </div>

      {/* Active Timestamp details */}
      <div className="flex flex-col text-right shrink-0 border-l border-slate-900 pl-2 sm:pl-4 min-w-[85px] sm:min-w-[110px]">
        <span className="text-[10px] sm:text-xs font-bold text-slate-200">
          {formatTime(metadata.times[currentTimeIndex])}
        </span>
        <span className="text-[8px] sm:text-[9px] text-slate-500 font-mono mt-0.5">
          Step {currentTimeIndex + 1} / {numSteps}
        </span>
      </div>

      {/* Playback speed selector */}
      <div className="hidden md:flex items-center gap-2 border-l border-slate-900 pl-4 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Speed</span>
        <div className="flex gap-0.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-850">
          {[1, 2, 5, 10].map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-all ${
                playbackSpeed === speed
                  ? 'bg-slate-800 text-sky-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {speed}fps
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
