import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, LaneStateMachine } from '../src/counting/laneStateMachine.js';
import { metros } from '../src/counting/distance.js';

const FPS = 12;
const DT = 1000 / FPS;

/** Trecho de trajetória: vai de `de` até `ate` metros em `ms`; `null` = ninguém visível */
type Trecho = { de: number | null; ate?: number | null; ms: number };

function simular(trechos: Trecho[], params = DEFAULT_PARAMS, ruido = 0) {
  const m = new LaneStateMachine(params);
  const contagens: number[] = [];
  let t = 0;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (const tr of trechos) {
    const n = Math.max(1, Math.round(tr.ms / DT));
    for (let i = 0; i < n; i++) {
      let d: number | null = null;
      if (tr.de != null) {
        const ate = tr.ate ?? tr.de;
        d = tr.de + ((ate as number) - tr.de) * (i / n) + rand() * ruido;
      }
      for (const e of m.update(t, d)) if (e.tipo === 'conta') contagens.push(e.t);
      t += DT;
    }
  }
  return contagens;
}

// nadador a ~1,5 m/s: 8 m levam ~5 s
const chegada: Trecho[] = [
  { de: null, ms: 2000 },
  { de: 8, ate: 2, ms: 4000 },
  { de: 2, ate: 0.5, ms: 1000 },
];
const saida: Trecho[] = [
  { de: 0.5, ate: 8, ms: 5000 },
  { de: null, ms: 5000 },
];

describe('máquina de estados da raia', () => {
  it('chegada normal conta 1', () => {
    expect(simular([...chegada, ...saida])).toHaveLength(1);
  });

  it('virada olímpica (some 2 s perto da parede e reaparece a 5 m) conta 1', () => {
    const c = simular([
      { de: null, ms: 2000 },
      { de: 8, ate: 2.8, ms: 3500 },
      { de: null, ms: 2000 },
      { de: 5, ate: 8, ms: 2500 },
      { de: null, ms: 5000 },
    ]);
    expect(c).toHaveLength(1);
  });

  it('descanso de 30 s na parede conta só 1', () => {
    const c = simular([
      ...chegada,
      { de: 0.8, ms: 30000 },
      ...saida,
    ], DEFAULT_PARAMS, 0.2);
    expect(c).toHaveLength(1);
  });

  it('descanso em que o nadador some do detector (fica parado) conta só 1', () => {
    const c = simular([
      ...chegada,
      { de: 0.8, ms: 3000 },
      { de: null, ms: 40000 },
      { de: 1, ate: 8, ms: 5000 },
      { de: null, ms: 5000 },
    ]);
    expect(c).toHaveLength(1);
  });

  it('nadador que desiste a 4 m não conta', () => {
    const c = simular([
      { de: null, ms: 2000 },
      { de: 8, ate: 4, ms: 3000 },
      { de: 4, ate: 8, ms: 3000 },
      { de: null, ms: 5000 },
    ]);
    expect(c).toHaveLength(0);
  });

  it('respingo isolado perto da parede não conta', () => {
    const c = simular([
      { de: null, ms: 2000 },
      { de: 1, ms: 200 },
      { de: null, ms: 2000 },
      { de: 1.5, ms: 100 },
      { de: null, ms: 5000 },
    ]);
    expect(c).toHaveLength(0);
  });

  it('alguém parado na borda (movimento que não percorre a zona) não conta', () => {
    const c = simular([{ de: null, ms: 1000 }, { de: 1, ms: 60000 }], DEFAULT_PARAMS, 0.3);
    expect(c).toHaveLength(0);
  });

  it('dois nadadores em sequência (30 s de diferença) contam 2', () => {
    const c = simular([
      ...chegada, ...saida,
      { de: null, ms: 15000 },
      ...chegada, ...saida,
    ]);
    expect(c).toHaveLength(2);
  });

  it('viradas seguidas dentro do intervalo mínimo contam só 1', () => {
    const c = simular([
      ...chegada,
      { de: 0.5, ate: 6, ms: 2000 },
      { de: 6, ate: 0.5, ms: 2000 },
      ...saida,
    ]);
    expect(c).toHaveLength(1);
  });

  it('treino com 10 chegadas e ruído conta 10', () => {
    const volta: Trecho[] = [...chegada, ...saida, { de: null, ms: 20000 }];
    const c = simular(Array.from({ length: 10 }, () => volta).flat(), DEFAULT_PARAMS, 0.4);
    expect(c).toHaveLength(10);
  });

  it('virada olímpica registra o horário em que o nadador sumiu', () => {
    const c = simular([
      { de: null, ms: 1000 },
      { de: 8, ate: 2.8, ms: 3500 },
      { de: null, ms: 2000 },
      { de: 5, ate: 8, ms: 2500 },
    ]);
    expect(c[0]).toBeGreaterThan(4000);
    expect(c[0]).toBeLessThan(4700);
  });
});

describe('metros', () => {
  it('começando na outra ponta', () => {
    expect(metros(1, 25, 'outra')).toBe(25);
    expect(metros(4, 25, 'outra')).toBe(175);
  });
  it('começando do lado da câmera', () => {
    expect(metros(1, 25, 'camera')).toBe(50);
    expect(metros(4, 25, 'camera')).toBe(200);
  });
  it('zero chegadas', () => {
    expect(metros(0, 25, 'outra')).toBe(0);
  });
});
