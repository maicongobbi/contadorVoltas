export type RegraInicio = 'outra' | 'camera';

/**
 * Metros nadados a partir do número de chegadas na ponta da câmera.
 * - "outra": o nadador começa na outra ponta → L + 2L·(n−1)
 * - "camera": começa do lado da câmera → 2L·n
 */
export function metros(chegadas: number, comprimento: number, regra: RegraInicio): number {
  if (chegadas <= 0) return 0;
  return regra === 'outra' ? comprimento + 2 * comprimento * (chegadas - 1) : 2 * comprimento * chegadas;
}

export function formatTempo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
