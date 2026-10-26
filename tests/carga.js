// TESTE DE CARGA: 500 usuários simultâneos por 5 minutos (+ 30 s de subida e 30 s de descida).
// Uso: npm run test:carga   (com a API rodando: npm run api)
import { opcoesCarga } from "./config/opcoes.js";
import { jornadaCompra } from "./fluxos/jornada-compra.js";
import { prepararServidor, coletarMetricasServidor } from "./support/servidor.js";
import { gerarRelatorio } from "./support/relatorio.js";

export const options = opcoesCarga;

// Roda uma vez antes do teste: confere se a API está no ar e zera as métricas dela
export function setup() {
  return prepararServidor();
}

// Roda em loop por cada usuário virtual (VU) durante todo o teste
export default function () {
  jornadaCompra();
}

// Roda uma vez no final: registra a visão do servidor (CPU, event loop, fila do banco)
export function teardown() {
  coletarMetricasServidor();
}

export function handleSummary(data) {
  return gerarRelatorio(data, { nome: "carga", titulo: "Teste de carga: 500 usuários simultâneos por 5 minutos" });
}
