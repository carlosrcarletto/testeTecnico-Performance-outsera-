// Configuração central dos testes: endereço da API, perfil de carga e SLOs (thresholds).
// Tudo pode ser sobrescrito por variável de ambiente, ex.: k6 run -e VUS=100 -e DURACAO=1m tests/carga.js

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3333";

const VUS = Number(__ENV.VUS || 500);
const DURACAO = __ENV.DURACAO || "5m"; // tempo com os 500 usuários simultâneos
const RAMPA = __ENV.RAMPA || "30s"; // subida e descida gradual

// Estatísticas exibidas para métricas de tempo (Trend)
const ESTATISTICAS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"];

// SLOs: se algum for violado o k6 termina com código 99 (pipeline vermelha)
export const limitesCarga = {
  // Disponibilidade: menos de 1% de erros. Se passar de 10%, aborta o teste
  // (não adianta seguir martelando uma API que já caiu).
  http_req_failed: [
    "rate<0.01",
    { threshold: "rate<0.10", abortOnFail: true, delayAbortEval: "30s" },
  ],
  // Tempo de resposta geral
  http_req_duration: ["p(95)<500", "p(99)<1500"],
  // Tempo de resposta por endpoint (cada um tem um orçamento diferente)
  "http_req_duration{endpoint:produtos}": ["p(95)<300"],
  "http_req_duration{endpoint:produto}": ["p(95)<300"],
  "http_req_duration{endpoint:login}": ["p(95)<800"],
  "http_req_duration{endpoint:pedidos}": ["p(95)<1000"],
  // Erros por endpoint: mostra QUAL endpoint falha quando a taxa geral sobe
  "http_req_failed{endpoint:produtos}": ["rate<0.01"],
  "http_req_failed{endpoint:produto}": ["rate<0.01"],
  "http_req_failed{endpoint:login}": ["rate<0.01"],
  "http_req_failed{endpoint:pedidos}": ["rate<0.01"],
  // Correção funcional sob carga
  checks: ["rate>0.99"],
  jornada_compra_sucesso: ["rate>0.99"],
  // Experiência ponta a ponta: soma dos tempos de resposta da jornada (sem as pausas)
  jornada_compra_duracao: ["p(95)<2000"],
};

export const opcoesCarga = {
  scenarios: {
    carga_500_usuarios: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMPA, target: VUS }, // aquecimento: sobe até 500
        { duration: DURACAO, target: VUS }, // platô: 500 simultâneos por 5 minutos
        { duration: RAMPA, target: 0 }, // desaquecimento
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: limitesCarga,
  summaryTrendStats: ESTATISTICAS,
  tags: { tipo_teste: "carga" },
};

// Teste de fumaça: 2 usuários por 30 s só para validar script e ambiente
export const opcoesFumaca = {
  scenarios: {
    fumaca: { executor: "constant-vus", vus: 2, duration: __ENV.DURACAO || "30s" },
  },
  thresholds: {
    http_req_failed: ["rate==0"],
    checks: ["rate==1"],
    jornada_compra_sucesso: ["rate==1"],
    http_req_duration: ["p(95)<300"],
    "http_req_duration{endpoint:produtos}": ["p(95)<300"],
    "http_req_duration{endpoint:produto}": ["p(95)<300"],
    "http_req_duration{endpoint:login}": ["p(95)<300"],
    "http_req_duration{endpoint:pedidos}": ["p(95)<300"],
  },
  summaryTrendStats: ESTATISTICAS,
  tags: { tipo_teste: "fumaca" },
};
