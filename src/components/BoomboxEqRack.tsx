interface BoomboxEqRackProps {
  side: 'left' | 'right';
  isPlaying: boolean;
}

const BAND_WIDTHS = [62, 84, 96, 74, 88, 68, 92, 78, 64, 52];

export function BoomboxEqRack({ side, isPlaying }: BoomboxEqRackProps) {
  const isLeft = side === 'left';

  return (
    <div
      aria-hidden="true"
      className="hidden sm:flex w-16 md:w-20 shrink-0 flex-col items-center justify-between rounded-2xl bg-[#0A0A12] border border-white/[0.07] py-3 px-2 select-none"
    >
      {/* Top Rotary Dial Accent */}
      <div className="flex flex-col items-center gap-1">
        <div className="relative h-7 w-7 rounded-full bg-gradient-to-b from-[#1C1C2B] to-[#0E0E17] border border-violet-500/30 shadow-inner flex items-center justify-center">
          <div
            className={`h-2.5 w-0.5 rounded-full bg-blue-400 origin-bottom transition-transform duration-300 ${
              isPlaying ? (isLeft ? 'rotate-45' : '-rotate-45') : 'rotate-0'
            }`}
          />
        </div>
        <span className="text-[9px] font-mono-tabular tracking-widest text-slate-500">
          {isLeft ? 'L-CH' : 'R-CH'}
        </span>
      </div>

      {/* 10-Band Studio LED Spectrum */}
      <div className="w-full space-y-1.5 px-1 my-2">
        {BAND_WIDTHS.map((pct, idx) => {
          const mirroredPct = isLeft ? pct : BAND_WIDTHS[BAND_WIDTHS.length - 1 - idx];
          return (
            <div
              key={idx}
              className={`h-1.5 w-full rounded-full bg-white/[0.05] overflow-hidden flex ${
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
      <div className="flex items-center gap-1 text-[9px] font-mono-tabular tracking-wider text-slate-500">
        <span>EQ</span>
        <span className="text-violet-400">·</span>
        <span>DSP</span>
      </div>
    </div>
  );
}
