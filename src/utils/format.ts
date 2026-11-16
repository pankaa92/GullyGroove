export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatTotalMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

export function formatPlays(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}
