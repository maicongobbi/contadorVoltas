/**
 * Máquina de estados de uma raia (seção 6.2 da especificação).
 *
 * Entrada: a cada quadro, a posição do nadador `d` (metros até a parede) ou `null` se não há ninguém.
 * Saída: eventos de contagem. Conta uma vez por ciclo, na entrada em NA_PAREDE.
 *
 *   VAZIA ──(aparece no fundo, d > 5 m)──▶ APROXIMANDO
 *   APROXIMANDO ──(d < 2,5 m, ou some com d < 3 m)──▶ NA_PAREDE   → CONTA
 *   APROXIMANDO ──(volta antes de chegar)──▶ AFASTANDO            (desistiu, não conta)
 *   NA_PAREDE ──(reaparece afastando, d > 3 m)──▶ AFASTANDO
 *   NA_PAREDE ──(parado perto da parede)──▶ DESCANSANDO          (não conta de novo)
 *   DESCANSANDO ──(sai afastando)──▶ AFASTANDO
 *   AFASTANDO ──(sai da zona ou some)──▶ VAZIA
 */

export type LaneState = 'VAZIA' | 'APROXIMANDO' | 'NA_PAREDE' | 'DESCANSANDO' | 'AFASTANDO';

export type LaneParams = {
  /** Tamanho da zona monitorada (m) */
  zona: number;
  /** Aparecer além desta distância inicia uma aproximação (m) */
  inicioAproximacao: number;
  /** Abaixo desta distância o nadador está "na parede" (m) */
  parede: number;
  /** Sumir abaixo desta distância = virada submersa (m) */
  sumiuPerto: number;
  /** Reaparecer além desta distância = afastando (m) */
  saida: number;
  /** Tempo parado perto da parede para virar DESCANSANDO (ms) */
  descansoMs: number;
  /** Tempo máximo submerso na virada (ms) */
  maxSubmersoMs: number;
  /** Intervalo mínimo entre contagens na mesma raia (ms) */
  intervaloMinMs: number;
  /** Quanto precisa voltar (m) para considerar que desistiu */
  desistencia: number;
};

export const DEFAULT_PARAMS: LaneParams = {
  zona: 8,
  inicioAproximacao: 5,
  parede: 2.5,
  sumiuPerto: 3,
  saida: 3,
  descansoMs: 4000,
  maxSubmersoMs: 4000,
  intervaloMinMs: 20000,
  desistencia: 1,
};

export type LaneEvent =
  | { tipo: 'conta'; t: number }
  | { tipo: 'ignorada'; t: number; motivo: string }
  | { tipo: 'estado'; t: number; de: LaneState; para: LaneState };

/** Tempo sem ver o nadador para considerar que ele "sumiu" (filtra falhas de 1 ou 2 quadros) */
const SUMIU_MS = 300;
/** Janela usada para calcular a velocidade (ms) */
const JANELA_MS = 1200;

export class LaneStateMachine {
  state: LaneState = 'VAZIA';
  /** Posição suavizada no último quadro em que o nadador foi visto */
  d: number | null = null;
  lastCountT = -Infinity;

  private lastSeenT = -Infinity;
  private lastSeenD: number | null = null;
  /** Última leitura sem suavização (a suavização "atrasa" ~0,1 m) */
  private lastRaw: number | null = null;
  private stateSince = 0;
  private minD = Infinity;
  private hist: { t: number; d: number }[] = [];

  constructor(public params: LaneParams = DEFAULT_PARAMS) {}

  reset() {
    this.state = 'VAZIA';
    this.d = null;
    this.lastSeenT = -Infinity;
    this.lastSeenD = null;
    this.lastRaw = null;
    this.hist = [];
    this.minD = Infinity;
  }

  /** Velocidade em m/s (positiva = afastando da parede), ou null se faltam dados */
  velocidade(): number | null {
    const h = this.hist;
    if (h.length < 3 || h[h.length - 1].t - h[0].t < 300) return null;
    let st = 0, sd = 0;
    for (const p of h) { st += p.t; sd += p.d; }
    const mt = st / h.length, md = sd / h.length;
    let num = 0, den = 0;
    for (const p of h) { num += (p.t - mt) * (p.d - md); den += (p.t - mt) ** 2; }
    return den ? (num / den) * 1000 : null;
  }

  update(t: number, raw: number | null): LaneEvent[] {
    const p = this.params;
    const ev: LaneEvent[] = [];
    let cur: number | null = null;

    if (raw != null && Number.isFinite(raw)) {
      cur = this.d == null || t - this.lastSeenT > 1000 ? raw : this.d * 0.5 + raw * 0.5;
      this.d = cur;
      this.lastSeenT = t;
      this.lastSeenD = cur;
      this.lastRaw = raw;
      this.hist.push({ t, d: cur });
      while (this.hist.length && t - this.hist[0].t > JANELA_MS) this.hist.shift();
    }
    const sumido = cur == null ? t - this.lastSeenT : 0;

    const go = (para: LaneState) => {
      ev.push({ tipo: 'estado', t, de: this.state, para });
      this.state = para;
      this.stateSince = t;
      this.hist = cur != null ? [{ t, d: cur }] : [];
      this.minD = cur ?? Infinity;
    };
    const chegou = (tc: number) => {
      if (tc - this.lastCountT < p.intervaloMinMs) {
        ev.push({ tipo: 'ignorada', t: tc, motivo: 'antes do intervalo mínimo' });
        return;
      }
      this.lastCountT = tc;
      ev.push({ tipo: 'conta', t: tc });
    };

    switch (this.state) {
      case 'VAZIA':
        if (cur != null && cur > p.inicioAproximacao) go('APROXIMANDO');
        break;

      case 'APROXIMANDO':
        if (cur != null) {
          this.minD = Math.min(this.minD, cur);
          if (cur < p.parede) {
            chegou(t);
            go('NA_PAREDE');
          } else {
            const v = this.velocidade();
            if (v != null && v > 0.3 && cur > this.minD + p.desistencia) go('AFASTANDO');
          }
        } else if (sumido >= SUMIU_MS && this.lastRaw != null && Math.min(this.lastRaw, this.lastSeenD ?? Infinity) < p.sumiuPerto) {
          // virada olímpica: mergulhou perto da parede. Conta no horário em que sumiu.
          chegou(this.lastSeenT);
          go('NA_PAREDE');
        } else if (sumido > p.maxSubmersoMs) {
          go('VAZIA');
        }
        break;

      case 'NA_PAREDE':
        if (cur != null) {
          if (cur > p.saida) {
            const v = this.velocidade();
            if (v == null || v >= 0) go('AFASTANDO');
          } else if (t - this.stateSince > p.descansoMs) {
            go('DESCANSANDO');
          }
        } else if (sumido > p.maxSubmersoMs) {
          go('VAZIA');
        }
        break;

      case 'DESCANSANDO':
        if (cur != null) {
          if (cur > p.saida) go('AFASTANDO');
        } else if (sumido > p.maxSubmersoMs * 3) {
          // parado muito tempo some do detector (o fundo "absorve"); sair depois não conta de novo
          go('VAZIA');
        }
        break;

      case 'AFASTANDO':
        if (cur != null) {
          const v = this.velocidade();
          if (cur > p.zona - 0.5) go('VAZIA');
          else if (v != null && v < -0.4 && cur > p.inicioAproximacao) go('APROXIMANDO');
        } else if (sumido > p.maxSubmersoMs) {
          go('VAZIA');
        }
        break;
    }
    return ev;
  }
}
