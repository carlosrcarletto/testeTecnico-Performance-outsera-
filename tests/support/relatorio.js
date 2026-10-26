// Gera o relatório de fim de teste a partir do resumo do k6 (handleSummary):
//   relatorios/<nome>/index.html  → relatório visual (abrir no navegador)
//   relatorios/<nome>/resumo.md   → mesmo conteúdo em Markdown (usado no GitHub Actions)
//   relatorios/<nome>/resumo.json → dados brutos do k6, para comparar execuções
//   terminal                      → resumo em texto
// Inclui um diagnóstico automático com regras simples para apontar gargalos.

const ENDPOINTS = [
  { tag: "produtos", rota: "GET /api/produtos", descricao: "Listar produtos (vitrine)" },
  { tag: "produto", rota: "GET /api/produtos/:id", descricao: "Detalhe do produto" },
  { tag: "login", rota: "POST /api/login", descricao: "Login (hash de senha)" },
  { tag: "pedidos", rota: "POST /api/pedidos", descricao: "Criar pedido (grava no banco)" },
];

const FASES = [
  { metrica: "http_req_blocked", nome: "Bloqueado", descricao: "esperando conexão livre / DNS" },
  { metrica: "http_req_connecting", nome: "Conectando", descricao: "abrindo conexão TCP" },
  { metrica: "http_req_sending", nome: "Enviando", descricao: "enviando a requisição" },
  { metrica: "http_req_waiting", nome: "Esperando (TTFB)", descricao: "servidor processando" },
  { metrica: "http_req_receiving", nome: "Recebendo", descricao: "baixando a resposta" },
];

const DESCRICAO_METRICAS = {
  http_req_failed: "Taxa de erro HTTP",
  http_req_duration: "Tempo de resposta (todas as requisições)",
  checks: "Verificações funcionais aprovadas",
  jornada_compra_sucesso: "Jornadas de compra concluídas",
  jornada_compra_duracao: "Tempo de resposta somado da jornada",
};

// ---------- Formatação ----------
function formatarMs(v) {
  if (v === undefined || v === null || isNaN(v)) return "—";
  if (v >= 1000) return `${formatarNum(v / 1000, 2)} s`;
  if (v >= 10) return `${formatarNum(v)} ms`;
  return `${formatarNum(v, 1)} ms`;
}
const formatarPct = (v) => (v === undefined || isNaN(v) ? "—" : `${formatarNum(v * 100, 2)}%`);
// O runtime do k6 não tem Intl completo, então o formato pt-BR (1.234,5) é feito à mão
function formatarNum(v, casas = 0) {
  if (v === undefined || v === null || isNaN(v)) return "—";
  const [inteiro, decimal] = Number(v).toFixed(casas).split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `${comMilhar},${decimal}` : comMilhar;
}

function descreverMetrica(chave) {
  const m = /^([^{]+)\{endpoint:([^}]+)\}$/.exec(chave);
  if (m) {
    const ep = ENDPOINTS.find((e) => e.tag === m[2]);
    const base = m[1] === "http_req_failed" ? "Taxa de erro" : "Tempo de resposta";
    return `${base}: ${ep ? ep.rota : m[2]}`;
  }
  return DESCRICAO_METRICAS[chave] || chave;
}

const escaparHtml = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- Coleta dos números ----------
function valor(data, metrica, estatistica) {
  const m = data.metrics[metrica];
  return m && m.values ? m.values[estatistica] : undefined;
}

function checksComFalha(grupo, acumulado = []) {
  for (const c of grupo.checks || []) if (c.fails > 0) acumulado.push(c);
  for (const g of grupo.groups || []) checksComFalha(g, acumulado);
  return acumulado;
}

