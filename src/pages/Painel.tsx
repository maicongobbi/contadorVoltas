import { useEffect, useMemo, useState } from 'react';
import { formatTempo } from '../counting/distance.js';
import { api, type Treino } from '../lib/api.js';
import { ir } from '../lib/router.js';

type Periodo = '7' | '30' | 'tudo';

export function Painel() {
  const [treinos, setTreinos] = useState<Treino[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [tabela, setTabela] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    api<Treino[]>('/treinos').then(setTreinos).catch((e) => setErro((e as Error).message));
  }, []);

  const filtrados = useMemo(() => {
    if (!treinos) return [];
    if (periodo === 'tudo') return treinos;
    const desde = Date.now() - Number(periodo) * 86400000;
    return treinos.filter((t) => new Date(t.inicio).getTime() >= desde);
  }, [treinos, periodo]);

  // soma por número de raia
  const porRaia = useMemo(() => {
    const m = new Map<number, { chegadas: number; metros: number; melhor: number | null }>();
    for (const t of filtrados) {
      for (const r of t.raias) {
        const a = m.get(r.raia) ?? { chegadas: 0, metros: 0, melhor: null };
        a.chegadas += r.chegadas;
        a.metros += r.metros;
        for (const p of r.parciais ?? []) if (p > 0 && (a.melhor == null || p < a.melhor)) a.melhor = p;
        m.set(r.raia, a);
      }
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([raia, v]) => ({ raia, ...v }));
  }, [filtrados]);

  const totalChegadas = porRaia.reduce((s, r) => s + r.chegadas, 0);
  const totalMetros = porRaia.reduce((s, r) => s + r.metros, 0);

  function exportarCsv() {
    const linhas = [['data', 'treino', 'piscina_m', 'raia', 'chegadas', 'metros', 'tempo_total', 'parciais_s']];
    for (const t of filtrados) {
      for (const r of t.raias) {
        linhas.push([
          new Date(t.inicio).toISOString(),
          t.nome ?? '',
          String(t.comprimentoPiscina),
          String(r.raia),
          String(r.chegadas),
          String(r.metros),
          formatTempo(r.tempoTotalMs),
          (r.parciais ?? []).map((p) => (p / 1000).toFixed(1)).join(' '),
        ]);
      }
    }
    const csv = linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `treinos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="painel">
      <header className="bar">
        <button onClick={() => ir({ pagina: 'inicio' })}>← Treinos</button>
        <strong>Painel</strong>
        <button onClick={exportarCsv} disabled={!filtrados.length}>Exportar CSV</button>
      </header>

      <div className="filtros" role="group" aria-label="Período">
        {([['7', '7 dias'], ['30', '30 dias'], ['tudo', 'Tudo']] as const).map(([v, l]) => (
          <button key={v} className={periodo === v ? 'ativo' : ''} onClick={() => setPeriodo(v)}>{l}</button>
        ))}
      </div>

      {erro && <p className="error">{erro}</p>}
      {!treinos ? (
        <p>Carregando…</p>
      ) : (
        <>
          <section className="tiles">
            <div className="tile"><small>Treinos</small><strong>{filtrados.length}</strong></div>
            <div className="tile"><small>Chegadas</small><strong>{totalChegadas}</strong></div>
            <div className="tile"><small>Metros</small><strong>{totalMetros.toLocaleString('pt-BR')}</strong></div>
          </section>

          <section className="grafico-card">
            <div className="grafico-topo">
              <h2>Chegadas por raia</h2>
              <button onClick={() => setTabela((t) => !t)}>{tabela ? 'Ver gráfico' : 'Ver tabela'}</button>
            </div>
            {porRaia.length === 0 ? (
              <p className="dica">Nenhuma chegada no período.</p>
            ) : tabela ? (
              <TabelaRaias dados={porRaia} />
            ) : (
              <GraficoRaias dados={porRaia} hover={hover} setHover={setHover} />
            )}
          </section>

          <section>
            <h2>Treinos</h2>
            {filtrados.length === 0 && <p className="dica">Nenhum treino no período.</p>}
            <ul className="list">
              {filtrados.map((t) => {
                const tot = t.raias.reduce((s, r) => s + r.metros, 0);
                const ch = t.raias.reduce((s, r) => s + r.chegadas, 0);
                return (
                  <li key={t.id} onClick={() => ir({ pagina: 'treino', id: t.id })} className="clicavel">
                    <div>
                      <strong>{t.nome ?? new Date(t.inicio).toLocaleString('pt-BR')}</strong>
                      <small>
                        {ch} chegadas · {tot.toLocaleString('pt-BR')} m ·{' '}
                        {t.raias.filter((r) => r.chegadas > 0).map((r) => `R${r.raia}: ${r.chegadas}`).join('  ') || 'sem chegadas'}
                      </small>
                    </div>
                    <span aria-hidden>›</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

type DadoRaia = { raia: number; chegadas: number; metros: number; melhor: number | null };

function TabelaRaias({ dados }: { dados: DadoRaia[] }) {
  return (
    <table className="tabela">
      <thead><tr><th>Raia</th><th>Chegadas</th><th>Metros</th><th>Melhor 50 m</th></tr></thead>
      <tbody>
        {dados.map((d) => (
          <tr key={d.raia}>
            <td>{d.raia}</td><td>{d.chegadas}</td><td>{d.metros.toLocaleString('pt-BR')}</td><td>{d.melhor ? formatTempo(d.melhor) : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Barras verticais, uma por raia (série única: uma cor, sem legenda). */
function GraficoRaias({ dados, hover, setHover }: { dados: DadoRaia[]; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 600, H = 240, M = { t: 16, r: 8, b: 32, l: 36 };
  const max = Math.max(1, ...dados.map((d) => d.chegadas));
  const passo = niceStep(max);
  const topo = Math.ceil(max / passo) * passo;
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const slot = iw / dados.length;
  const bw = Math.min(48, slot * 0.6);
  const y = (v: number) => M.t + ih - (v / topo) * ih;
  const ticks = Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
  const h = hover != null ? dados[hover] : null;

  return (
    <div className="grafico" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chegadas por raia">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="grade" />
            <text x={M.l - 6} y={y(t) + 4} textAnchor="end" className="eixo">{t}</text>
          </g>
        ))}
        {dados.map((d, i) => {
          const cx = M.l + slot * (i + 0.5);
          const top = y(d.chegadas), base = y(0);
          const alt = Math.max(0, base - top);
          const r = Math.min(4, alt);
          return (
            <g key={d.raia}>
              {alt > 0 && (
                <path
                  className={`barra ${hover === i ? 'ativa' : ''}`}
                  d={`M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z`}
                />
              )}
              <text x={cx} y={H - 10} textAnchor="middle" className="eixo">R{d.raia}</text>
              {/* área de toque maior que a barra */}
              <rect x={cx - slot / 2} y={M.t} width={slot} height={ih} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} className="base" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((M.l + slot * (hover! + 0.5)) / W) * 100}%` }}>
          <strong>Raia {h.raia}</strong>
          <span>{h.chegadas} chegadas</span>
          <span>{h.metros.toLocaleString('pt-BR')} m</span>
          {h.melhor && <span>Melhor 50 m: {formatTempo(h.melhor)}</span>}
        </div>
      )}
    </div>
  );
}

function niceStep(max: number) {
  const bruto = max / 4;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}
