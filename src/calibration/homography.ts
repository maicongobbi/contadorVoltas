export type Pt = { x: number; y: number };
/** Matriz 3x3 em ordem de linhas */
export type H = number[];

/** Homografia que leva src[i] → dst[i] (4 pares de pontos). */
export function solveHomography(src: Pt[], dst: Pt[]): H {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) throw new Error('Pontos inválidos (alinhados ou repetidos)');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function apply(h: H, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

export function invert(h: H): H {
  const [a, b, c, d, e, f, g, i, j] = h;
  const A = e * j - f * i, B = -(d * j - f * g), C = d * i - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Homografia não inversível');
  const inv = [
    A, -(b * j - c * i), b * f - c * e,
    B, a * j - c * g, -(a * f - c * d),
    C, -(a * i - b * g), a * e - b * d,
  ].map((v) => v / det);
  return inv.map((v) => v / inv[8]);
}

/**
 * Calibração salva por treino.
 * Mundo em metros: X na largura das raias (0 = borda esquerda monitorada), Y = distância até a parede.
 * Pontos da imagem são normalizados (0..1) em relação ao quadro do vídeo.
 */
export type Calibracao = {
  /** P1 parede-esq, P2 parede-dir, P3 esq na distância de referência, P4 dir na distância de referência */
  pontos: Pt[];
  distRef: number;
  nRaias: number;
  larguraRaia: number;
  zona: number;
  /** posição X (m) de cada divisória, nRaias + 1 valores */
  divisorias: number[];
  /** numerar as raias da direita para a esquerda */
  espelhar: boolean;
  /** número da primeira raia monitorada (ex.: 3 se a câmera pega as raias 3 a 8) */
  primeiraRaia: number;
};

export function divisoriasPadrao(nRaias: number, larguraRaia: number) {
  return Array.from({ length: nRaias + 1 }, (_, i) => i * larguraRaia);
}

/** Homografia mundo (m) → imagem (normalizada) */
export function mundoParaImagem(cal: Calibracao): H {
  const W = cal.nRaias * cal.larguraRaia;
  const mundo = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: 0, y: cal.distRef },
    { x: W, y: cal.distRef },
  ];
  return solveHomography(mundo, cal.pontos);
}

export function numeroRaia(cal: Calibracao, i: number) {
  return cal.primeiraRaia + (cal.espelhar ? cal.nRaias - 1 - i : i);
}