function coletar(data, titulo) {
  const limites = [];
  for (const [metrica, m] of Object.entries(data.metrics)) {
    for (const [regra, r] of Object.entries(m.thresholds || {})) {
      limites.push({ metrica, descricao: descreverMetrica(metrica), regra, ok: r.ok });
    }
  }
  limites.sort((a, b) => Number(a.ok) - Number(b.ok) || a.descricao.localeCompare(b.descricao));

  const endpoints = ENDPOINTS.filter((e) => data.metrics[`http_req_duration{endpoint:${e.tag}}`]).map((e) => {
    const chave = `http_req_duration{endpoint:${e.tag}}`;
    return {
      ...e,
      media: valor(data, chave, "avg"),
      p90: valor(data, chave, "p(90)"),
      p95: valor(data, chave, "p(95)"),
      p99: valor(data, chave, "p(99)"),
      max: valor(data, chave, "max"),
      erro: valor(data, `http_req_failed{endpoint:${e.tag}}`, "rate"),
    };
  });

  const temServidor = !!data.metrics.api_cpu_medio_percent;
  return {
    titulo,
    geradoEm: new Date().toISOString(),
    duracaoSeg: data.state.testRunDurationMs / 1000,
    vusMax: valor(data, "vus_max", "max"),
    requisicoes: valor(data, "http_reqs", "count"),
    rps: valor(data, "http_reqs", "rate"),
    iteracoes: valor(data, "iterations", "count"),
    iteracoesPorSeg: valor(data, "iterations", "rate"),
    taxaErro: valor(data, "http_req_failed", "rate"),
    checks: {
      taxa: valor(data, "checks", "rate"),
      aprovadas: valor(data, "checks", "passes"),
      reprovadas: valor(data, "checks", "fails"),
    },
    pedidos: valor(data, "pedidos_criados", "count"),
    jornadaSucesso: valor(data, "jornada_compra_sucesso", "rate"),
    jornadaP95: valor(data, "jornada_compra_duracao", "p(95)"),
    duracao: {
      media: valor(data, "http_req_duration", "avg"),
      p95: valor(data, "http_req_duration", "p(95)"),
      p99: valor(data, "http_req_duration", "p(99)"),
      max: valor(data, "http_req_duration", "max"),
    },
    fases: FASES.map((f) => ({ ...f, media: valor(data, f.metrica, "avg"), p95: valor(data, f.metrica, "p(95)") })),
    endpoints,
    servidor: temServidor
      ? {
          cpu: valor(data, "api_cpu_medio_percent", "value"),
          lagP99: valor(data, "api_event_loop_lag_p99_ms", "value"),
          lagMax: valor(data, "api_event_loop_lag_max_ms", "value"),
          filaMax: valor(data, "api_fila_banco_max", "value"),
          pool: valor(data, "api_pool_banco", "value"),
          rps: valor(data, "api_requisicoes_por_segundo", "value"),
        }
      : null,
    limites,
    checksFalhos: checksComFalha(data.root_group),
  };
}

