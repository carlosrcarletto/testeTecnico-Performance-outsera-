# Teste de carga com k6 — API da Loja

Teste de performance que simula **500 usuários simultâneos por 5 minutos** fazendo uma jornada de compra completa numa API (listar produtos → ver detalhe → login → criar pedido). O teste mede tempos de resposta, erros e vazão, verifica se a API atende aos SLOs definidos e aponta gargalos.

A API testada (**API Mock da Loja**) fica dentro do próprio repositório, na pasta `api/`. Ela simula características de uma API real, como CPU gasta no login e um banco de dados com número limitado de conexões, e expõe métricas internas para o teste correlacionar o que o cliente sentiu com o que o servidor sofreu. O motivo de não usar uma API pública está em [docs/ANALISE.md](docs/ANALISE.md#2-ambiente-e-metodologia).

Ferramentas usadas:

- [**k6**](https://grafana.com/docs/k6/latest/): gera a carga e coleta as métricas.
- **k6 Web Dashboard** (embutido no k6): gráficos ao vivo durante o teste e exportados em HTML no final.
- **Relatório próprio** (`handleSummary`): relatório em HTML e Markdown com SLOs, tempos por endpoint e diagnóstico automático de gargalos.
- **GitHub Actions**: roda um teste de fumaça a cada push e o teste de carga completo na `main`, publicando o relatório no GitHub Pages.

**Resultado da última execução analisada** (detalhes em [docs/ANALISE.md](docs/ANALISE.md)):

| Indicador | Resultado |
|---|---|
| Usuários simultâneos / duração | 500 VUs por 5 min (+ 30 s de subida e 30 s de descida) |
| Requisições | 103.199 (281,7 req/s), **0% de erro** |
| Tempo de resposta p95 / p99 | 165 ms / 299 ms |
| SLOs | **15 de 15 atendidos** |
| Gargalos encontrados | Event loop bloqueado pelo login (lag de até 284 ms) e pool do banco com fila de até 35 pedidos |

---

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalação](#2-instalação)
3. [Rodando os testes](#3-rodando-os-testes)
4. [Vendo os relatórios](#4-vendo-os-relatórios)
5. [Estrutura do projeto](#5-estrutura-do-projeto)
6. [Como o teste funciona](#6-como-o-teste-funciona)
7. [Métricas e SLOs](#7-métricas-e-slos)
8. [Boas práticas aplicadas](#8-boas-práticas-aplicadas)
9. [Guia de manutenção](#9-guia-de-manutenção)
10. [CI/CD (GitHub Actions)](#10-cicd-github-actions)
11. [Problemas comuns](#11-problemas-comuns)

---

## 1. Pré-requisitos

| Programa | Para que serve | Como verificar |
|---|---|---|
| **k6** ([instalação](https://grafana.com/docs/k6/latest/set-up/install-k6/)) | Executa os testes de carga | `k6 version` |
| **Node.js** 18 ou superior ([download](https://nodejs.org/)) | Executa a API mock | `node -v` |
| **Git** ([download](https://git-scm.com/)) | Baixar e versionar o projeto | `git --version` |

Instalação do k6 por sistema:

| Sistema | Comando |
|---|---|
| macOS | `brew install k6` |
| Windows | `winget install k6 --source winget` (ou `choco install k6`) |
| Linux (Debian/Ubuntu) | Siga o guia oficial com o repositório `apt` do k6 |
| Docker | `docker run --rm -i grafana/k6 run - <tests/fumaca.js` |

> O k6 **não** é um pacote npm. O `package.json` deste projeto só guarda atalhos de comandos e não tem dependências: não é preciso rodar `npm install`.

## 2. Instalação

```bash
git clone https://github.com/SEU-USUARIO/teste-tecnico-performance-k6.git
cd teste-tecnico-performance-k6
```

Pronto. Não há dependências para instalar além do k6 e do Node.

## 3. Rodando os testes

O teste precisa da API no ar. Use **dois terminais**:

**Terminal 1: suba a API**

```bash
npm run api
# API Mock rodando em http://localhost:3333
```

**Terminal 2: rode os testes**

| Comando | O que faz | Duração |
|---|---|---|
| `npm run test:fumaca` | Teste de fumaça: 2 usuários, valida script e ambiente | 30 s |
| `npm run test:carga` | **Teste de carga: 500 usuários por 5 minutos** | ~6 min |
| `k6 run -e VUS=100 -e DURACAO=1m tests/carga.js` | Carga com outros parâmetros (útil para ensaiar) | ~2 min |
| `k6 run -e BASE_URL=http://outro-host:3333 tests/carga.js` | Aponta para a API em outro endereço | — |

Comece sempre pelo teste de fumaça. Se ele falhar, o problema está no script ou no ambiente, e não adianta esperar 6 minutos pela carga.

**Durante o teste de carga**, abra http://localhost:5665 no navegador para acompanhar os gráficos **ao vivo** (vazão, tempos e usuários).

Resultado esperado no terminal ao final:

```
══ Teste de carga: 500 usuários simultâneos por 5 minutos ══

Duração 6,1 min | VUs máx 500 | 103.199 req (281,7/s) | erros 0,00% | p95 165 ms

Por endpoint (p95 / p99 / erros):
  GET /api/produtos           104 ms    200 ms    0,00%
  GET /api/produtos/:id       105 ms    197 ms    0,00%
  POST /api/login             115 ms    207 ms    0,00%
  POST /api/pedidos           263 ms    453 ms    0,00%

SLOs:
  ✓ Taxa de erro HTTP: rate<0.01
  ✓ Tempo de resposta (todas as requisições): p(95)<500
  …

Diagnóstico:
  ✅ Todos os 15 SLOs foram atendidos.
  ⚠️ Event loop do servidor travado (lag p99 61 ms, máximo 284 ms): …
  ⚠️ Pool do banco saturado: até 35 pedidos aguardaram conexão (pool com 10). …

Relatório completo: relatorios/carga/index.html
```

> Os números variam conforme a máquina. O k6 e a API disputam a mesma CPU quando rodam no mesmo computador; veja a seção 2 da [análise](docs/ANALISE.md#2-ambiente-e-metodologia).

**Código de saída:** `0` = todos os SLOs atendidos; `99` = algum SLO violado (a pipeline fica vermelha). Isso faz o teste funcionar como um **portão de qualidade** de performance.

## 4. Vendo os relatórios

Cada execução gera, em `relatorios/carga/` (ou `relatorios/fumaca/`):

| Arquivo | O que é | Como abrir |
|---|---|---|
| `index.html` | **Relatório principal**: cartões de resumo, diagnóstico automático, SLOs, tempo por endpoint, fases da requisição e visão do servidor | Duplo clique (abre direto no navegador) |
| `dashboard.html` | Dashboard do k6 com os **gráficos ao longo do tempo** | Duplo clique, ou pelo link no `index.html` |
| `resumo.md` | Mesmo conteúdo do `index.html` em Markdown (aparece no resumo do GitHub Actions) | Qualquer editor |
| `resumo.json` | Dados brutos do k6 + indicadores calculados, para comparar execuções | Qualquer editor |

O que olhar no `index.html`, nesta ordem:

1. **Selo no topo**: verde = todos os SLOs atendidos; vermelho = algum violado.
2. **Diagnóstico automático**: ⚠️ aponta gargalos (endpoint lento, event loop travado, fila no banco, CPU alta, erros). As regras estão em `tests/support/relatorio.js`.
3. **Tempo de resposta por endpoint**: a barra do p95 mostra qual endpoint é o mais lento.
4. **Onde o tempo é gasto**: se "Esperando (TTFB)" domina, o problema está no servidor; se "Bloqueado" ou "Conectando" são altos, está na rede ou nas conexões.
5. **Visão do servidor**: CPU, lag do event loop e fila do banco, coletados no endpoint `/metricas` da API ao final do teste.

Um exemplo completo, da execução analisada, está em [`docs/exemplo-relatorio/`](docs/exemplo-relatorio/), e a análise escrita em [`docs/ANALISE.md`](docs/ANALISE.md).

## 5. Estrutura do projeto

```
teste-tecnico-performance-k6/
├── .github/workflows/
│   └── k6.yml                  → pipeline: fumaça em todo push, carga na main, relatório no Pages
├── api/
│   └── server.js               → A API TESTADA (mock, sem dependências): npm run api
├── tests/
│   ├── carga.js                → TESTE DE CARGA: 500 usuários por 5 minutos
│   ├── fumaca.js               → teste de fumaça: 2 usuários por 30 s
│   ├── config/
│   │   └── opcoes.js           → perfil de carga (VUs, rampa, duração) e SLOs (thresholds)
│   ├── fluxos/
│   │   └── jornada-compra.js   → o que cada usuário virtual faz (as 4 etapas da compra)
│   ├── data/
│   │   ├── usuarios.json       → 100 usuários de teste (e-mail e senha)
│   │   └── massa.json          → parâmetros do catálogo (total de produtos, páginas)
│   └── support/
│       ├── relatorio.js        → gera index.html, resumo.md e resumo.json + diagnóstico
│       ├── servidor.js         → checa a API antes e coleta /metricas depois do teste
│       └── utils.js            → pausas aleatórias, leitura segura de JSON
├── docs/
│   ├── ANALISE.md              → ANÁLISE DO RESULTADO (Tarefa 2)
│   ├── exemplo-relatorio/      → relatório da execução analisada
│   └── img/                    → imagens usadas na documentação
├── relatorios/                 → saída de cada execução (gerada, não versionada)
├── package.json                → atalhos: npm run api / test:fumaca / test:carga
└── README.md
```

### 5.1 Detalhe de cada arquivo

#### `api/server.js`: a API testada

| Endpoint | O que faz | Característica simulada |
|---|---|---|
| `GET /health` | Verifica se a API está no ar | — |
| `GET /api/produtos?pagina=N` | Lista 20 produtos de um catálogo de 200 | Leitura em memória, muito barata |
| `GET /api/produtos/:id` | Detalhe de um produto (404 se não existe) | Leitura em memória |
| `POST /api/login` | Valida e-mail e senha e devolve um token | **Hash de senha PBKDF2 síncrono**: gasta CPU e bloqueia o event loop |
| `POST /api/pedidos` | Cria um pedido (exige token) | **Grava num "banco" com pool de 10 conexões**: acima disso, fila |
| `GET /metricas` | Visão do servidor: CPU, lag do event loop, fila do banco, req/s | Usado pelo teste para diagnosticar gargalos |
| `POST /metricas/reset` | Zera as métricas (chamado no início do teste) | — |

Os parâmetros podem ser ajustados por variável de ambiente para experimentar cenários:

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | `3333` | Porta da API |
| `ITERACOES_HASH` | `10000` | Custo de CPU de cada login (maior = mais lento) |
| `POOL_BANCO` | `10` | Conexões simultâneas com o banco |
| `LATENCIA_BANCO_MIN_MS` / `LATENCIA_BANCO_MAX_MS` | `40` / `120` | Tempo de cada gravação no banco |

Exemplo: `POOL_BANCO=30 npm run api` (no PowerShell: `$env:POOL_BANCO=30; npm run api`) para ver o efeito de aumentar o pool.

#### `tests/carga.js` e `tests/fumaca.js`: os testes

Os dois têm a mesma estrutura, que segue o [ciclo de vida do k6](https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/):

| Etapa | Quando roda | O que faz aqui |
|---|---|---|
| `options` | Na leitura do script | Define perfil de carga e SLOs (vêm de `config/opcoes.js`) |
| `setup()` | Uma vez, antes de tudo | Confere `/health` (aborta com mensagem clara se a API estiver fora) e zera `/metricas` |
| `default function` | Em loop, por cada usuário virtual | Executa a jornada de compra |
| `teardown()` | Uma vez, no final | Lê `/metricas` e registra a visão do servidor no relatório |
| `handleSummary()` | Ao terminar | Gera os relatórios (`support/relatorio.js`) |

#### `tests/config/opcoes.js`: perfil de carga e SLOs

Perfil do teste de carga (executor `ramping-vus`):

```
VUs
500 ┤        ┌───────────────────────────┐
    │       ╱                             ╲
    │      ╱      platô: 5 minutos         ╲
  0 ┼─────┘                                 └────
    0    30s                              5m30s  6m
```

A subida de 30 s evita que 500 usuários disparem no mesmo milissegundo (um pico artificial que não acontece na vida real) e dá tempo de a API "aquecer". A descida deixa as jornadas em andamento terminarem sem serem cortadas no meio.

Todos os valores aceitam variável de ambiente: `VUS`, `DURACAO`, `RAMPA` e `BASE_URL`.

#### `tests/fluxos/jornada-compra.js`: o que cada usuário faz

Cada iteração é uma **sessão nova de um cliente**:

| Etapa | Requisição | Verificações (checks) | Pausa depois |
|---|---|---|---|
| 01 Vitrine | `GET /api/produtos?pagina=1..10` | status 200 e 20 itens | 1 a 3 s |
| 02 Detalhe | `GET /api/produtos/1..200` | status 200 e id correto | 1 a 2 s |
| 03 Login | `POST /api/login` | status 200 e token presente | 0,5 a 1 s |
| 04 Pedido | `POST /api/pedidos` com 1 a 3 itens | status 201 e status `CRIADO` | 1 a 3 s |

Se uma etapa falha, as seguintes não rodam (não há pedido sem login), e a jornada conta como falha na métrica `jornada_compra_sucesso`.

#### `tests/support/relatorio.js`: relatório e diagnóstico

Transforma o resumo do k6 em `index.html`, `resumo.md`, `resumo.json` e no texto do terminal. O **diagnóstico automático** aplica regras sobre as métricas:

| Regra | Sinal de… |
|---|---|
| SLO violado | Requisito de performance não atendido |
| Taxa de erro ≥ 1% (com o endpoint que falha) | API recusando ou derrubando requisições |
| Endpoint com p95 acima do SLO ou muito mais lento que os outros | Gargalo localizado |
| TTFB < 80% do tempo total | Rede, conexões ou gerador de carga pesando |
| Bloqueado p95 > 10 ms | Falta de conexões livres |
| Lag do event loop p99 > 50 ms | Processamento síncrono travando o servidor |
| Fila no pool do banco > 0 | Banco saturado |
| CPU ≥ 80% | Servidor perto do limite |

## 6. Como o teste funciona

```
 k6 (gerador de carga)                          API Mock (Node)
┌─────────────────────────┐                   ┌──────────────────────┐
│ setup(): /health,       │ ── HTTP ────────▶ │ /health              │
│          /metricas/reset│                   │                      │
│                         │                   │ /api/produtos  (mem) │
│ 500 VUs em loop:        │ ── HTTP ────────▶ │ /api/login     (CPU) │
│  jornadaCompra()        │   keep-alive      │ /api/pedidos   (pool)│
│                         │                   │                      │
│ teardown(): /metricas   │ ◀── JSON ──────── │ /metricas            │
│ handleSummary(): HTML   │                   └──────────────────────┘
└─────────────────────────┘
```

O k6 mede **o lado do cliente** (tempo de resposta, erros, vazão). O `/metricas` mostra **o lado do servidor** (CPU, event loop, fila do banco). Juntar os dois é o que permite dizer **por que** um endpoint ficou lento, e não só **que** ficou.

## 7. Métricas e SLOs

### 7.1 Métricas usadas

**Nativas do k6:**

| Métrica | O que mede | Por que importa |
|---|---|---|
| `http_req_duration` | Tempo total da requisição | Principal indicador de experiência; analisado em p95/p99, não na média |
| `http_req_waiting` | Tempo esperando a resposta (TTFB) | Isola o tempo de processamento do servidor |
| `http_req_blocked` / `http_req_connecting` | Espera por conexão / abertura de TCP | Detecta falta de conexões e problemas de rede |
| `http_req_failed` | Taxa de requisições com erro | Disponibilidade |
| `http_reqs` | Total e taxa de requisições | Vazão |
| `checks` | Verificações funcionais aprovadas | Garante que a API responde **certo**, não só rápido |
| `iterations` / `iteration_duration` | Jornadas executadas e quanto duram | Vazão de negócio |
| `vus` | Usuários ativos | Confirma que a carga pedida foi aplicada |

**Personalizadas (definidas no script):**

| Métrica | Tipo | O que mede |
|---|---|---|
| `jornada_compra_duracao` | Trend | Soma dos tempos de resposta de uma jornada completa (sem as pausas): a espera total do cliente |
| `jornada_compra_sucesso` | Rate | Jornadas concluídas com pedido criado |
| `pedidos_criados` | Counter | Total de pedidos (indicador de negócio) |
| `api_cpu_medio_percent`, `api_event_loop_lag_p99_ms`, `api_event_loop_lag_max_ms`, `api_fila_banco_max`… | Gauge | Visão do servidor, lida do `/metricas` no `teardown()` |

**Tags:** cada requisição recebe `endpoint` (usada nos SLOs por endpoint) e `name` (que junta `/api/produtos/17`, `/api/produtos/42`… numa série só, evitando milhares de séries diferentes no resultado).

### 7.2 SLOs (thresholds)

| SLO | Regra | Justificativa |
|---|---|---|
| Taxa de erro | `< 1%` | Disponibilidade mínima |
| Taxa de erro (aborto) | `< 10%`, aborta após 30 s | Não adianta continuar martelando uma API que já caiu |
| Tempo de resposta geral | p95 `< 500 ms`, p99 `< 1,5 s` | Percentis capturam a experiência dos usuários mais afetados |
| Listar / detalhe de produto | p95 `< 300 ms` | Leituras simples devem ser rápidas |
| Login | p95 `< 800 ms` | Hash de senha é caro por natureza |
| Criar pedido | p95 `< 1 s` | Envolve gravação no banco |
| Erros por endpoint | `< 1%` cada | Mostra **qual** endpoint falha quando a taxa geral sobe |
| Verificações e jornadas | `> 99%` | Correção funcional sob carga |
| Jornada completa | p95 `< 2 s` | Espera total do cliente numa compra |

## 8. Boas práticas aplicadas

- **Configuração separada do script**: perfil de carga e SLOs em `config/opcoes.js`; fluxo em `fluxos/`; dados em `data/`.
- **Tudo parametrizável** por `-e VUS=… -e DURACAO=… -e BASE_URL=…`, sem editar código.
- **Comportamento realista**: pausas aleatórias entre ações (o *think time*), páginas e produtos variados, 100 usuários diferentes.
- **Rampa de subida e descida** em vez de 500 usuários instantâneos.
- **Percentis em vez de média** nos SLOs.
- **SLOs por endpoint** com tags, e `name` para agrupar URLs dinâmicas.
- **Checks em todas as respostas**, com leitura de JSON que não quebra a iteração se a API devolver HTML de erro.
- **Jornada interrompida na primeira falha**, sem gerar requisições inválidas em cascata.
- **`SharedArray`** para os usuários: um único bloco de memória compartilhado entre os 500 VUs.
- **Falha rápida**: o `setup()` aborta com mensagem clara se a API não responder, e o threshold com `abortOnFail` para o teste se a API cair.
- **Teste de fumaça antes da carga**, no CI e localmente.
- **Correlação cliente × servidor** via `/metricas`.

## 9. Guia de manutenção

### 9.1 Mudar a carga

Sem editar código: `k6 run -e VUS=1000 -e DURACAO=10m -e RAMPA=1m tests/carga.js`.

Para mudar o padrão, edite `VUS`, `DURACAO` e `RAMPA` no topo de `tests/config/opcoes.js`.

### 9.2 Mudar um SLO

Edite `limitesCarga` em `tests/config/opcoes.js`. Exemplo, exigir p95 de 200 ms na vitrine:

```js
"http_req_duration{endpoint:produtos}": ["p(95)<200"],
```

### 9.3 Adicionar uma etapa na jornada

Exemplo: consultar o pedido criado.

1. Crie a rota na API (`api/server.js`) ou use a da sua API real.
2. Em `tests/fluxos/jornada-compra.js`, adicione um `group` após o pedido:

```js
group("05 Consultar pedido", () => {
  const res = http.get(`${BASE_URL}/api/pedidos/${pedidoId}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...tags("consulta", "GET /api/pedidos/:id"),
  });
  return check(res, { "consulta: status 200": (r) => r.status === 200 });
});
```

3. Adicione o SLO em `config/opcoes.js` (`"http_req_duration{endpoint:consulta}": ["p(95)<300"]`) e o endpoint na lista `ENDPOINTS` de `support/relatorio.js`, para ele aparecer no relatório.

### 9.4 Testar outra API

Rode com `-e BASE_URL=https://sua-api`, ajuste as rotas e os checks em `fluxos/jornada-compra.js` e os dados em `data/`. Se a API não tiver `/metricas`, o teste segue normalmente e o relatório avisa que está sem a visão do servidor.

> Só rode carga contra APIs que você tem autorização para testar.

### 9.5 Outros tipos de teste

| Tipo | Comando sugerido | Objetivo |
|---|---|---|
| Estresse | `k6 run -e VUS=1500 -e RAMPA=5m -e DURACAO=2m tests/carga.js` | Achar o ponto de ruptura |
| Pico | `k6 run -e VUS=1000 -e RAMPA=10s -e DURACAO=1m tests/carga.js` | Reação a um aumento súbito |
| Resistência (soak) | `k6 run -e VUS=300 -e DURACAO=1h tests/carga.js` | Vazamento de memória e degradação ao longo do tempo |

## 10. CI/CD (GitHub Actions)

O arquivo `.github/workflows/k6.yml` define três jobs:

```
push / pull request / "Run workflow"
            │
            ▼
┌────────────────────┐   só na main    ┌─────────────────────┐   só na main   ┌──────────────────────┐
│ fumaca             │  ou manual      │ carga               │ ─────────────▶ │ deploy-report        │
│ 2 VUs, 30 s        │ ──────────────▶ │ 500 VUs, 5 min      │                │ relatório no Pages   │
└────────────────────┘                 └─────────────────────┘                └──────────────────────┘
```

| Evento | O que acontece |
|---|---|
| Push em qualquer branch / pull request | Roda o teste de **fumaça** (~1 min no total) |
| Push na `main` | Fumaça + **carga completa** + publicação do relatório no GitHub Pages |
| Manual (Actions → *Testes de Performance (k6)* → **Run workflow**) | Fumaça + carga, **escolhendo VUs e duração** |

Cada job instala o k6 (versão fixada em `K6_VERSION`), sobe a API em segundo plano, espera o `/health` responder e roda o teste. O resumo em Markdown aparece na página da execução (**Summary**), e os relatórios ficam em **Artifacts** por 30 dias (`relatorio-fumaca`, `relatorio-carga`, este último com o log da API).

O teste de carga não roda em todo push de propósito: são 6 minutos por execução, e ele é o tipo de teste que se roda antes de uma entrega, não a cada commit.

**Configuração única do GitHub Pages:** no repositório, **Settings → Pages → Source: GitHub Actions**. Sem isso, o job `deploy-report` falha com erro 404. O relatório fica em `https://SEU-USUARIO.github.io/teste-tecnico-performance-k6/`, com o `index.html` e o link para o `dashboard.html`.

> Se um SLO for violado, o k6 termina com código 99 e o job `carga` fica vermelho, mas os relatórios são gerados e publicados mesmo assim (`if: !cancelled()`), justamente para investigar a falha.

## 11. Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `test aborted: API indisponível em http://localhost:3333` | A API não está rodando | Rode `npm run api` em outro terminal |
| `k6: command not found` | k6 não instalado ou fora do PATH | Seção 1; feche e abra o terminal após instalar |
| `could not open 'relatorios/carga/index.html'` | Pasta `relatorios/carga` apagada (o k6 não cria pastas) | Recrie: `mkdir -p relatorios/carga relatorios/fumaca` |
| `EADDRINUSE :::3333` | Outra API já está na porta | Feche a outra instância ou use `PORT=3334 npm run api` e `-e BASE_URL=http://localhost:3334` |
| Dashboard não gerado | Teste curto demais (poucos segundos) ou rodou sem `--out web-dashboard` | Use os comandos `npm run test:*` |
| `dial tcp: too many open files` (Linux/macOS) | Limite de arquivos abertos baixo para 500 VUs | `ulimit -n 10000` antes de rodar |
| Resultados muito piores que os da análise | k6 e API disputando CPU na mesma máquina | Normal em máquinas modestas; compare tendências, não números absolutos |
| Job `deploy-report` falha com `status: 404` | GitHub Pages não ativado | Settings → Pages → Source: **GitHub Actions** |
