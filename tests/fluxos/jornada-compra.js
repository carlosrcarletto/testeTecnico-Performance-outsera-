// Jornada de compra de um usuário virtual: vitrine → detalhe → login → pedido.
// Cada iteração representa uma sessão nova de um cliente, com pausas de "tempo de
// leitura" entre as ações para simular um comportamento humano.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { BASE_URL } from "../config/opcoes.js";
import { jsonSeguro, aleatorio, pausa } from "../support/utils.js";

// Carregado uma única vez e compartilhado entre os 500 VUs (economiza memória)
const usuarios = new SharedArray("usuarios", () => JSON.parse(open("../data/usuarios.json")));
const massa = JSON.parse(open("../data/massa.json"));

// Métricas de negócio (além das métricas HTTP nativas do k6)
const jornadaDuracao = new Trend("jornada_compra_duracao", true);
const jornadaSucesso = new Rate("jornada_compra_sucesso");
const pedidosCriados = new Counter("pedidos_criados");

const JSON_HEADERS = { "Content-Type": "application/json" };

// tags.endpoint → usado nos thresholds por endpoint
// tags.name     → agrupa URLs dinâmicas (/api/produtos/17, /api/produtos/42…) numa só série
const tags = (endpoint, name) => ({ tags: { endpoint, name } });

export function jornadaCompra() {
  const usuario = usuarios[(exec.vu.idInTest - 1) % usuarios.length];
  let tempoHttp = 0;
  const medir = (res) => {
    tempoHttp += res.timings.duration;
    return res;
  };

  const sucesso = (() => {
    // 1. Vitrine
    const okVitrine = group("01 Vitrine: listar produtos", () => {
      const pagina = aleatorio(1, massa.paginasCatalogo);
      const res = medir(http.get(`${BASE_URL}/api/produtos?pagina=${pagina}`, tags("produtos", "GET /api/produtos")));
      return check(res, {
        "listar produtos: status 200": (r) => r.status === 200,
        "listar produtos: retorna 20 itens": (r) => jsonSeguro(r, "itens.#") === massa.itensPorPagina,
      });
    });
    if (!okVitrine) return false;
    pausa(1, 3);

    // 2. Detalhe de um produto
    const produtoId = aleatorio(1, massa.totalProdutos);
    const okDetalhe = group("02 Detalhe do produto", () => {
      const res = medir(http.get(`${BASE_URL}/api/produtos/${produtoId}`, tags("produto", "GET /api/produtos/:id")));
      return check(res, {
        "detalhe: status 200": (r) => r.status === 200,
        "detalhe: produto correto": (r) => jsonSeguro(r, "id") === produtoId,
      });
    });
    if (!okDetalhe) return false;
    pausa(1, 2);

    // 3. Login
    const token = group("03 Login", () => {
      const res = medir(
        http.post(
          `${BASE_URL}/api/login`,
          JSON.stringify({ email: usuario.email, senha: usuario.senha }),
          { headers: JSON_HEADERS, ...tags("login", "POST /api/login") },
        ),
      );
      const ok = check(res, {
        "login: status 200": (r) => r.status === 200,
        "login: retorna token": (r) => typeof jsonSeguro(r, "token") === "string",
      });
      return ok ? jsonSeguro(res, "token") : null;
    });
    if (!token) return false;
    pausa(0.5, 1);

    // 4. Criar pedido com 1 a 3 produtos
    const okPedido = group("04 Criar pedido", () => {
      const itens = Array.from({ length: aleatorio(1, 3) }, () => ({
        produtoId: aleatorio(1, massa.totalProdutos),
        quantidade: aleatorio(1, 2),
      }));
      const res = medir(
        http.post(`${BASE_URL}/api/pedidos`, JSON.stringify({ itens }), {
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
          ...tags("pedidos", "POST /api/pedidos"),
        }),
      );
      return check(res, {
        "pedido: status 201": (r) => r.status === 201,
        "pedido: status CRIADO": (r) => jsonSeguro(r, "status") === "CRIADO",
      });
    });
    if (okPedido) pedidosCriados.add(1);
    return okPedido;
  })();

  jornadaSucesso.add(sucesso);
  if (sucesso) jornadaDuracao.add(tempoHttp);
  pausa(1, 3); // tempo até o próximo cliente
}