// ---------- Diagnóstico automático ----------
function diagnosticar(r) {
  const achados = [];
  const add = (nivel, texto) => achados.push({ nivel, texto });

  const violados = r.limites.filter((l) => !l.ok);
  if (!violados.length) add("ok", `Todos os ${r.limites.length} SLOs foram atendidos.`);
  else add("alerta", `${violados.length} de ${r.limites.length} SLOs violados: ${violados.map((l) => `${l.descricao} (${l.regra})`).join("; ")}.`);

  if (r.taxaErro >= 0.01) {
    const comErro = r.endpoints.filter((e) => e.erro > 0).map((e) => `${e.rota} ${formatarPct(e.erro)}`);
    add("alerta", `Taxa de erro de ${formatarPct(r.taxaErro)}${comErro.length ? ` (${comErro.join(", ")})` : ""}: a API está recusando ou derrubando requisições sob esta carga.`);
  } else if (r.taxaErro > 0) {
    add("info", `Erros pontuais: ${formatarPct(r.taxaErro)} das requisições falharam (dentro do SLO de 1%).`);
  } else {
    add("ok", "Nenhuma requisição falhou: a API se manteve disponível durante todo o teste.");
  }

  const comP95 = r.endpoints.filter((e) => e.p95 !== undefined);
  if (comP95.length > 1) {
    const ordenados = [...comP95].sort((a, b) => b.p95 - a.p95);
    const lento = ordenados[0];
    const rapido = ordenados[ordenados.length - 1];
    const vezes = lento.p95 / Math.max(rapido.p95, 0.1);
    const violouSlo = r.limites.some((l) => l.metrica === `http_req_duration{endpoint:${lento.tag}}` && !l.ok);
    if (violouSlo) {
      add("alerta", `Gargalo principal: ${lento.rota} com p95 de ${formatarMs(lento.p95)}, acima do SLO e ${formatarNum(vezes, 0)}x o endpoint mais rápido (${rapido.rota}, ${formatarMs(rapido.p95)}).`);
    } else if (vezes >= 3 && lento.p95 >= 50) {
      add("info", `Endpoint mais lento: ${lento.rota} com p95 de ${formatarMs(lento.p95)}, ${formatarNum(vezes, 0)}x o mais rápido (${rapido.rota}, ${formatarMs(rapido.p95)}). Ainda dentro do SLO, mas é o primeiro candidato a gargalo se a carga crescer.`);
    } else {
      add("info", `Endpoint mais lento: ${lento.rota} com p95 de ${formatarMs(lento.p95)} (${formatarNum(vezes, 1)}x o mais rápido), dentro do SLO.`);
    }
  }

  const espera = r.fases.find((f) => f.metrica === "http_req_waiting");
  const bloqueio = r.fases.find((f) => f.metrica === "http_req_blocked");
  if (espera && r.duracao.media > 0) {
    const fatia = espera.media / r.duracao.media;
    if (fatia >= 0.8) {
      add("info", `${formatarPct(fatia)} do tempo médio de resposta é espera pelo servidor (TTFB): o custo está no processamento da API, não na rede.`);
    } else {
      add("alerta", `Só ${formatarPct(fatia)} do tempo é processamento do servidor: rede, conexões ou o próprio gerador de carga estão pesando no resultado.`);
    }
  }
  if (bloqueio && bloqueio.p95 > 10) {
    add("alerta", `Requisições esperando conexão livre (bloqueado p95 ${formatarMs(bloqueio.p95)}): sinal de limite de conexões no servidor ou de gerador de carga sobrecarregado.`);
  }

  const s = r.servidor;
  if (s) {
    if (s.lagP99 > 50) {
      const login = r.endpoints.find((e) => e.tag === "login");
      const suspeito = login && comP95.length && login.p95 === Math.max(...comP95.map((e) => e.p95))
        ? " O login, que calcula hash de senha de forma síncrona, é o endpoint mais lento: principal suspeito."
        : "";
      add("alerta", `Event loop do servidor travado (lag p99 ${formatarMs(s.lagP99)}, máximo ${formatarMs(s.lagMax)}): processamento síncrono pesado atrasa TODAS as rotas, inclusive as leves.${suspeito}`);
    } else {
      add("ok", `Event loop saudável (lag p99 ${formatarMs(s.lagP99)}).`);
    }

    if (s.filaMax > 0) {
      add("alerta", `Pool do banco saturado: até ${formatarNum(s.filaMax)} pedidos aguardaram conexão (pool com ${formatarNum(s.pool)}). Afeta diretamente POST /api/pedidos.`);
    } else {
      add("ok", `Pool do banco (${formatarNum(s.pool)} conexões) nunca formou fila.`);
    }

    if (s.cpu >= 80) add("alerta", `CPU do processo da API em ${s.cpu}% de média: perto da saturação de um núcleo.`);
    else if (s.cpu >= 50) add("info", `CPU do processo da API em ${s.cpu}% de média: ainda há folga, mas pouca para picos.`);
    else add("ok", `CPU do processo da API em ${s.cpu}% de média.`);
  } else {
    add("info", "Sem métricas do servidor (/metricas indisponível): o diagnóstico usa só a visão do cliente.");
  }

  if (r.checksFalhos.length) {
    add("alerta", `Verificações com falha: ${r.checksFalhos.map((c) => `"${c.name}" (${c.fails}x)`).join(", ")}.`);
  }

  add("info", `Vazão: ${formatarNum(r.rps, 1)} req/s e ${formatarNum(r.iteracoesPorSeg, 1)} jornadas/s com até ${formatarNum(r.vusMax)} usuários simultâneos.`);
  return achados;
}

// ---------- Saídas ----------
const ICONE = { ok: "✅", alerta: "⚠️", info: "ℹ️" };

