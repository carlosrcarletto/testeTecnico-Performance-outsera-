# Teste de carga: 500 usuários simultâneos por 5 minutos

Gerado em 2026-10-26T16:43:11.556Z

## Resumo

| Indicador | Valor |
|---|---|
| Duração | 6,1 min |
| Usuários simultâneos (máx.) | 500 |
| Requisições | 103.199 (281,7 req/s) |
| Jornadas de compra | 25.799 (70,4/s) |
| Pedidos criados | 25.799 |
| Taxa de erro HTTP | 0,00% |
| Verificações aprovadas | 100,00% (0 falhas) |
| Tempo de resposta p95 / p99 | 165 ms / 299 ms |

## Diagnóstico automático

- ✅ Todos os 15 SLOs foram atendidos.
- ✅ Nenhuma requisição falhou: a API se manteve disponível durante todo o teste.
- ℹ️ Endpoint mais lento: POST /api/pedidos com p95 de 263 ms (2,5x o mais rápido), dentro do SLO.
- ℹ️ 99,40% do tempo médio de resposta é espera pelo servidor (TTFB): o custo está no processamento da API, não na rede.
- ⚠️ Event loop do servidor travado (lag p99 61 ms, máximo 284 ms): processamento síncrono pesado atrasa TODAS as rotas, inclusive as leves.
- ⚠️ Pool do banco saturado: até 35 pedidos aguardaram conexão (pool com 10). Afeta diretamente POST /api/pedidos.
- ℹ️ CPU do processo da API em 50% de média: ainda há folga, mas pouca para picos.
- ℹ️ Vazão: 281,7 req/s e 70,4 jornadas/s com até 500 usuários simultâneos.

## SLOs (thresholds)

| Resultado | Métrica | Regra |
|---|---|---|
| ✅ ok | Jornadas de compra concluídas | `rate>0.99` |
| ✅ ok | Taxa de erro HTTP | `rate<0.01` |
| ✅ ok | Taxa de erro HTTP | `rate<0.10` |
| ✅ ok | Taxa de erro: GET /api/produtos | `rate<0.01` |
| ✅ ok | Taxa de erro: GET /api/produtos/:id | `rate<0.01` |
| ✅ ok | Taxa de erro: POST /api/login | `rate<0.01` |
| ✅ ok | Taxa de erro: POST /api/pedidos | `rate<0.01` |
| ✅ ok | Tempo de resposta (todas as requisições) | `p(95)<500` |
| ✅ ok | Tempo de resposta (todas as requisições) | `p(99)<1500` |
| ✅ ok | Tempo de resposta somado da jornada | `p(95)<2000` |
| ✅ ok | Tempo de resposta: GET /api/produtos | `p(95)<300` |
| ✅ ok | Tempo de resposta: GET /api/produtos/:id | `p(95)<300` |
| ✅ ok | Tempo de resposta: POST /api/login | `p(95)<800` |
| ✅ ok | Tempo de resposta: POST /api/pedidos | `p(95)<1000` |
| ✅ ok | Verificações funcionais aprovadas | `rate>0.99` |

## Tempo de resposta por endpoint

| Endpoint | Média | p90 | p95 | p99 | Máx | Erros |
|---|---|---|---|---|---|---|
| GET /api/produtos | 23 ms | 61 ms | 104 ms | 200 ms | 531 ms | 0,00% |
| GET /api/produtos/:id | 23 ms | 62 ms | 105 ms | 197 ms | 318 ms | 0,00% |
| POST /api/login | 31 ms | 70 ms | 115 ms | 207 ms | 324 ms | 0,00% |
| POST /api/pedidos | 123 ms | 188 ms | 263 ms | 453 ms | 859 ms | 0,00% |

## Onde o tempo é gasto (todas as requisições)

| Fase | O que é | Média | p95 |
|---|---|---|---|
| Bloqueado | esperando conexão livre / DNS | 0,0 ms | 0,0 ms |
| Conectando | abrindo conexão TCP | 0,0 ms | 0,0 ms |
| Enviando | enviando a requisição | 0,1 ms | 0,5 ms |
| Esperando (TTFB) | servidor processando | 49 ms | 164 ms |
| Recebendo | baixando a resposta | 0,2 ms | 0,5 ms |

## Visão do servidor (/metricas)

| Indicador | Valor |
|---|---|
| CPU média do processo | 50% |
| Lag do event loop p99 / máx | 61 ms / 284 ms |
| Fila máxima no pool do banco | 35 (pool de 10) |
| Requisições por segundo (servidor) | 282 |
