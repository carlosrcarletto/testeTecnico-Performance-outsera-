// Integração com o endpoint /metricas da API: zera os contadores no início e,
// no final, registra a visão do SERVIDOR como métricas do k6. Assim o relatório
// mostra lado a lado o que o cliente sentiu e o que o servidor sofreu.
import http from "k6/http";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { BASE_URL } from "../config/opcoes.js";

const servidorCpu = new Gauge("api_cpu_medio_percent");
const servidorLagP99 = new Gauge("api_event_loop_lag_p99_ms");
const servidorLagMax = new Gauge("api_event_loop_lag_max_ms");
const servidorFilaBanco = new Gauge("api_fila_banco_max");
const servidorPoolBanco = new Gauge("api_pool_banco");
const servidorRps = new Gauge("api_requisicoes_por_segundo");

// tags.name evita que as chamadas de controle se misturem com as da jornada
const controle = { tags: { name: "controle", endpoint: "controle" } };

export function prepararServidor() {
  const saude = http.get(`${BASE_URL}/health`, controle);
  if (saude.status !== 200) {
    exec.test.abort(`API indisponível em ${BASE_URL} (status ${saude.status}). Suba com: npm run api`);
  }
  // O reset é opcional: só existe na API mock. Numa API real o 404 é ignorado.
  http.post(`${BASE_URL}/metricas/reset`, null, controle);
  return { inicio: new Date().toISOString() };
}

export function coletarMetricasServidor() {
  const res = http.get(`${BASE_URL}/metricas`, controle);
  if (res.status !== 200) {
    console.warn("Endpoint /metricas indisponível: relatório sem a visão do servidor");
    return;
  }
  const m = res.json();
  servidorCpu.add(m.cpuMedioPercent);
  servidorLagP99.add(m.eventLoopLagMs.p99);
  servidorLagMax.add(m.eventLoopLagMs.max);
  servidorFilaBanco.add(m.banco.filaMax);
  servidorPoolBanco.add(m.banco.pool);
  servidorRps.add(m.requisicoesPorSegundo);
  console.log(`Visão do servidor: ${JSON.stringify({ cpu: m.cpuMedioPercent, lag: m.eventLoopLagMs, banco: m.banco, rps: m.requisicoesPorSegundo })}`);
}
