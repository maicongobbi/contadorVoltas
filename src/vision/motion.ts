import { apply, type H } from '../calibration/homography.js';

/** Resolução da grade retificada (pixels por metro) */
export const RES = 10;
/** Tamanho de cada faixa do perfil longitudinal (m) */
export const BIN_M = 0.5;
/** Faixa ignorada perto das divisórias (respingos atravessam as boias) */
const MARGEM_DIVISORIA_M = 0.3;

export type MotionSetup = {
  /** homografia mundo (m) → imagem normalizada */
  h: H;
  divisorias: number[];
  zona: number;
  /** largura e altura do quadro de processamento */
  pw: number;
  ph: number;
};

export type MotionResult = {
  /** posição por raia em metros até a parede, NaN = ninguém */
  pos: Float32Array;
  /** "massa" do maior grupo de movimento por raia (0 = nada) */
  massa: Float32Array;
  /** perfil por raia: nRaias × nBins */
  perfil: Float32Array;
  nBins: number;
  /** true enquanto aprende o ruído da água (primeiros segundos) */
  aquecendo: boolean;
  /** máscara de atividade retificada (cols × rows, 0..255), só no modo depuração */
  mascara?: Uint8ClampedArray;
  cols: number;
  rows: number;
  /** fração da imagem que mudou: valor alto = câmera mexeu ou luz mudou muito */
  mudancaGlobal: number;
};

/**
 * Detector de movimento na zona retificada (seção 6.1).
 * Todos os buffers são alocados uma vez no construtor e reutilizados (treinos de 2 h).
 */
export class MotionDetector {
  readonly cols: number;
  readonly rows: number;
  readonly nRaias: number;
  readonly nBins: number;
  private idx: Int32Array; // célula → índice do pixel no quadro (-1 = fora)
  private laneOfCol: Int8Array; // coluna → raia (-1 = margem/fora)
  private cellsPerBin: Float32Array; // nRaias × nBins
  private gray: Float32Array;
  private bg: Float32Array;
  private mask: Uint8Array;
  private act: Float32Array;
  private ruido: Float32Array; // nível de ruído aprendido por raia
  private somaDiff: Float64Array;
  private contaDiff: Float64Array;
  private frames = 0;
  private out: MotionResult;

  /** sensibilidade 1..10 */
  sensibilidade = 5;
  debug = false;

  constructor(private s: MotionSetup) {
    const largura = s.divisorias[s.divisorias.length - 1] - s.divisorias[0];
    this.cols = Math.max(1, Math.round(largura * RES));
    this.rows = Math.max(1, Math.round(s.zona * RES));
    this.nRaias = s.divisorias.length - 1;
    this.nBins = Math.ceil(s.zona / BIN_M);
    const n = this.cols * this.rows;
    this.idx = new Int32Array(n);
    this.laneOfCol = new Int8Array(this.cols);
    this.gray = new Float32Array(n);
    this.bg = new Float32Array(n);
    this.mask = new Uint8Array(n);
    this.act = new Float32Array(n);
    this.ruido = new Float32Array(this.nRaias).fill(4);
    this.somaDiff = new Float64Array(this.nRaias);
    this.contaDiff = new Float64Array(this.nRaias);
    this.cellsPerBin = new Float32Array(this.nRaias * this.nBins);

    const x0 = s.divisorias[0];
    for (let c = 0; c < this.cols; c++) {
      const X = x0 + (c + 0.5) / RES;
      let lane = -1;
      for (let l = 0; l < this.nRaias; l++) {
        const a = s.divisorias[l], b = s.divisorias[l + 1];
        if (X >= a + MARGEM_DIVISORIA_M && X < b - MARGEM_DIVISORIA_M) lane = l;
      }
      this.laneOfCol[c] = lane;
    }
    for (let r = 0; r < this.rows; r++) {
      const Y = (r + 0.5) / RES;
      const bin = Math.min(this.nBins - 1, Math.floor(Y / BIN_M));
      for (let c = 0; c < this.cols; c++) {
        const p = apply(s.h, { x: x0 + (c + 0.5) / RES, y: Y });
        const px = Math.floor(p.x * s.pw), py = Math.floor(p.y * s.ph);
        const k = r * this.cols + c;
        const ok = px >= 0 && py >= 0 && px < s.pw && py < s.ph;
        this.idx[k] = ok ? py * s.pw + px : -1;
        const lane = this.laneOfCol[c];
        if (ok && lane >= 0) this.cellsPerBin[lane * this.nBins + bin]++;
      }
    }

    this.out = {
      pos: new Float32Array(this.nRaias),
      massa: new Float32Array(this.nRaias),
      perfil: new Float32Array(this.nRaias * this.nBins),
      nBins: this.nBins,
      aquecendo: true,
      cols: this.cols,
      rows: this.rows,
      mascara: new Uint8ClampedArray(n),
      mudancaGlobal: 0,
    };
  }

  /** Recomeça o aprendizado do fundo (ex.: ao iniciar ou depois de mexer na calibração) */
  reset() {
    this.frames = 0;
  }

