// TESTE DE FUMAÇA (smoke): 2 usuários por 30 s. Valida script, massa e ambiente
// antes de gastar 6 minutos no teste de carga. Roda a cada push no CI.
// Uso: npm run test:fumaca   (com a API rodando: npm run api)
import { opcoesFumaca } from "./config/opcoes.js";
import { jornadaCompra } from "./fluxos/jornada-compra.js";
import { prepararServidor, coletarMetricasServidor } from "./support/servidor.js";
import { gerarRelatorio } from "./support/relatorio.js";

export const options = opcoesFumaca;

export function setup() {
  return prepararServidor();
}

export default function () {
  jornadaCompra();
}

export function teardown() {
  coletarMetricasServidor();
}

export function handleSummary(data) {
  return gerarRelatorio(data, { nome: "fumaca", titulo: "Teste de fumaça: 2 usuários por 30 segundos" });
}
