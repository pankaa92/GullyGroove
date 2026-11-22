import { Music2 } from 'lucide-react';
import { useState } from 'react';

interface ArtworkImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export function ArtworkImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel,
}: ArtworkImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-violet-950/90 via-[#151521] to-blue-950/90 text-slate-300 select-none ${className}`}
        role="img"
        aria-label={alt}
      >
        <Music2 className="w-7 h-7 text-violet-400/80" />
        {fallbackLabel ? (
          <span className="mt-1.5 px-2 text-[11px] font-medium text-slate-400 truncate max-w-full">
            {fallbackLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}
