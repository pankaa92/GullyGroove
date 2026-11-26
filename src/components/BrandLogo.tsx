import { useId } from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md';
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  const dims = size === 'sm' ? 'h-8 w-10' : 'h-9 w-11';
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const uid = `gg-logo-${size}-${reactId}`;

  return (
    <svg
      viewBox="0 0 56 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${dims} shrink-0`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="56" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1A152B" />
          <stop offset="100%" stopColor="#0E172A" />
        </linearGradient>
        <linearGradient id={`${uid}-gg`} x1="8" y1="8" x2="48" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>
        <linearGradient id={`${uid}-wave1`} x1="2" y1="22" x2="54" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="50%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
        <linearGradient id={`${uid}-wave2`} x1="4" y1="16" x2="52" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#C084FC" />
        </linearGradient>
      </defs>

      {/* Dark obsidian badge with hairline border */}
      <rect
        x="1"
        y="1"
        width="54"
        height="38"
        rx="10"
        fill={`url(#${uid}-bg)`}
        stroke="rgba(139,92,246,0.4)"
        strokeWidth="1.2"
      />

      {/* First G */}
      <path
        d="M24.2 13.5C22.9 11.9 20.9 11 18.6 11C14.1 11 10.8 14.7 10.8 20C10.8 25.3 14.1 29 18.6 29C22.4 29 25 26.7 25.4 22.8H18.9V19.6H28.5V21.5C28.5 27.6 24.4 32 18.5 32C12.2 32 7.5 27 7.5 20C7.5 13 12.2 8 18.5 8C22 8 25.1 9.5 27 12.1L24.2 13.5Z"
        fill={`url(#${uid}-gg)`}
      />

      {/* Second G */}
      <path
        d="M45.7 13.5C44.4 11.9 42.4 11 40.1 11C35.6 11 32.3 14.7 32.3 20C32.3 25.3 35.6 29 40.1 29C43.9 29 46.5 26.7 46.9 22.8H40.4V19.6H50V21.5C50 27.6 45.9 32 40 32C33.7 32 29 27 29 20C29 13 33.7 8 40 8C43.5 8 46.6 9.5 48.5 12.1L45.7 13.5Z"
        fill={`url(#${uid}-gg)`}
      />

      {/* Secondary harmonic soundwave crossing GG */}
      <path
        d="M3 22.5C7 22.5 9.5 14 13.5 14C17.5 14 19.5 27 23.5 27C27.5 27 29.5 12 33.5 12C37.5 12 39.5 26 43.5 26C47.5 26 49.5 17.5 53 17.5"
        stroke={`url(#${uid}-wave2)`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />

      {/* Primary vibrant purple-to-electric-blue music wave crossing GG */}
      <path
        d="M2 20C6 20 8.2 26.5 12 26.5C16.2 26.5 18.5 11.5 22.8 11.5C27 11.5 29.2 28.5 33.5 28.5C37.8 28.5 40 13.5 44.2 13.5C48 13.5 50.2 20 54 20"
        stroke={`url(#${uid}-wave1)`}
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