  /** `rgba` = pixels do quadro de processamento (pw × ph × 4) */
  process(rgba: Uint8ClampedArray, fps: number): MotionResult {
    const { cols, rows, idx, gray, bg, mask, act, nRaias, nBins } = this;
    const n = cols * rows;
    const out = this.out;
    const aquecimentoFrames = Math.round(5 * fps); // 5 s para aprender o ruído

    for (let k = 0; k < n; k++) {
      const i = idx[k];
      if (i < 0) { gray[k] = 0; continue; }
      const j = i * 4;
      gray[k] = 0.3 * rgba[j] + 0.59 * rgba[j + 1] + 0.11 * rgba[j + 2];
    }

    if (this.frames === 0) {
      bg.set(gray);
      act.fill(0);
      this.ruido.fill(4);
    }
    this.frames++;
    const aquecendo = this.frames < aquecimentoFrames;
    out.aquecendo = aquecendo;

    // 1. máscara: diferença para o fundo acima do limiar adaptativo da raia
    const k = 4.6 - this.sensibilidade * 0.3; // sensibilidade alta → limiar menor
    const { somaDiff, contaDiff } = this;
    somaDiff.fill(0);
    contaDiff.fill(0);
    let mudou = 0, validos = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const q = r * cols + c;
        if (idx[q] < 0) { mask[q] = 0; continue; }
        const d = Math.abs(gray[q] - bg[q]);
        validos++;
        if (d > 25) mudou++;
        const lane = this.laneOfCol[c];
        if (lane < 0) { mask[q] = 0; continue; }
        somaDiff[lane] += d;
        contaDiff[lane]++;
        const thr = Math.max(10, this.ruido[lane] * k + 6);
        mask[q] = d > thr ? 1 : 0;
      }
    }
    out.mudancaGlobal = validos ? mudou / validos : 0;

    // 2. abertura simples: célula só fica ativa com ≥ 4 vizinhas ativas (remove pontinhos de reflexo)
    // 3. filtro temporal: média móvel exponencial (~3 quadros)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const q = r * cols + c;
        let m = 0;
        if (mask[q]) {
          let viz = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= rows) continue;
            for (let dc = -1; dc <= 1; dc++) {
              const cc = c + dc;
              if (cc < 0 || cc >= cols) continue;
              viz += mask[rr * cols + cc];
            }
          }
          m = viz >= 4 ? 1 : 0;
        }
        act[q] = act[q] * 0.55 + m * 0.45;
      }
    }

    // 4. perfil longitudinal por raia
    const perfil = out.perfil;
    perfil.fill(0);
    for (let r = 0; r < rows; r++) {
      const bin = Math.min(nBins - 1, Math.floor((r + 0.5) / RES / BIN_M));
      for (let c = 0; c < cols; c++) {
        const lane = this.laneOfCol[c];
        if (lane < 0) continue;
        const q = r * cols + c;
        if (idx[q] < 0) continue;
        perfil[lane * nBins + bin] += act[q];
      }
    }
    for (let i = 0; i < perfil.length; i++) {
      const cnt = this.cellsPerBin[i];
      perfil[i] = cnt ? perfil[i] / cnt : 0;
    }

    // 5. posição: centróide do maior grupo de faixas acima do limiar
    const limiarBin = 0.16 - this.sensibilidade * 0.008;
    const massaMin = 0.22;
    for (let l = 0; l < nRaias; l++) {
      let melhorMassa = 0, melhorPos = NaN;
      let massa = 0, soma = 0, buraco = 0;
      const fecha = () => {
        if (massa > melhorMassa) { melhorMassa = massa; melhorPos = soma / massa; }
        massa = 0; soma = 0; buraco = 0;
      };
      for (let b = 0; b < nBins; b++) {
        const v = perfil[l * nBins + b];
        if (v > limiarBin) {
          massa += v;
          soma += v * (b + 0.5) * BIN_M;
          buraco = 0;
        } else if (massa > 0 && ++buraco > 1) {
          fecha();
        }
      }
      fecha();
      const ok = melhorMassa >= massaMin && !aquecendo;
      out.pos[l] = ok ? melhorPos : NaN;
      out.massa[l] = ok ? melhorMassa : 0;
    }

    // 6. interferência entre raias vizinhas: fica só a mais forte
    for (let l = 0; l < nRaias - 1; l++) {
      const a = out.massa[l], b = out.massa[l + 1];
      if (a > 0 && b > 0 && Math.abs(out.pos[l] - out.pos[l + 1]) < 1.5) {
        if (a > b * 3) { out.pos[l + 1] = NaN; out.massa[l + 1] = 0; }
        else if (b > a * 3) { out.pos[l] = NaN; out.massa[l] = 0; }
      }
    }

    // ruído aprende só com a raia vazia (rápido no aquecimento, devagar depois)
    for (let l = 0; l < nRaias; l++) {
      if (!contaDiff[l]) continue;
      if (aquecendo || out.massa[l] === 0) {
        const media = somaDiff[l] / contaDiff[l];
        const a = aquecendo ? 0.15 : 0.01;
        this.ruido[l] = this.ruido[l] * (1 - a) + media * a;
      }
    }

    // fundo: segue rápido onde não há movimento e bem devagar onde há
    const rapido = aquecendo ? 0.15 : 0.05;
    for (let q = 0; q < n; q++) {
      const taxa = act[q] > 0.3 ? 0.003 : rapido;
      bg[q] += (gray[q] - bg[q]) * taxa;
    }

    if (this.debug && out.mascara) {
      for (let q = 0; q < n; q++) out.mascara[q] = act[q] * 255;
    }
    return out;
  }
}
