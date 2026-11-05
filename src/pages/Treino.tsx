import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apply,
  divisoriasPadrao,
  invert,
  mundoParaImagem,
  numeroRaia,
  type Calibracao,
  type H,
  type Pt,
} from '../calibration/homography.js';
import { formatTempo, metros, type RegraInicio } from '../counting/distance.js';
import { DEFAULT_PARAMS, LaneStateMachine, type LaneState } from '../counting/laneStateMachine.js';
import { api, type ConfigTreino, type Treino as TreinoT } from '../lib/api.js';
import { ir } from '../lib/router.js';
import type { ToMain, ToWorker } from '../vision/protocol.js';

const CONFIG_PADRAO: ConfigTreino = {
  sensibilidade: 5,
  intervaloMinS: 20,
  maxSubmersoS: 4,
  bipe: true,
  vibrar: true,
  voz: false,
};
const FPS = 12;
const PW = 320; // largura do quadro de processamento

const COR_ESTADO: Record<LaneState, string> = {
  VAZIA: '#9fb6c6',
  APROXIMANDO: '#23c4f5',
  NA_PAREDE: '#ffd23f',
  DESCANSANDO: '#ff9f43',
  AFASTANDO: '#3ddc84',
};
const NOME_ESTADO: Record<LaneState, string> = {
  VAZIA: 'vazia',
  APROXIMANDO: 'aproximando',
  NA_PAREDE: 'na parede',
  DESCANSANDO: 'descansando',
  AFASTANDO: 'afastando',
};
const ROTULO_PONTO = [
  'P1: canto ESQUERDO da parede (embaixo)',
  'P2: canto DIREITO da parede (embaixo)',
  'P3: ponto ESQUERDO na linha de referência',
  'P4: ponto DIREITO na linha de referência',
];

type Fonte = 'nenhuma' | 'camera' | 'video';
type Resultado = Extract<ToMain, { tipo: 'resultado' }>;

const chaveLocal = (id: string) => `cv_treino_${id}`;