function gerarMarkdown(r, achados) {
  const linhas = [];
  linhas.push(`# ${r.titulo}`, "", `Gerado em ${r.geradoEm}`, "");
  linhas.push("## Resumo", "", "| Indicador | Valor |", "|---|---|");
  linhas.push(
    `| Duração | ${formatarNum(r.duracaoSeg / 60, 1)} min |`,
    `| Usuários simultâneos (máx.) | ${formatarNum(r.vusMax)} |`,
    `| Requisições | ${formatarNum(r.requisicoes)} (${formatarNum(r.rps, 1)} req/s) |`,
    `| Jornadas de compra | ${formatarNum(r.iteracoes)} (${formatarNum(r.iteracoesPorSeg, 1)}/s) |`,
    `| Pedidos criados | ${formatarNum(r.pedidos)} |`,
    `| Taxa de erro HTTP | ${formatarPct(r.taxaErro)} |`,
    `| Verificações aprovadas | ${formatarPct(r.checks.taxa)} (${formatarNum(r.checks.reprovadas)} falhas) |`,
    `| Tempo de resposta p95 / p99 | ${formatarMs(r.duracao.p95)} / ${formatarMs(r.duracao.p99)} |`,
    "",
  );
  linhas.push("## Diagnóstico automático", "");
  for (const a of achados) linhas.push(`- ${ICONE[a.nivel]} ${a.texto}`);
  linhas.push("", "## SLOs (thresholds)", "", "| Resultado | Métrica | Regra |", "|---|---|---|");
  for (const l of r.limites) linhas.push(`| ${l.ok ? "✅ ok" : "❌ violado"} | ${l.descricao} | \`${l.regra}\` |`);
  if (r.endpoints.length) {
    linhas.push("", "## Tempo de resposta por endpoint", "", "| Endpoint | Média | p90 | p95 | p99 | Máx | Erros |", "|---|---|---|---|---|---|---|");
    for (const e of r.endpoints) {
      linhas.push(`| ${e.rota} | ${formatarMs(e.media)} | ${formatarMs(e.p90)} | ${formatarMs(e.p95)} | ${formatarMs(e.p99)} | ${formatarMs(e.max)} | ${formatarPct(e.erro)} |`);
    }
  }
  linhas.push("", "## Onde o tempo é gasto (todas as requisições)", "", "| Fase | O que é | Média | p95 |", "|---|---|---|---|");
  for (const f of r.fases) linhas.push(`| ${f.nome} | ${f.descricao} | ${formatarMs(f.media)} | ${formatarMs(f.p95)} |`);
  if (r.servidor) {
    const s = r.servidor;
    linhas.push(
      "", "## Visão do servidor (/metricas)", "", "| Indicador | Valor |", "|---|---|",
      `| CPU média do processo | ${s.cpu}% |`,
      `| Lag do event loop p99 / máx | ${formatarMs(s.lagP99)} / ${formatarMs(s.lagMax)} |`,
      `| Fila máxima no pool do banco | ${formatarNum(s.filaMax)} (pool de ${formatarNum(s.pool)}) |`,
      `| Requisições por segundo (servidor) | ${formatarNum(s.rps)} |`,
    );
  }
  linhas.push("");
  return linhas.join("\n");
}

function gerarTexto(r, achados, nome) {
  const t = [];
  t.push("", `══ ${r.titulo} ══`, "");
  t.push(`Duração ${formatarNum(r.duracaoSeg / 60, 1)} min | VUs máx ${formatarNum(r.vusMax)} | ${formatarNum(r.requisicoes)} req (${formatarNum(r.rps, 1)}/s) | erros ${formatarPct(r.taxaErro)} | p95 ${formatarMs(r.duracao.p95)}`);
  t.push("", "Por endpoint (p95 / p99 / erros):");
  for (const e of r.endpoints) t.push(`  ${e.rota.padEnd(24)} ${formatarMs(e.p95).padStart(9)} ${formatarMs(e.p99).padStart(9)} ${formatarPct(e.erro).padStart(8)}`);
  t.push("", "SLOs:");
  for (const l of r.limites) t.push(`  ${l.ok ? "✓" : "✗"} ${l.descricao}: ${l.regra}`);
  t.push("", "Diagnóstico:");
  for (const a of achados) t.push(`  ${ICONE[a.nivel]} ${a.texto}`);
  t.push("", `Relatório completo: relatorios/${nome}/index.html`, "");
  return t.join("\n");
}

