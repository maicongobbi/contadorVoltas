import type { MotionSetup } from './motion.js';

export type ToWorker =
  | { tipo: 'setup'; setup: MotionSetup; sensibilidade: number; debug: boolean }
  | { tipo: 'opcoes'; sensibilidade: number; debug: boolean }
  | { tipo: 'reset' }
  | { tipo: 'quadro'; t: number; fps: number; rgba: ArrayBuffer };

export type ToMain =
  | {
      tipo: 'resultado';
      t: number;
      pos: number[];
      massa: number[];
      perfil: number[];
      nBins: number;
      aquecendo: boolean;
      mudancaGlobal: number;
      cols: number;
      rows: number;
      mascara?: ArrayBuffer;
      ms: number;
      /** buffer do quadro devolvido para reaproveitar */
      rgba: ArrayBuffer;
    }
  | { tipo: 'devolve'; rgba: ArrayBuffer };