export function Treino({ id }: { id: string }) {
  const [treino, setTreino] = useState<TreinoT | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cal, setCal] = useState<Calibracao | null>(null);
  const [config, setConfig] = useState<ConfigTreino>(CONFIG_PADRAO);
  const [comprimento, setComprimento] = useState(25);
  const [regra, setRegra] = useState<RegraInicio>('outra');
  const [tempos, setTempos] = useState<number[][]>([]);
  const [inicioMs, setInicioMs] = useState<number | null>(null);

  const [fonte, setFonte] = useState<Fonte>('nenhuma');
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [calibrando, setCalibrando] = useState(false);
  const [pontos, setPontos] = useState<Pt[]>([]);
  const [rodando, setRodando] = useState(false);
  const [escuro, setEscuro] = useState(false);
  const [debug, setDebug] = useState(false);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [velocidade, setVelocidade] = useState(1);
  const [, setTick] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [zerarArmado, setZerarArmado] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLCanvasElement>(null);
  const procRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const ocupadoRef = useRef(false);
  const ultimoEnvioRef = useRef(0);
  const maquinasRef = useRef<LaneStateMachine[]>([]);
  const resultadoRef = useRef<Resultado | null>(null);
  const rodandoRef = useRef(false);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const arrastoRef = useRef<number | null>(null);
  const mexeuDesdeRef = useRef<number | null>(null);
  const salvarTimer = useRef<number | undefined>(undefined);
  const carregadoRef = useRef(false);

  // estado "vivo" para callbacks do loop de vídeo
  const vivo = useRef({ cal, config, comprimento, regra, tempos, inicioMs, fonte });
  vivo.current = { cal, config, comprimento, regra, tempos, inicioMs, fonte };

  const agora = useCallback(() => {
    const v = videoRef.current;
    return vivo.current.fonte === 'video' && v ? v.currentTime * 1000 : Date.now();
  }, []);

  const registrar = useCallback((msg: string) => {
    setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} — ${msg}`, ...l].slice(0, 50));
  }, []);

  // ---------- carregar treino (servidor + sessão local, para sobreviver a recarregar a página) ----------
  useEffect(() => {
    api<TreinoT>(`/treinos/${id}`)
      .then((t) => {
        setTreino(t);
        setComprimento(t.comprimentoPiscina);
        setRegra(t.regraInicio);
        const cfg = { ...CONFIG_PADRAO, ...(t.config ?? {}) };
        let tempos0 = cfg.tempos ?? [];
        let inicio0 = cfg.inicioMs ?? null;
        try {
          const local = JSON.parse(localStorage.getItem(chaveLocal(id)) ?? 'null');
          if (local && local.salvoEm > new Date(t.updatedAt).getTime()) {
            tempos0 = local.tempos ?? tempos0;
            inicio0 = local.inicioMs ?? inicio0;
          }
        } catch { /* sem localStorage */ }
        setConfig(cfg);
        setTempos(tempos0);
        setInicioMs(inicio0);
        if (t.calibracao?.pontos?.length === 4) setCal(t.calibracao);
        carregadoRef.current = true;
      })
      .catch((e) => setErro((e as Error).message));
  }, [id]);

  // ---------- salvar (local na hora, servidor com atraso de 2 s) ----------
  useEffect(() => {
    if (!carregadoRef.current || !treino) return;
    try {
      localStorage.setItem(chaveLocal(id), JSON.stringify({ tempos, inicioMs, salvoEm: Date.now() }));
    } catch { /* ignore */ }
    window.clearTimeout(salvarTimer.current);
    salvarTimer.current = window.setTimeout(() => {
      const raias = cal
        ? Array.from({ length: cal.nRaias }, (_, i) => {
            const ts = tempos[i] ?? [];
            const parciais = ts.slice(1).map((v, k) => Math.round(v - ts[k]));
            return {
              raia: numeroRaia(cal, i),
              chegadas: ts.length,
              metros: metros(ts.length, comprimento, regra),
              parciais,
              tempoTotalMs: ts.length && inicioMs != null ? Math.max(0, Math.round(ts[ts.length - 1] - inicioMs)) : 0,
            };
          })
        : undefined;
      api(`/treinos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          comprimentoPiscina: comprimento,
          regraInicio: regra,
          calibracao: cal,
          config: { ...config, tempos, inicioMs },
          raias,
        }),
      }).catch(() => setAviso('Sem conexão: as contagens ficam salvas no celular e vão para o servidor depois.'));
    }, 2000);
  }, [id, treino, tempos, inicioMs, cal, config, comprimento, regra]);

  // ---------- máquinas de estado (uma por raia) ----------
  useEffect(() => {
    if (!cal) return;
    const params = {
      ...DEFAULT_PARAMS,
      zona: cal.zona,
      inicioAproximacao: Math.min(DEFAULT_PARAMS.inicioAproximacao, cal.zona - 1.5),
      intervaloMinMs: config.intervaloMinS * 1000,
      maxSubmersoMs: config.maxSubmersoS * 1000,
    };
    const ms = maquinasRef.current;
    maquinasRef.current = Array.from({ length: cal.nRaias }, (_, i) => {
      const m = ms[i] ?? new LaneStateMachine(params);
      m.params = params;
      return m;
    });
    setTempos((t) => (t.length === cal.nRaias ? t : Array.from({ length: cal.nRaias }, (_, i) => t[i] ?? [])));
  }, [cal, config.intervaloMinS, config.maxSubmersoS]);

  // ---------- worker de visão ----------
  useEffect(() => {
    const w = new Worker(new URL('../vision/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<ToMain>) => {
      ocupadoRef.current = false;
      if (e.data.tipo !== 'resultado') return;
      resultadoRef.current = e.data;
      if (rodandoRef.current) processarResultado(e.data);
    };
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = workerRef.current;
    if (!w || !cal || !dims) return;
    let h: H;
    try {
      h = mundoParaImagem(cal);
    } catch {
      setAviso('Calibração inválida: refaça os 4 pontos.');
      return;
    }
    const ph = Math.round((PW * dims.h) / dims.w);
    const msg: ToWorker = {
      tipo: 'setup',
      setup: { h, divisorias: cal.divisorias, zona: cal.zona, pw: PW, ph },
      sensibilidade: config.sensibilidade,
      debug,
    };
    w.postMessage(msg);
    resultadoRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cal, dims]);

  useEffect(() => {
    workerRef.current?.postMessage({ tipo: 'opcoes', sensibilidade: config.sensibilidade, debug } satisfies ToWorker);
  }, [config.sensibilidade, debug]);

  // ---------- contagem ----------
  const avisarContagem = useCallback((i: number, total: number) => {
    const { cal, config, comprimento, regra } = vivo.current;
    if (config.bipe) {
      try {
        const ctx = (audioRef.current ??= new AudioContext());
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 600 + i * 80;
        g.gain.value = 0.2;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.15);
      } catch { /* sem áudio */ }
    }
    if (config.vibrar) navigator.vibrate?.(150);
    if (config.voz && cal && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(`Raia ${numeroRaia(cal, i)}, ${metros(total, comprimento, regra)} metros`);
      u.lang = 'pt-BR';
      speechSynthesis.speak(u);
    }
  }, []);

  const contar = useCallback((i: number, t: number, manual: boolean) => {
    if (!manual) avisarContagem(i, (vivo.current.tempos[i]?.length ?? 0) + 1);
    setTempos((ts) => {
      const novo = ts.map((a) => a.slice());
      while (novo.length <= i) novo.push([]);
      novo[i].push(t);
      return novo;
    });
    const { cal } = vivo.current;
    if (cal) registrar(`Raia ${numeroRaia(cal, i)}: chegada${manual ? ' (manual)' : ''}`);
  }, [avisarContagem, registrar]);

  function processarResultado(r: Resultado) {
    const ms = maquinasRef.current;
    for (let i = 0; i < ms.length; i++) {
      const d = r.pos[i];
      const ev = ms[i].update(r.t, d != null && Number.isFinite(d) ? d : null);
      for (const e of ev) {
        if (e.tipo === 'conta') contar(i, e.t, false);
        else if (e.tipo === 'ignorada' && vivo.current.cal) registrar(`Raia ${numeroRaia(vivo.current.cal, i)}: chegada ignorada (${e.motivo})`);
      }
    }
    // câmera mexeu? mudança grande na imagem inteira por mais de 2 s
    if (r.mudancaGlobal > 0.45) {
      mexeuDesdeRef.current ??= r.t;
      if (r.t - mexeuDesdeRef.current > 2000) setAviso('A imagem mudou muito: a câmera se mexeu? Se sim, recalibre.');
    } else mexeuDesdeRef.current = null;
  }

  // ---------- loop: envia quadros ao worker e desenha a sobreposição ----------
  useEffect(() => {
    let raf = 0;
    let ultimoTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      if (v && v.readyState >= 2 && rodandoRef.current && !ocupadoRef.current && now - ultimoEnvioRef.current >= 1000 / FPS && vivo.current.cal) {
        ultimoEnvioRef.current = now;
        const ph = Math.round((PW * v.videoHeight) / v.videoWidth);
        const c = (procRef.current ??= document.createElement('canvas'));
        if (c.width !== PW || c.height !== ph) { c.width = PW; c.height = ph; }
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, PW, ph);
        const img = ctx.getImageData(0, 0, PW, ph);
        ocupadoRef.current = true;
        const msg: ToWorker = { tipo: 'quadro', t: agora(), fps: FPS, rgba: img.data.buffer };
        workerRef.current?.postMessage(msg, [img.data.buffer]);
      }
      desenhar();
      if (now - ultimoTick > 250) { ultimoTick = now; setTick((x) => x + 1); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function desenhar() {
    const cv = overlayRef.current, st = stageRef.current;
    if (!cv || !st) return;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(st.clientWidth * dpr), Hh = Math.round(st.clientHeight * dpr);
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, W, Hh);
    const px = (p: Pt) => ({ x: p.x * W, y: p.y * Hh });
    const { cal } = vivo.current;

    if (calibrandoRef.current) {
      const pts = pontosRef.current;
      g.lineWidth = 2 * dpr;
      g.strokeStyle = '#ffd23f';
      if (pts.length >= 2) { line(g, px(pts[0]), px(pts[1])); }
      if (pts.length >= 4) { line(g, px(pts[2]), px(pts[3])); line(g, px(pts[0]), px(pts[2])); line(g, px(pts[1]), px(pts[3])); }
      pts.forEach((p, i) => {
        const q = px(p);
        g.fillStyle = '#ffd23f';
        g.beginPath(); g.arc(q.x, q.y, 7 * dpr, 0, 7); g.fill();
        g.fillStyle = '#000';
        g.font = `bold ${11 * dpr}px system-ui`;
        g.textAlign = 'center';
        g.fillText(`P${i + 1}`, q.x, q.y + 4 * dpr);
      });
      return;
    }
    if (!cal) return;
    let h: H;
    try { h = mundoParaImagem(cal); } catch { return; }
    const P = (X: number, Y: number) => px(apply(h, { x: X, y: Y }));
    const x0 = cal.divisorias[0], x1 = cal.divisorias[cal.divisorias.length - 1];

    // zona e linhas a cada 2 m
    g.lineWidth = 1.5 * dpr;
    g.strokeStyle = 'rgba(255,255,255,.55)';
    for (let y = 0; y <= cal.zona + 0.01; y += 2) line(g, P(x0, y), P(x1, y));
    if (cal.zona % 2) line(g, P(x0, cal.zona), P(x1, cal.zona));
    // divisórias
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 3 * dpr;
    cal.divisorias.forEach((X) => line(g, P(X, 0), P(X, cal.zona)));
    // alças para arrastar
    if (!rodandoRef.current) {
      g.fillStyle = '#ffd23f';
      cal.divisorias.forEach((X) => { const q = P(X, 1); g.beginPath(); g.arc(q.x, q.y, 9 * dpr, 0, 7); g.fill(); });
    }
    // raias: contagem + posição do nadador
    const r = resultadoRef.current;
    const { tempos } = vivo.current;
    for (let i = 0; i < cal.nRaias; i++) {
      const cx = (cal.divisorias[i] + cal.divisorias[i + 1]) / 2;
      const m = maquinasRef.current[i];
      const lbl = P(cx, Math.min(cal.zona - 0.4, cal.zona * 0.92));
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(lbl.x - 26 * dpr, lbl.y - 14 * dpr, 52 * dpr, 22 * dpr);
      g.fillStyle = '#fff';
      g.font = `bold ${14 * dpr}px system-ui`;
      g.textAlign = 'center';
      g.fillText(`R${numeroRaia(cal, i)}: ${tempos[i]?.length ?? 0}`, lbl.x, lbl.y + 2 * dpr);
      const d = r?.pos[i];
      if (rodandoRef.current && d != null && Number.isFinite(d) && m) {
        const q = P(cx, d);
        g.fillStyle = COR_ESTADO[m.state];
        g.strokeStyle = '#000';
        g.lineWidth = 2 * dpr;
        g.beginPath(); g.arc(q.x, q.y, 10 * dpr, 0, 7); g.fill(); g.stroke();
      }
    }
    if (debugRef.current && r?.mascara) desenharDebug(r, cal);
  }

  function desenharDebug(r: Resultado, cal: Calibracao) {
    const c = debugRef.current!;
    const escala = 3;
    if (c.width !== r.cols * escala) { c.width = r.cols * escala; c.height = r.rows * escala; }
    const g = c.getContext('2d')!;
    const img = g.createImageData(r.cols, r.rows);
    const m = new Uint8ClampedArray(r.mascara!);
    // linha 0 = parede → desenhar embaixo
    for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
      const v = m[y * r.cols + x], j = ((r.rows - 1 - y) * r.cols + x) * 4;
      img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255;
    }
    const tmp = document.createElement('canvas');
    tmp.width = r.cols; tmp.height = r.rows;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, c.width, c.height);
    // perfil e posição por raia
    const x0 = cal.divisorias[0];
    for (let i = 0; i < cal.nRaias; i++) {
      const a = (cal.divisorias[i] - x0) * 10 * escala, b = (cal.divisorias[i + 1] - x0) * 10 * escala;
      g.fillStyle = 'rgba(35,196,245,.6)';
      for (let k = 0; k < r.nBins; k++) {
        const v = r.perfil[i * r.nBins + k];
        const yy = c.height - (k + 1) * 5 * escala;
        g.fillRect(a, yy, Math.min(b - a, v * (b - a) * 2), 5 * escala - 1);
      }
      const d = r.pos[i];
      if (Number.isFinite(d)) {
        g.fillStyle = '#ff4d4d';
        g.fillRect(a, c.height - d * 10 * escala - 2, b - a, 4);
      }
      g.strokeStyle = '#ffd23f';
      g.beginPath(); g.moveTo(a, 0); g.lineTo(a, c.height); g.stroke();
    }
  }

  // refs para o desenho durante a calibração
  const calibrandoRef = useRef(calibrando);
  calibrandoRef.current = calibrando;
  const pontosRef = useRef(pontos);
  pontosRef.current = pontos;

  // ---------- fonte de vídeo ----------
  async function abrirCamera() {
    setAviso(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const v = videoRef.current!;
      v.srcObject = s;
      v.removeAttribute('src');
      await v.play();
      setFonte('camera');
    } catch (e) {
      setAviso(`Não foi possível abrir a câmera: ${(e as Error).message}. A página precisa de HTTPS e da permissão de câmera.`);
    }
  }

  function abrirVideo(f: File) {
    const v = videoRef.current!;
    const s = v.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
    v.src = URL.createObjectURL(f);
    v.playbackRate = velocidade;
    setFonte('video');
    void v.play().catch(() => {});
  }

  useEffect(() => () => {
    const s = videoRef.current?.srcObject as MediaStream | null;
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  function aoCarregarVideo() {
    const v = videoRef.current!;
    if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight });
    v.playbackRate = velocidade;
    if (!vivo.current.cal) iniciarCalibracao();
  }

  // ---------- tela sempre ligada ----------
  async function manterAcesa(on: boolean) {
    try {
      if (on && 'wakeLock' in navigator) wakeRef.current = await navigator.wakeLock.request('screen');
      else if (!on && wakeRef.current) { await wakeRef.current.release(); wakeRef.current = null; }
    } catch { /* sem suporte */ }
  }
  useEffect(() => {
    const f = () => { if (rodandoRef.current && document.visibilityState === 'visible') void manterAcesa(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  // ---------- controles ----------
  function iniciarPausar() {
    const novo = !rodando;
    rodandoRef.current = novo;
    setRodando(novo);
    if (novo) {
      workerRef.current?.postMessage({ tipo: 'reset' } satisfies ToWorker);
      maquinasRef.current.forEach((m) => m.reset());
      if (inicioMs == null) setInicioMs(agora());
      if (fonte === 'video') void videoRef.current?.play();
      registrar('Contagem iniciada: deixe a água sem nadadores por 5 s, se possível');
    } else registrar('Contagem pausada');
    void manterAcesa(novo);
  }

  function zerar() {
    if (!zerarArmado) {
      setZerarArmado(true);
      window.setTimeout(() => setZerarArmado(false), 3000);
      return;
    }
    setZerarArmado(false);
    setTempos((t) => t.map(() => []));
    setInicioMs(rodando ? agora() : null);
    maquinasRef.current.forEach((m) => { m.reset(); m.lastCountT = -Infinity; });
    registrar('Contagens zeradas');
  }

  function ajustar(i: number, delta: number) {
    if (delta > 0) contar(i, agora(), true);
    else setTempos((ts) => ts.map((a, k) => (k === i ? a.slice(0, -1) : a)));
  }

  function iniciarCalibracao() {
    setCalibrando(true);
    setPontos([]);
    if (rodandoRef.current) iniciarPausar();
  }

  const [form, setForm] = useState({ distRef: 5, nRaias: 6, larguraRaia: 2.5, zona: 8, primeiraRaia: 1, espelhar: false });
  useEffect(() => {
    if (cal) setForm({ distRef: cal.distRef, nRaias: cal.nRaias, larguraRaia: cal.larguraRaia, zona: cal.zona, primeiraRaia: cal.primeiraRaia, espelhar: cal.espelhar });
  }, [cal]);

  function salvarCalibracao() {
    if (pontos.length !== 4) return;
    const nova: Calibracao = {
      pontos,
      ...form,
      divisorias: divisoriasPadrao(form.nRaias, form.larguraRaia),
    };
    try {
      mundoParaImagem(nova);
    } catch {
      setAviso('Os pontos não formam um quadrilátero válido. Toque de novo.');
      return;
    }
    setCal(nova);
    setCalibrando(false);
    setAviso(null);
    registrar('Calibração salva');
  }

  // ---------- toques na imagem: pontos da calibração ou arrastar divisórias ----------
  function posNormalizada(e: React.PointerEvent) {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  }
  function onPointerDown(e: React.PointerEvent) {
    const p = posNormalizada(e);
    if (calibrando) {
      if (pontos.length < 4) setPontos((ps) => [...ps, { x: p.x, y: p.y }]);
      return;
    }
    if (!cal || rodando) return;
    const h = mundoParaImagem(cal);
    let melhor = -1, dist = 28;
    cal.divisorias.forEach((X, i) => {
      const q = apply(h, { x: X, y: 1 });
      const dd = Math.hypot((q.x - p.x) * p.r.width, (q.y - p.y) * p.r.height);
      if (dd < dist) { dist = dd; melhor = i; }
    });
    if (melhor >= 0) {
      arrastoRef.current = melhor;
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const i = arrastoRef.current;
    if (i == null || !cal) return;
    const p = posNormalizada(e);
    const w = apply(invert(mundoParaImagem(cal)), { x: p.x, y: p.y });
    const lo = i > 0 ? cal.divisorias[i - 1] + 0.8 : -cal.larguraRaia;
    const hi = i < cal.divisorias.length - 1 ? cal.divisorias[i + 1] - 0.8 : cal.nRaias * cal.larguraRaia + cal.larguraRaia;
    const X = Math.min(hi, Math.max(lo, w.x));
    setCal({ ...cal, divisorias: cal.divisorias.map((d, k) => (k === i ? X : d)) });
  }
  function onPointerUp() {
    arrastoRef.current = null;
  }

  async function finalizar() {
    if (rodando) iniciarPausar();
    await api(`/treinos/${id}`, { method: 'PUT', body: JSON.stringify({ fim: new Date().toISOString() }) }).catch(() => {});
    ir({ pagina: 'painel' });
  }

  // ---------- render ----------
  if (erro) return <main><p className="error">{erro}</p><button onClick={() => ir({ pagina: 'inicio' })}>Voltar</button></main>;
  if (!treino) return <main className="center">Carregando…</main>;

  const nRaias = cal?.nRaias ?? 0;
  const tAgora = agora();
  const decorrido = inicioMs != null ? tAgora - inicioMs : 0;
  const aquecendo = rodando && resultadoRef.current?.aquecendo;

  return (
    <main className="treino">
      <header className="bar">
        <button onClick={() => { if (rodando) iniciarPausar(); ir({ pagina: 'inicio' }); }}>← Voltar</button>
        <strong>{treino.nome ?? new Date(treino.inicio).toLocaleDateString('pt-BR')}</strong>
        <button onClick={finalizar}>Finalizar</button>
      </header>

      {fonte === 'nenhuma' && (
        <section className="painel-fonte">
          <button className="big" onClick={abrirCamera}>📷 Abrir câmera</button>
          <label className="botao-arquivo">
            🎞️ Testar com vídeo gravado
            <input type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && abrirVideo(e.target.files[0])} />
          </label>
          <p className="dica">
            Prenda o celular num tripé, no alto (2 a 3 m), olhando para dentro da piscina. A parede de chegada deve
            ficar embaixo na imagem e os últimos ~8 m de cada raia precisam aparecer.
          </p>
        </section>
      )}

      <div
        ref={stageRef}
        className={`stage ${fonte === 'nenhuma' ? 'oculto' : ''}`}
        style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <video ref={videoRef} playsInline muted autoPlay onLoadedMetadata={aoCarregarVideo} />
        <canvas ref={overlayRef} />
        {aquecendo && <div className="faixa">Aprendendo o ruído da água… deixe a área sem nadadores</div>}
      </div>

      {aviso && <p className="aviso" onClick={() => setAviso(null)}>{aviso}</p>}

      {calibrando && (
        <section className="calibracao">
          {pontos.length < 4 ? (
            <>
              <p className="passo">Toque na imagem: <strong>{ROTULO_PONTO[pontos.length]}</strong></p>
              <p className="dica">
                A linha de referência é paralela à parede, a uma distância conhecida. Ex.: bandeirinhas de costas (5 m).
                Escolha os cantos das raias extremas que você quer contar.
              </p>
            </>
          ) : (
            <>
              <div className="grid-form">
                <label>Distância da linha de referência (m)
                  <input type="number" step="0.5" min="1" value={form.distRef} onChange={(e) => setForm({ ...form, distRef: +e.target.value })} />
                </label>
                <label>Raias dentro da área
                  <input type="number" min="1" max="10" value={form.nRaias} onChange={(e) => setForm({ ...form, nRaias: +e.target.value })} />
                </label>
                <label>Largura da raia (m)
                  <input type="number" step="0.1" min="1" value={form.larguraRaia} onChange={(e) => setForm({ ...form, larguraRaia: +e.target.value })} />
                </label>
                <label>Zona monitorada (m)
                  <input type="number" step="0.5" min="4" max="15" value={form.zona} onChange={(e) => setForm({ ...form, zona: +e.target.value })} />
                </label>
                <label>Número da 1ª raia
                  <input type="number" min="0" max="10" value={form.primeiraRaia} onChange={(e) => setForm({ ...form, primeiraRaia: +e.target.value })} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={form.espelhar} onChange={(e) => setForm({ ...form, espelhar: e.target.checked })} />
                  Numerar da direita para a esquerda
                </label>
              </div>
              <button className="big" onClick={salvarCalibracao}>Salvar calibração</button>
            </>
          )}
          <div className="linha-botoes">
            <button onClick={() => setPontos([])}>Refazer pontos</button>
            {cal && <button onClick={() => setCalibrando(false)}>Cancelar</button>}
          </div>
        </section>
      )}

      {fonte !== 'nenhuma' && !calibrando && cal && (
        <section className="controles">
          <button className={`big ${rodando ? 'pausar' : ''}`} onClick={iniciarPausar}>
            {rodando ? 'Pausar' : 'Iniciar contagem'}
          </button>
          <div className="linha-botoes">
            <button onClick={zerar} className={zerarArmado ? 'perigo' : ''}>{zerarArmado ? 'Toque de novo p/ zerar' : 'Zerar'}</button>
            <button onClick={iniciarCalibracao}>Recalibrar</button>
            <button onClick={() => setEscuro(true)}>Tela escura</button>
            <button onClick={() => setDebug((d) => !d)}>{debug ? 'Ocultar depuração' : 'Depuração'}</button>
            <button onClick={() => setMostrarConfig((m) => !m)}>Ajustes</button>
          </div>
          {fonte === 'video' && (
            <div className="linha-botoes">
              Velocidade:
              {[1, 2, 4].map((s) => (
                <button key={s} className={velocidade === s ? 'ativo' : ''} onClick={() => { setVelocidade(s); if (videoRef.current) videoRef.current.playbackRate = s; }}>
                  {s}×
                </button>
              ))}
            </div>
          )}
          {!rodando && <p className="dica">Arraste as bolinhas amarelas para ajustar as divisórias das raias.</p>}
          <p className="tempo-total">Tempo: {formatTempo(decorrido)}</p>
        </section>
      )}

      {mostrarConfig && (
        <section className="ajustes grid-form">
          <label>Comprimento da piscina (m)
            <input type="number" min="10" max="100" value={comprimento} onChange={(e) => setComprimento(+e.target.value)} />
          </label>
          <label>O nadador começa
            <select value={regra} onChange={(e) => setRegra(e.target.value as RegraInicio)}>
              <option value="outra">na outra ponta (1ª chegada = {comprimento} m)</option>
              <option value="camera">do lado da câmera (cada chegada = {comprimento * 2} m)</option>
            </select>
          </label>
          <label>Sensibilidade: {config.sensibilidade}
            <input type="range" min="1" max="10" value={config.sensibilidade} onChange={(e) => setConfig({ ...config, sensibilidade: +e.target.value })} />
          </label>
          <label>Intervalo mínimo entre chegadas: {config.intervaloMinS} s
            <input type="range" min="5" max="90" value={config.intervaloMinS} onChange={(e) => setConfig({ ...config, intervaloMinS: +e.target.value })} />
          </label>
          <label>Tempo máximo submerso na virada: {config.maxSubmersoS} s
            <input type="range" min="1" max="10" value={config.maxSubmersoS} onChange={(e) => setConfig({ ...config, maxSubmersoS: +e.target.value })} />
          </label>
          <label className="check"><input type="checkbox" checked={config.bipe} onChange={(e) => setConfig({ ...config, bipe: e.target.checked })} /> Bipe a cada chegada</label>
          <label className="check"><input type="checkbox" checked={config.vibrar} onChange={(e) => setConfig({ ...config, vibrar: e.target.checked })} /> Vibrar</label>
          <label className="check"><input type="checkbox" checked={config.voz} onChange={(e) => setConfig({ ...config, voz: e.target.checked })} /> Falar a contagem</label>
        </section>
      )}

      {debug && (
        <section className="debug">
          <p className="dica">
            Máscara de movimento retificada (parede embaixo). Azul: perfil por faixa de 0,5 m. Vermelho: posição estimada.
            Processamento: {resultadoRef.current ? `${resultadoRef.current.ms.toFixed(1)} ms/quadro` : '–'}
          </p>
          <canvas ref={debugRef} className="debug-canvas" />
        </section>
      )}

      {cal && (
        <section className="cards">
          {Array.from({ length: nRaias }, (_, i) => {
            const ts = tempos[i] ?? [];
            const m = maquinasRef.current[i];
            const ultima = ts.length >= 2 ? ts[ts.length - 1] - ts[ts.length - 2] : null;
            return (
              <div key={i} className="card-raia">
                <div className="topo">
                  <span>Raia {numeroRaia(cal, i)}</span>
                  {rodando && m && <span className="estado" style={{ color: COR_ESTADO[m.state] }}>{NOME_ESTADO[m.state]}</span>}
                </div>
                <div className="numero">{ts.length}</div>
                <div className="metros">{metros(ts.length, comprimento, regra)} m</div>
                <div className="parcial">{ultima != null ? `Último 50 m: ${formatTempo(ultima)}` : ' '}</div>
                <div className="ajuste">
                  <button onClick={() => ajustar(i, -1)} disabled={!ts.length}>−1</button>
                  <button onClick={() => ajustar(i, 1)}>+1</button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {cal && <p className="dica">Mais de um nadador na mesma raia: a contagem soma as chegadas de todos.</p>}

      {log.length > 0 && (
        <details className="log">
          <summary>Registro ({log.length})</summary>
          <ul>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </details>
      )}

      {escuro && cal && (
        <div className="tela-escura" onClick={() => setEscuro(false)}>
          {Array.from({ length: nRaias }, (_, i) => (
            <div key={i}>
              <span>R{numeroRaia(cal, i)}</span>
              <strong>{tempos[i]?.length ?? 0}</strong>
              <small>{metros(tempos[i]?.length ?? 0, comprimento, regra)} m</small>
            </div>
          ))}
          <p>Toque para voltar</p>
        </div>
      )}
    </main>
  );
}

function line(g: CanvasRenderingContext2D, a: Pt, b: Pt) {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}
