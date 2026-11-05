import { describe, expect, it } from 'vitest';
import { solveHomography } from '../src/calibration/homography.js';
import { LaneStateMachine } from '../src/counting/laneStateMachine.js';
import { MotionDetector } from '../src/vision/motion.js';

// Câmera "virtual": 3 raias de 2,5 m, parede embaixo da imagem, com perspectiva
const PW = 320, PH = 180;
const RAIAS = 3, LARG = 2.5, ZONA = 8;
const W = RAIAS * LARG;
// trapézio: perto da parede é mais largo que longe (perspectiva)
const pontos = [
  { x: 0.05, y: 0.95 }, // parede esq
  { x: 0.95, y: 0.95 }, // parede dir
  { x: 0.2, y: 0.45 }, // esq a 5 m
  { x: 0.8, y: 0.45 }, // dir a 5 m
];
const h = solveHomography(
  [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: 5 }, { x: W, y: 5 }],
  pontos,
);
const hInv = solveHomography(pontos, [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: 5 }, { x: W, y: 5 }]);

function mundo(px: number, py: number) {
  const u = (px + 0.5) / PW, v = (py + 0.5) / PH;
  const w = hInv[6] * u + hInv[7] * v + hInv[8];
  return { X: (hInv[0] * u + hInv[1] * v + hInv[2]) / w, Y: (hInv[3] * u + hInv[4] * v + hInv[5]) / w };
}

let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Desenha um quadro: água azul com ondulação + nadador (mancha clara) em cada posição dada */
function quadro(t: number, nadadores: { raia: number; d: number }[], rgba: Uint8ClampedArray) {
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const { X, Y } = mundo(px, py);
      // ondas: variação suave + ruído (reflexos)
      let g = 90 + 10 * Math.sin(X * 2 + t / 400) * Math.sin(Y * 3 - t / 300) + (rand() - 0.5) * 16;
      for (const n of nadadores) {
        const cx = (n.raia + 0.5) * LARG;
        if (Math.abs(X - cx) < 0.45 && Math.abs(Y - n.d) < 0.9) g = 200 + (rand() - 0.5) * 60; // corpo + espuma
      }
      const j = (py * PW + px) * 4;
      rgba[j] = g * 0.6; rgba[j + 1] = g * 0.9; rgba[j + 2] = g; rgba[j + 3] = 255;
    }
  }
}

function detector() {
  return new MotionDetector({
    h,
    divisorias: Array.from({ length: RAIAS + 1 }, (_, i) => i * LARG),
    zona: ZONA,
    pw: PW,
    ph: PH,
  });
}

const FPS = 12, DT = 1000 / FPS;

describe('detector de movimento', () => {
  it('estima a posição do nadador com erro < 0,6 m e não acusa raias vazias', () => {
    const det = detector();
    const rgba = new Uint8ClampedArray(PW * PH * 4);
    let t = 0;
    for (let i = 0; i < FPS * 6; i++, t += DT) { quadro(t, [], rgba); det.process(rgba, FPS); } // 6 s de água vazia
    const erros: number[] = [];
    let falsos = 0;
    for (let i = 0; i < FPS * 5; i++, t += DT) {
      const d = 7.5 - (6.5 * i) / (FPS * 5); // 7,5 m → 1 m
      quadro(t, [{ raia: 1, d }], rgba);
      const r = det.process(rgba, FPS);
      if (Number.isFinite(r.pos[1])) erros.push(Math.abs(r.pos[1] - d));
      if (Number.isFinite(r.pos[0]) || Number.isFinite(r.pos[2])) falsos++;
    }
    const media = erros.reduce((a, b) => a + b, 0) / erros.length;
    expect(erros.length).toBeGreaterThan(FPS * 4); // detectado em > 80% dos quadros
    expect(media).toBeLessThan(0.6);
    expect(falsos).toBeLessThan(3);
  });

  it('detector + máquina de estados: 3 chegadas em raias diferentes e nenhuma falsa', () => {
    const det = detector();
    const maquinas = Array.from({ length: RAIAS }, () => new LaneStateMachine());
    const contagens = [0, 0, 0];
    const rgba = new Uint8ClampedArray(PW * PH * 4);
    let t = 0;
    const passo = (nad: { raia: number; d: number }[]) => {
      quadro(t, nad, rgba);
      const r = det.process(rgba, FPS);
      maquinas.forEach((m, l) => {
        for (const e of m.update(t, Number.isFinite(r.pos[l]) ? r.pos[l] : null)) if (e.tipo === 'conta') contagens[l]++;
      });
      t += DT;
    };
    for (let i = 0; i < FPS * 6; i++) passo([]);
    // raia 0: chegada normal com toque; raia 2: virada olímpica (some a 2 m e reaparece a 4 m)
    for (let i = 0; i < FPS * 5; i++) passo([{ raia: 0, d: 8 - (7.5 * i) / (FPS * 5) }, { raia: 2, d: 8 - (6 * i) / (FPS * 5) }]);
    for (let i = 0; i < FPS * 2; i++) passo([{ raia: 0, d: 0.5 }]);
    for (let i = 0; i < FPS * 5; i++) passo([{ raia: 0, d: 0.5 + (7.5 * i) / (FPS * 5) }, { raia: 2, d: 4 + (4 * i) / (FPS * 5) }]);
    for (let i = 0; i < FPS * 6; i++) passo([]);
    // raia 1: chegada mais tarde
    for (let i = 0; i < FPS * 5; i++) passo([{ raia: 1, d: 8 - (7 * i) / (FPS * 5) }]);
    for (let i = 0; i < FPS * 5; i++) passo([{ raia: 1, d: 1 + (7 * i) / (FPS * 5) }]);
    for (let i = 0; i < FPS * 6; i++) passo([]);
    expect(contagens).toEqual([1, 1, 1]);
  });
});
