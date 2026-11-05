import type { Calibracao } from '../calibration/homography.js';
import type { RegraInicio } from '../counting/distance.js';

export type RaiaResultado = {
  id: string;
  raia: number;
  chegadas: number;
  metros: number;
  parciais: number[] | null;
  tempoTotalMs: number;
};

export type ConfigTreino = {
  sensibilidade: number;
  intervaloMinS: number;
  maxSubmersoS: number;
  bipe: boolean;
  vibrar: boolean;
  voz: boolean;
  /** horários das chegadas por raia (índice da raia na calibração), para restaurar a sessão */
  tempos?: number[][];
  inicioMs?: number | null;
};

export type Treino = {
  id: string;
  nome: string | null;
  comprimentoPiscina: number;
  regraInicio: RegraInicio;
  calibracao: Calibracao | null;
  config: ConfigTreino | null;
  inicio: string;
  fim: string | null;
  updatedAt: string;
  raias: RaiaResultado[];
};

// Chama a API Node. O cookie de sessão vai junto (mesmo domínio).
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
