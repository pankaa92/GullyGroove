import { memo } from 'react';

interface BoomboxEqRackProps {
  side: 'left' | 'right';
  isPlaying: boolean;
}

const BAND_WIDTHS = [62, 84, 96, 74, 88, 68, 92, 78, 64, 52];

export const BoomboxEqRack = memo(function BoomboxEqRack({ side, isPlaying }: BoomboxEqRackProps) {
  const isLeft = side === 'left';

  return (
    <div
      aria-hidden="true"
      className="gg-eq-rack flex w-9 sm:w-14 shrink-0 flex-col items-center justify-between rounded-xl sm:rounded-2xl bg-[#0A0A12] border border-white/[0.07] py-1.5 px-1 sm:py-2 sm:px-1.5 select-none"
    >
      {/* Top Rotary Dial Accent */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="gg-eq-dial relative h-4 w-4 sm:h-6 sm:w-6 rounded-full bg-gradient-to-b from-[#1C1C2B] to-[#0E0E17] border border-violet-500/30 shadow-inner flex items-center justify-center">
          <div
            className={`h-1.5 sm:h-2 w-0.5 rounded-full bg-blue-400 origin-bottom transition-transform duration-300 ${
              isPlaying ? (isLeft ? 'rotate-45' : '-rotate-45') : 'rotate-0'
            }`}
          />
        </div>
        <span className="text-[7px] sm:text-[8px] font-mono-tabular tracking-wider text-slate-400 sm:text-slate-500 whitespace-nowrap">
          {isLeft ? 'L-CH' : 'R-CH'}
        </span>
      </div>

      {/* 10-Band Studio LED Spectrum */}
      <div className="w-full space-y-[3px] sm:space-y-1 px-0.5 sm:px-1 my-0.5 sm:my-1">
        {BAND_WIDTHS.map((pct, idx) => {
          const mirroredPct = isLeft ? pct : BAND_WIDTHS[BAND_WIDTHS.length - 1 - idx];
          return (
            <div
              key={idx}
              className={`h-1 sm:h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden flex ${
                isLeft ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-400 transition-opacity duration-200 ${
                  isPlaying ? 'opacity-95 gg-boombox-eq-bar' : 'opacity-30'
                }`}
                style={{
                  width: isPlaying ? `${mirroredPct}%` : `${Math.round(mirroredPct * 0.42)}%`,
                  animationDelay: `${idx * 95 + (isLeft ? 0 : 160)}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Bottom EQ Label & Trim Accent */}
      <div className="flex items-center gap-0.5 sm:gap-1 text-[8px] sm:text-[9px] font-mono-tabular tracking-wider text-slate-500 whitespace-nowrap">
        <span>EQ</span>
        <span className="text-violet-400">·</span>
        <span>DSP</span>
      </div>
    </div>
  );
});
