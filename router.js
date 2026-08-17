/* Roteador por hash + montagem do menu conforme perfil. */
import { pode, ehTecnico } from "./auth.js";
import { ico } from "./ui.js";

export const MENU = [
  { g: "Operação", itens: [
    { r: "home",         t: "Início",     i: "dashboard", perm: null },
    { r: "inventario",   t: "Inventário", i: "scan",  perm: "inventario.ver" },
    { r: "ativos",       t: "Ativos",     i: "cpu",   perm: "ativo.ver" },
    { r: "lotes",        t: "Entrada de Lote", i: "box", perm: "ativo.criar" },
    { r: "movimentacoes",t: "Movimentações", i: "arrows", perm: "movimentacao.ver" },
    { r: "recolhimentos",t: "Recolhimentos", i: "box",    perm: "recolhimento.ver" },
    { r: "pendencias",   t: "Pendências", i: "alert", perm: "pendencia.ver", contador: true },
    { r: "manutencao",   t: "Manutenção", i: "wrench",perm: "manutencao.ver" }
  ]},
  { g: "Cadastros", itens: [
    { r: "clientes",   t: "Clientes",   i: "building", perm: "cliente.ver" },
    { r: "unidades",   t: "Unidades",   i: "school",   perm: "unidade.ver" },
    { r: "municipios", t: "Municípios", i: "map",      perm: "cliente.ver" },
    { r: "contratos",  t: "Contratos",  i: "file",     perm: "contrato.ver" },
    { r: "locacoes",   t: "Locações de Terceiros", i: "file", perm: "contrato.ver" },
    { r: "fornecedores", t: "Fornecedores", i: "truck", perm: "fornecedor.ver" }
  ]},
  { g: "Gestão", itens: [
    { r: "dashboard",  t: "Dashboard",  i: "chart",  perm: "dashboard.ver" },
    { r: "relatorios", t: "Relatórios", i: "file2",  perm: "relatorio.ver" },
    { r: "importacao", t: "Importações",i: "upload", perm: "importacao.executar" },
    { r: "usuarios",   t: "Usuários",   i: "users",  perm: "usuario.editar" },
    { r: "configuracoes", t: "Configurações", i: "gear", perm: "config.editar" }
  ]}
];

const ROTAS = {};
export function registrar(nome, fn) { ROTAS[nome] = fn; }

export function montarMenu(el, contadores = {}) {
  el.innerHTML = MENU.map(g => {
    const itens = g.itens.filter(i => !i.perm || pode(i.perm));
    if (!itens.length) return "";
    return `<div class="nav-grupo">${g.g}</div>` + itens.map(i => {
      const n = i.contador && contadores[i.r] ? `<span class="n">${contadores[i.r]}</span>` : "";
      return `<div class="nav-item" data-rota="${i.r}">${ico(i.i, 17)}<span>${i.t}</span>${n}</div>`;
    }).join("");
  }).join("");
  el.querySelectorAll("[data-rota]").forEach(n =>
    n.addEventListener("click", () => { location.hash = "#/" + n.dataset.rota; }));
}

export function marcarAtivo(rota) {
  document.querySelectorAll(".nav-item").forEach(n =>
    n.classList.toggle("on", n.dataset.rota === rota));
}

export function parseHash() {
  const h = (location.hash || "#/home").replace(/^#\/?/, "");
  const [caminho, qs] = h.split("?");
  const partes = caminho.split("/").filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  return { rota: partes[0] || "home", id: partes[1] || null, sub: partes[2] || null, params };
}

export function irPara(rota, id = "", params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${rota}${id ? "/" + id : ""}${qs ? "?" + qs : ""}`;
}

let ultimaRota = null;
export async function despachar(alvo) {
  const { rota, id, sub, params } = parseHash();
  const fn = ROTAS[rota];
  marcarAtivo(rota);
  if (rota !== ultimaRota) window.scrollTo(0, 0);
  ultimaRota = rota;
  if (!fn) {
    alvo.innerHTML = `<div class="vazio"><b>Página não encontrada</b><p>A rota "${rota}" não existe.</p>
      <a class="btn p" href="#/home">Voltar ao início</a></div>`;
    return;
  }
  alvo.innerHTML = `<div class="carregando"><span class="spin"></span>Carregando…</div>`;
  try {
    await fn(alvo, { id, sub, params });
  } catch (e) {
    console.error("[rota]", rota, e);
    const permissao = /permission|insufficient/i.test(e.message || "");
    alvo.innerHTML = `<div class="vazio"><b>${permissao ? "Acesso negado" : "Erro ao carregar"}</b>
      <p>${permissao ? "Seu perfil não tem permissão para acessar estes dados."
        : (e.message || "Ocorreu um erro inesperado.")}</p>
      <a class="btn" href="#/home">Voltar ao início</a></div>`;
  }
}

export function rotaInicial() { return ehTecnico() ? "home" : "home"; }
