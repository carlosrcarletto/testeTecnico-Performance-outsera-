// API Mock da Loja (sem dependências) usada como alvo do teste de carga.
// Uso: npm run api  →  http://localhost:3333
//
// Simula características comuns de APIs reais, para que o teste tenha o que medir:
//  - Catálogo em memória (rápido, barato).
//  - Login com hash de senha PBKDF2 SÍNCRONO: consome CPU e bloqueia o event loop
//    do Node enquanto calcula (gargalo de CPU típico).
//  - Criação de pedido que passa por um "banco de dados" com pool de conexões
//    limitado: acima da capacidade, as requisições esperam na fila (gargalo de I/O).
//  - /metricas expõe a visão do servidor (lag do event loop, fila do banco), para
//    correlacionar com o que o k6 mede do lado do cliente.
const http = require("http");
const crypto = require("crypto");
const { monitorEventLoopDelay } = require("perf_hooks");

const CONFIG = {
  porta: Number(process.env.PORT) || 3333,
  iteracoesHash: Number(process.env.ITERACOES_HASH) || 10000, // custo de CPU do login
  poolBanco: Number(process.env.POOL_BANCO) || 10, // conexões simultâneas com o "banco"
  latenciaBancoMin: Number(process.env.LATENCIA_BANCO_MIN_MS) || 40,
  latenciaBancoMax: Number(process.env.LATENCIA_BANCO_MAX_MS) || 120,
};

// ---------- Dados em memória ----------
const CATEGORIAS = ["Áudio", "Periféricos", "Monitores", "Acessórios", "Armazenamento"];
const PRODUTOS = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  nome: `Produto ${String(i + 1).padStart(3, "0")}`,
  categoria: CATEGORIAS[i % CATEGORIAS.length],
  preco: Math.round((19.9 + ((i * 37) % 900)) * 100) / 100,
  estoque: 1000,
}));
const PRODUTOS_POR_ID = new Map(PRODUTOS.map((p) => [p.id, p]));

const SAL = "sal-fixo-da-api-mock";
const hash = (senha) => crypto.pbkdf2Sync(senha, SAL, CONFIG.iteracoesHash, 32, "sha256").toString("hex");
const HASH_SENHA_PADRAO = hash("Senha@123");
// 100 usuários: usuario1@teste.com ... usuario100@teste.com, todos com a senha Senha@123
const USUARIOS = new Map(
  Array.from({ length: 100 }, (_, i) => [`usuario${i + 1}@teste.com`, { id: i + 1, hashSenha: HASH_SENHA_PADRAO }]),
);
const SESSOES = new Map(); // token → id do usuário
let proximoPedido = 1;

// ---------- "Banco de dados" com pool de conexões limitado ----------
let conexoesEmUso = 0;
const filaBanco = [];

function consultarBanco() {
  return new Promise((resolve) => {
    const executar = () => {
      conexoesEmUso++;
      const espera = CONFIG.latenciaBancoMin + Math.random() * (CONFIG.latenciaBancoMax - CONFIG.latenciaBancoMin);
      setTimeout(() => {
        conexoesEmUso--;
        if (filaBanco.length) filaBanco.shift()();
        resolve();
      }, espera);
    };
    if (conexoesEmUso < CONFIG.poolBanco) executar();
    else {
      filaBanco.push(executar);
      metricas.filaBancoMax = Math.max(metricas.filaBancoMax, filaBanco.length);
    }
  });
}

// ---------- Métricas do servidor ----------
// O histograma mede o intervalo entre amostras (resolução de 10 ms); o atraso real
// do event loop é o que passa disso.
const RESOLUCAO_LAG_MS = 10;
const lagEventLoop = monitorEventLoopDelay({ resolution: RESOLUCAO_LAG_MS });
lagEventLoop.enable();
const metricas = { inicio: Date.now(), requisicoes: 0, porRota: {}, status: {}, filaBancoMax: 0 };
let cpuInicial = process.cpuUsage();

function resetarMetricas() {
  lagEventLoop.reset();
  cpuInicial = process.cpuUsage();
  Object.assign(metricas, { inicio: Date.now(), requisicoes: 0, porRota: {}, status: {}, filaBancoMax: 0 });
}

