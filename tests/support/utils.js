import { sleep } from "k6";

// Lê um campo do JSON da resposta sem quebrar a iteração se o corpo não for JSON
// (ex.: página de erro 502 em HTML). Caminho no formato GJSON: "itens.#", "token".
export function jsonSeguro(res, caminho) {
  try {
    return res.json(caminho);
  } catch (e) {
    return undefined;
  }
}

// Inteiro aleatório entre min e max (inclusive)
export const aleatorio = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Pausa aleatória entre min e max segundos ("tempo de leitura" do usuário).
// Variar a pausa evita que todos os VUs batam na API no mesmo instante.
export const pausa = (min, max) => sleep(min + Math.random() * (max - min));
