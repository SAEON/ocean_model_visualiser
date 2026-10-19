import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function Header({
  selectedMember,
  clickedProduct,
  isLoading
}) {
  return (
    <>
      {/* 1. Full-Width Top Header */}
      <header className="absolute top-0 left-0 right-0 h-16 sm:h-20 bg-slate-950/90 border-b border-slate-800/80 backdrop-blur-md shadow-lg z-20 flex items-center justify-between px-3 sm:px-6 pointer-events-auto gap-2 sm:gap-4">
        {/* Left: Clickable Logos & Title */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 py-1">
            <a
              href="https://www.saeon.ac.za/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
              title="Visit NRF SAEON Website"
            >
              <img
                src={`${import.meta.env.BASE_URL}saeon-logo.png`}
                alt="SAEON Logo"
                className="h-6 sm:h-8 w-auto object-contain"
              />
            </a>
            <a
              href="https://somisana.ac.za/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
              title="Visit SOMISANA Website"
            >
              <img
                src={`${import.meta.env.BASE_URL}somisana-logo.png`}
                alt="SOMISANA Logo"
                className="h-6 sm:h-8 w-auto object-contain"
              />
            </a>
          </div>
          <div className="h-5 sm:h-6 w-[1px] bg-slate-800/80 hidden sm:block"></div>
          <div>
            <h1 className="font-bold text-xs sm:text-base text-slate-100 tracking-tight font-outfit truncate max-w-[120px] sm:max-w-none">
              Ocean Model Visualiser
            </h1>
          </div>
        </div>

        {/* Center: Active Model & Region status text */}
        <div className="hidden lg:flex flex-1 justify-center items-center px-4 text-center">
          <p className="text-xs text-slate-300 font-medium bg-slate-900/80 border border-slate-800/80 px-4 py-1.5 rounded-full shadow-inner truncate max-w-xl">
            {selectedMember
              ? `Active Model: ${selectedMember.name} (Region: ${clickedProduct?.name || 'Unknown'})`
              : clickedProduct
                ? `Region: ${clickedProduct.name} - Select a member model to begin`
                : 'Select a region to explore'}
          </p>
        </div>

        {/* Right: Access Data link button */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <a
            href="https://catalog.somisana.ac.za/"
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/40 hover:border-sky-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center gap-1 sm:gap-1.5 group"
            title="Access SOMISANA Data Catalog"
          >
            <span>Access Data</span>
            <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        </div>
      </header>

      {/* 2. Top Banner Loading Bar */}
      {isLoading && (
        <div className="absolute top-16 sm:top-20 left-0 right-0 h-4 sm:h-5 bg-slate-950/95 border-b border-sky-500/30 backdrop-blur-md z-20 flex items-center px-3 sm:px-6 gap-2 sm:gap-3 shadow-lg transition-all">
          <span className="text-[8px] sm:text-[9px] font-mono font-bold text-sky-400 uppercase tracking-widest shrink-0">
            loading:
          </span>
          <div className="flex-1 h-1 bg-slate-900 rounded-full overflow-hidden relative border border-slate-800/80">
            <div className="absolute top-0 bottom-0 bg-gradient-to-r from-sky-500 via-emerald-400 to-sky-400 rounded-full animate-progress-bar shadow-[0_0_8px_rgba(56,189,248,0.6)]"></div>
          </div>
        </div>
      )}
    </>
  );
}
