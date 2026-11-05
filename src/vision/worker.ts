/// <reference lib="webworker" />
// Processamento de imagem fora da thread da interface.
import { MotionDetector, type MotionSetup } from './motion.js';
import type { ToMain, ToWorker } from './protocol.js';

let det: MotionDetector | null = null;
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.tipo === 'setup') {
    det = new MotionDetector(msg.setup as MotionSetup);
    det.sensibilidade = msg.sensibilidade;
    det.debug = msg.debug;
  } else if (msg.tipo === 'opcoes' && det) {
    det.sensibilidade = msg.sensibilidade;
    det.debug = msg.debug;
  } else if (msg.tipo === 'reset' && det) {
    det.reset();
  } else if (msg.tipo === 'quadro') {
    const buf = msg.rgba;
    if (!det) {
      ctx.postMessage({ tipo: 'devolve', rgba: buf } satisfies ToMain, [buf]);
      return;
    }
    const t0 = performance.now();
    const r = det.process(new Uint8ClampedArray(buf), msg.fps);
    const resp: ToMain = {
      tipo: 'resultado',
      t: msg.t,
      pos: Array.from(r.pos),
      massa: Array.from(r.massa),
      perfil: Array.from(r.perfil),
      nBins: r.nBins,
      aquecendo: r.aquecendo,
      mudancaGlobal: r.mudancaGlobal,
      cols: r.cols,
      rows: r.rows,
      mascara: det.debug && r.mascara ? r.mascara.slice().buffer : undefined,
      ms: performance.now() - t0,
      rgba: buf,
    };
    ctx.postMessage(resp, resp.mascara ? [buf, resp.mascara] : [buf]);
  }
};