function snapshotMetricas() {
  const segundos = (Date.now() - metricas.inicio) / 1000;
  const cpu = process.cpuUsage(cpuInicial);
  const ms = (ns) => Math.max(0, Math.round((ns / 1e6 - RESOLUCAO_LAG_MS) * 10) / 10);
  return {
    segundosDesdeReset: Math.round(segundos),
    requisicoes: metricas.requisicoes,
    requisicoesPorSegundo: Math.round(metricas.requisicoes / Math.max(segundos, 1)),
    porRota: metricas.porRota,
    status: metricas.status,
    cpuMedioPercent: Math.round(((cpu.user + cpu.system) / 1000 / (segundos * 1000)) * 100),
    eventLoopLagMs: { p50: ms(lagEventLoop.percentile(50)), p99: ms(lagEventLoop.percentile(99)), max: ms(lagEventLoop.max) },
    banco: { pool: CONFIG.poolBanco, conexoesEmUso, filaAtual: filaBanco.length, filaMax: metricas.filaBancoMax },
    config: CONFIG,
  };
}

// ---------- HTTP ----------
function responder(res, status, corpo) {
  const json = JSON.stringify(corpo);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(json) });
  res.end(json);
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let dados = "";
    req.on("data", (c) => {
      dados += c;
      if (dados.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(dados ? JSON.parse(dados) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

function autenticado(req) {
  const [tipo, token] = (req.headers.authorization || "").split(" ");
  return tipo === "Bearer" ? SESSOES.get(token) : undefined;
}

async function rotear(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") return ["health", 200, { status: "ok" }];

  if (req.method === "GET" && pathname === "/api/produtos") {
    const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
    const tamanho = 20;
    const itens = PRODUTOS.slice((pagina - 1) * tamanho, pagina * tamanho);
    return ["produtos", 200, { pagina, total: PRODUTOS.length, itens }];
  }

  const detalhe = /^\/api\/produtos\/(\d+)$/.exec(pathname);
  if (req.method === "GET" && detalhe) {
    const produto = PRODUTOS_POR_ID.get(Number(detalhe[1]));
    return produto ? ["produto", 200, produto] : ["produto", 404, { erro: "Produto não encontrado" }];
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const corpo = await lerCorpo(req);
    if (!corpo || !corpo.email || !corpo.senha) return ["login", 400, { erro: "Informe email e senha" }];
    const usuario = USUARIOS.get(corpo.email);
    const hashInformado = hash(corpo.senha); // calculado sempre, mesmo sem usuário (evita timing attack)
    if (!usuario || hashInformado !== usuario.hashSenha) return ["login", 401, { erro: "Credenciais inválidas" }];
    const token = crypto.randomBytes(24).toString("hex");
    SESSOES.set(token, usuario.id);
    return ["login", 200, { token, expiraEm: 3600 }];
  }

  if (req.method === "POST" && pathname === "/api/pedidos") {
    const usuarioId = autenticado(req);
    if (!usuarioId) return ["pedidos", 401, { erro: "Token ausente ou inválido" }];
    const corpo = await lerCorpo(req);
    const itens = corpo && Array.isArray(corpo.itens) ? corpo.itens : [];
    if (!itens.length || itens.some((i) => !PRODUTOS_POR_ID.has(i.produtoId) || !(i.quantidade > 0))) {
      return ["pedidos", 422, { erro: "Itens inválidos" }];
    }
    await consultarBanco(); // grava o pedido
    const total = itens.reduce((s, i) => s + PRODUTOS_POR_ID.get(i.produtoId).preco * i.quantidade, 0);
    return ["pedidos", 201, { id: proximoPedido++, usuarioId, total: Math.round(total * 100) / 100, status: "CRIADO" }];
  }

  if (req.method === "GET" && pathname === "/metricas") return [null, 200, snapshotMetricas()];
  if (req.method === "POST" && pathname === "/metricas/reset") {
    resetarMetricas();
    return [null, 200, { status: "métricas zeradas" }];
  }

  return [null, 404, { erro: "Rota não encontrada" }];
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    const [rota, status, corpo] = await rotear(req, res, url);
    if (rota) {
      metricas.requisicoes++;
      metricas.porRota[rota] = (metricas.porRota[rota] || 0) + 1;
      metricas.status[status] = (metricas.status[status] || 0) + 1;
    }
    responder(res, status, corpo);
  } catch (erro) {
    console.error(erro);
    responder(res, 500, { erro: "Erro interno" });
  }
});

servidor.keepAliveTimeout = 65_000;
servidor.headersTimeout = 66_000;
servidor.listen(CONFIG.porta, () => {
  console.log(`API Mock rodando em http://localhost:${CONFIG.porta}`, JSON.stringify(CONFIG));
});