function gerarHtml(r, achados) {
  const e = escaparHtml;
  const cartao = (rotulo, v, ok) =>
    `<div class="cartao ${ok === undefined ? "" : ok ? "bom" : "ruim"}"><span>${e(rotulo)}</span><strong>${e(v)}</strong></div>`;
  const algumViolado = r.limites.some((l) => !l.ok);

  const linhasEndpoints = r.endpoints
    .map((x) => {
      const maiorP95 = Math.max(...r.endpoints.map((y) => y.p95 || 0), 1);
      const largura = Math.max(2, Math.round(((x.p95 || 0) / maiorP95) * 100));
      return `<tr><td><code>${e(x.rota)}</code><br><small>${e(x.descricao)}</small></td>
        <td>${formatarMs(x.media)}</td><td>${formatarMs(x.p90)}</td>
        <td><div class="barra"><i style="width:${largura}%"></i><b>${formatarMs(x.p95)}</b></div></td>
        <td>${formatarMs(x.p99)}</td><td>${formatarMs(x.max)}</td>
        <td class="${x.erro > 0 ? "txt-ruim" : ""}">${formatarPct(x.erro)}</td></tr>`;
    })
    .join("");

  const s = r.servidor;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(r.titulo)}</title>
<style>
:root{--fundo:#f5f6f8;--sup:#fff;--txt:#1d2330;--suave:#5b6475;--borda:#dde1e8;--bom:#1b7f3b;--ruim:#c62828;--info:#1f6feb;--barra:#9cc0f9;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--fundo:#12151b;--sup:#1b1f27;--txt:#e6e9ef;--suave:#9aa3b2;--borda:#2c323d;--bom:#4cc277;--ruim:#ff6b6b;--info:#6ea8fe;--barra:#2f5597;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--fundo);color:var(--txt);line-height:1.5}
main{max-width:1100px;margin:0 auto;padding:1.5rem}h1{margin:0 0 .25rem}h2{margin-top:2rem}.sub{color:var(--suave);margin:0}
.status{display:inline-block;margin-top:.75rem;padding:.35rem .8rem;border-radius:999px;font-weight:700;color:#fff;background:${algumViolado ? "var(--ruim)" : "var(--bom)"}}
.cartoes{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.75rem;margin-top:1.25rem}
.cartao{background:var(--sup);border:1px solid var(--borda);border-radius:10px;padding:.8rem 1rem;border-top:4px solid var(--info)}
.cartao.bom{border-top-color:var(--bom)}.cartao.ruim{border-top-color:var(--ruim)}
.cartao span{display:block;color:var(--suave);font-size:.85rem}.cartao strong{font-size:1.35rem}
.rolagem{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--sup);border:1px solid var(--borda);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:.6rem .75rem;border-bottom:1px solid var(--borda);vertical-align:top}th{font-size:.85rem;color:var(--suave)}
small{color:var(--suave)}code{font-size:.9em}
.barra{position:relative;min-width:140px;background:var(--fundo);border-radius:4px;height:1.6rem}
.barra i{position:absolute;inset:0 auto 0 0;background:var(--barra);border-radius:4px}.barra b{position:relative;padding-left:.4rem;line-height:1.6rem}
ul.achados{list-style:none;padding:0}ul.achados li{background:var(--sup);border:1px solid var(--borda);border-left:4px solid var(--info);border-radius:8px;padding:.6rem .9rem;margin-bottom:.5rem}
ul.achados li.ok{border-left-color:var(--bom)}ul.achados li.alerta{border-left-color:var(--ruim)}
.txt-bom{color:var(--bom);font-weight:700}.txt-ruim{color:var(--ruim);font-weight:700}
a{color:var(--info)}.nota{color:var(--suave);font-size:.9rem}
</style></head><body><main>
<h1>${e(r.titulo)}</h1>
<p class="sub">Gerado em ${e(r.geradoEm)} · duração ${formatarNum(r.duracaoSeg / 60, 1)} min</p>
<span class="status">${algumViolado ? "SLOs violados" : "Todos os SLOs atendidos"}</span>

<div class="cartoes">
${cartao("Usuários simultâneos (máx.)", formatarNum(r.vusMax))}
${cartao("Requisições", `${formatarNum(r.requisicoes)}`)}
${cartao("Vazão", `${formatarNum(r.rps, 1)} req/s`)}
${cartao("Taxa de erro", formatarPct(r.taxaErro), r.taxaErro < 0.01)}
${cartao("Tempo p95", formatarMs(r.duracao.p95), r.duracao.p95 < 500)}
${cartao("Tempo p99", formatarMs(r.duracao.p99), r.duracao.p99 < 1500)}
${cartao("Jornadas concluídas", formatarPct(r.jornadaSucesso), r.jornadaSucesso > 0.99)}
${cartao("Pedidos criados", formatarNum(r.pedidos))}
</div>

<h2>Diagnóstico automático</h2>
<ul class="achados">${achados.map((a) => `<li class="${a.nivel}">${ICONE[a.nivel]} ${e(a.texto)}</li>`).join("")}</ul>
<p class="nota">Regras simples aplicadas sobre as métricas; a análise completa e as recomendações estão em <code>docs/ANALISE.md</code>.</p>

<h2>SLOs (thresholds)</h2>
<div class="rolagem"><table><thead><tr><th>Resultado</th><th>Métrica</th><th>Regra</th></tr></thead><tbody>
${r.limites.map((l) => `<tr><td class="${l.ok ? "txt-bom" : "txt-ruim"}">${l.ok ? "✅ ok" : "❌ violado"}</td><td>${e(l.descricao)}</td><td><code>${e(l.regra)}</code></td></tr>`).join("")}
</tbody></table></div>

${r.endpoints.length ? `<h2>Tempo de resposta por endpoint</h2>
<div class="rolagem"><table><thead><tr><th>Endpoint</th><th>Média</th><th>p90</th><th>p95</th><th>p99</th><th>Máx</th><th>Erros</th></tr></thead>
<tbody>${linhasEndpoints}</tbody></table></div>` : ""}

<h2>Onde o tempo é gasto</h2>
<div class="rolagem"><table><thead><tr><th>Fase da requisição</th><th>O que é</th><th>Média</th><th>p95</th></tr></thead><tbody>
${r.fases.map((f) => `<tr><td>${e(f.nome)}</td><td>${e(f.descricao)}</td><td>${formatarMs(f.media)}</td><td>${formatarMs(f.p95)}</td></tr>`).join("")}
</tbody></table></div>

${s ? `<h2>Visão do servidor</h2>
<div class="cartoes">
${cartao("CPU média da API", `${s.cpu}%`, s.cpu < 80)}
${cartao("Lag do event loop p99", formatarMs(s.lagP99), s.lagP99 <= 50)}
${cartao("Lag do event loop máx.", formatarMs(s.lagMax))}
${cartao("Fila máx. no banco", `${formatarNum(s.filaMax)} / pool ${formatarNum(s.pool)}`, s.filaMax === 0)}
</div>` : ""}

<h2>Gráficos ao longo do tempo</h2>
<p>Abra o <a href="dashboard.html">dashboard do k6</a> para ver vazão, latência e usuários segundo a segundo.</p>
<p class="nota">O dashboard é gerado pelos comandos <code>npm run test:carga</code> e <code>npm run test:fumaca</code> (opção <code>--out web-dashboard</code>). Se o link não abrir, o teste foi executado sem essa opção.</p>
</main></body></html>`;
}

export function gerarRelatorio(data, { nome, titulo }) {
  const r = coletar(data, titulo);
  const achados = diagnosticar(r);
  return {
    stdout: gerarTexto(r, achados, nome),
    [`relatorios/${nome}/index.html`]: gerarHtml(r, achados),
    [`relatorios/${nome}/resumo.md`]: gerarMarkdown(r, achados),
    [`relatorios/${nome}/resumo.json`]: JSON.stringify({ ...data, analise: { indicadores: r, achados } }, null, 2),
  };
}
