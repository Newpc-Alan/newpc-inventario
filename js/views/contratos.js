/* NEWPC INVENTÁRIO — Contratos.
 *
 * Duas coisas MUITO diferentes convivem aqui, e nunca se misturam:
 *   contratos_cliente     → o que a NEWPC vende/entrega para o cliente (rota #/contratos)
 *   contratos_fornecedor  → equipamentos de terceiros que a NEWPC opera (rota #/locacoes)
 * Um ativo pode ter os dois ao mesmo tempo: dono é o fornecedor, uso é do cliente.
 *
 * Nenhum número desta tela é fixo. Toda contagem sai de contar() no servidor.
 */
import { paginaLista, abrirEditor } from "./lista.js";
import { obter, buscar, contar, listaRef, rotuloDeId, parametros } from "../store.js";
import {
  ico, esc, num, pct, moeda, dataBR, badge, cabecalhoPagina, kpi, barraProgresso,
  vazio, carregando, toast, baixarCSV
} from "../ui.js";
import { irPara } from "../router.js";
import { pode, sessao } from "../auth.js";
import * as C from "../config.js";

/* ============================================================
 * Utilidades locais
 * ============================================================ */

/* Valores contratuais só aparecem para quem tem perfil financeiro. */
function verFinanceiro() {
  return ["ADMINISTRADOR", "DIRETORIA"].includes(sessao.usuario?.perfil);
}
function valorProtegido(v) {
  return verFinanceiro() ? esc(moeda(v))
    : `<span style="color:var(--texto-2)">${ico("shield", 13)} restrito</span>`;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const emDiasISO = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/* Datas de contrato são gravadas como texto ISO (YYYY-MM-DD) pelo formulário,
   então comparação e ordenação alfabética já funcionam no Firestore. */
function diasRestantes(dataFim) {
  if (!dataFim) return null;
  const iso = String(dataFim.toDate ? dataFim.toDate().toISOString() : dataFim).slice(0, 10);
  const d = new Date(iso + "T12:00:00");
  return isNaN(d) ? null : Math.ceil((d.getTime() - Date.now()) / 86400000);
}
function textoVigencia(c) {
  const d = diasRestantes(c.data_fim);
  if (d === null) return "Sem data de término";
  if (d < 0) return `Vencido há ${num(Math.abs(d))} dia(s)`;
  if (d === 0) return "Vence hoje";
  return `Faltam ${num(d)} dia(s)`;
}
function corPrazo(d) {
  if (d === null) return "";
  if (d < 0) return "vermelho";
  if (d <= 30) return "laranja";
  if (d <= 90) return "amarelo";
  return "verde";
}

function contarPorStatus(base, status) {
  return contar("ativos", [...base, ["status", "==", status]]);
}

function dado(rot, valor) {
  const v = valor === null || valor === undefined || valor === "" || valor === "—";
  return `<div class="dado"><div class="r">${esc(rot)}</div>
    <div class="v ${v ? "vazio-v" : ""}">${v ? "—" : valor}</div></div>`;
}

/* Status exibidos nos cards de operação, na ordem em que a operação pensa. */
const STATUS_CARD = [
  { v: "EM_USO",               l: "Em uso",          cor: "verde"    },
  { v: "EM_ESTOQUE",           l: "Em estoque",      cor: "azul"     },
  { v: "EM_MANUTENCAO",        l: "Em manutenção",   cor: "laranja"  },
  { v: "NAO_LOCALIZADO",       l: "Não localizado",  cor: "vermelho" },
  { v: "DEVOLVIDO_FORNECEDOR", l: "Devolvidos",      cor: "cinza"    }
];

/* Carrega os ativos de um contrato paginando. Nunca puxa a coleção inteira:
   só o recorte do contrato e com teto rígido. */
async function ativosDoContrato(campo, id, maximo = 1000) {
  const out = [];
  let cursor = null;
  while (out.length < maximo) {
    const { dados, ultimo, fim } = await buscar("ativos", [[campo, "==", id]], null, 500, cursor);
    out.push(...dados);
    if (fim || !ultimo) break;
    cursor = ultimo;
  }
  return out.slice(0, maximo);
}

/* ============================================================
 * CONTRATOS COM CLIENTES  (#/contratos)
 * ============================================================ */
export async function contratos(alvo, ctx) {
  if (ctx.id) return fichaContratoCliente(alvo, ctx.id);

  alvo.innerHTML = `<div id="ct-faixa">${carregando("Analisando vigências…")}</div>
                    <div id="ct-lista"></div>`;

  /* A lista genérica cuida de filtros, busca, paginação e exportação. */
  await paginaLista(alvo.querySelector("#ct-lista"), "contratos_cliente", {
    titulo: "Contratos com clientes",
    subtitulo: "Contratos comerciais. Locações de fornecedores ficam em “Locações de Terceiros”.",
    filtrosUI: ["cliente_id", "status", "modalidade"],
    ordem: ["data_fim", "asc"],
    aoClicarLinha: d => irPara("contratos", d.id)
  });

  /* A faixa nasce no topo do container e é movida para logo abaixo do título da lista. */
  const filtrosEl = alvo.querySelector("#ct-lista #lst-filtros");
  if (filtrosEl) filtrosEl.before(alvo.querySelector("#ct-faixa"));

  const p = await parametros();
  const diasAlerta = p.diasAlertaContrato || 60;
  const janela = Math.max(60, diasAlerta);

  const [ativos, encerrados, proximos] = await Promise.all([
    contar("contratos_cliente", [["status", "==", "ATIVO"]]),
    contar("contratos_cliente", [["status", "==", "ENCERRADO"]]),
    buscar("contratos_cliente",
      [["data_fim", ">=", hojeISO()], ["data_fim", "<=", emDiasISO(janela)]],
      ["data_fim", "asc"], 200).then(r => r.dados.filter(c => c.status !== "ENCERRADO"))
  ]);

  const noAlerta = proximos.filter(c => (diasRestantes(c.data_fim) ?? 9999) <= diasAlerta);
  const em60 = proximos.filter(c => (diasRestantes(c.data_fim) ?? 9999) <= 60);

  alvo.querySelector("#ct-faixa").innerHTML = `
    <div class="grade g3" style="margin-bottom:14px">
      ${kpi("Contratos ativos", ativos, { cor: "verde", sub: "Use o filtro Status para listá-los" })}
      ${kpi(`Vencendo em ${diasAlerta} dias`, noAlerta.length, { cor: "laranja",
        sub: "Conforme parâmetro de alerta do sistema" })}
      ${kpi("Encerrados", encerrados, { cor: "", sub: "Contratos já finalizados" })}
    </div>
    ${em60.length ? `<div class="aviso warn" style="margin-bottom:14px">
      ${ico("alert", 18)}
      <div><b>${num(em60.length)} contrato(s) vencem nos próximos 60 dias.</b>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
          ${em60.map(c => `<div>
            <a href="#/contratos/${esc(c.id)}"><b>${esc(c.numero_contrato || "sem número")}</b></a>
            — ${esc(rotuloDeId("clientes", c.cliente_id))}
            · vence em ${esc(dataBR(c.data_fim))} (${esc(textoVigencia(c))})</div>`).join("")}
        </div>
      </div></div>` : ""}`;
}

async function fichaContratoCliente(alvo, id) {
  const c = await obter("contratos_cliente", id);
  if (!c) { alvo.innerHTML = vazio("Contrato não encontrado", "O registro pode ter sido excluído."); return; }
  const cli = c.cliente_id ? await obter("clientes", c.cliente_id) : null;
  const dias = diasRestantes(c.data_fim);
  const base = [["contrato_cliente_id", "==", id]];

  alvo.innerHTML = `
    <div class="ficha-topo">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:1px;opacity:.75;font-weight:700">
          ${ico("file", 13)} CONTRATO COM CLIENTE</div>
        <div class="pat" style="font-size:21px">${esc(c.numero_contrato || "Sem número")}</div>
        <div class="desc">${ico("building", 12)}
          ${esc(cli ? (cli.nome_fantasia || cli.razao_social) : "Cliente não informado")}</div>
        <div class="desc">${esc(c.objeto || "")}</div>
      </div>
      <div class="dir">
        <button class="btn" data-ir="#/contratos">${ico("arrows", 15)}Voltar</button>
        ${cli ? `<button class="btn" data-ir="#/clientes/${esc(cli.id)}">${ico("building", 15)}Abrir cliente</button>` : ""}
        ${pode("contrato.editar") ? `<button class="btn" id="cc-editar">${ico("edit", 15)}Editar</button>` : ""}
        <button class="btn p" data-ir="#/ativos?contrato_cliente_id=${esc(id)}">
          ${ico("cpu", 15)}Ver ativos do contrato</button>
      </div>
    </div>

    <div class="grade g2" style="margin-bottom:16px">
      <div class="card card-pad">
        ${dado("Status", badge(C.STATUS_CONTRATO_CLIENTE, c.status))}
        ${dado("Modalidade", esc(c.modalidade || ""))}
        ${dado("Vigência", `${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))}`)}
        ${dado("Prazo", `<span class="st st-${corPrazo(dias) === "verde" ? "verde"
            : corPrazo(dias) === "vermelho" ? "vermelho" : corPrazo(dias) === "laranja" ? "laranja" : "amarelo"}">
            ${esc(textoVigencia(c))}</span>`)}
        ${dado("Quantidade prevista", num(c.quantidade_prevista || 0))}
      </div>
      <div class="card card-pad">
        ${dado("Valor global", valorProtegido(c.valor_global))}
        ${dado("Valor mensal", valorProtegido(c.valor_mensal))}
        ${dado("Gestor do contrato", esc(c.gestor_contrato || ""))}
        ${dado("Fiscal do contrato", esc(c.fiscal_contrato || ""))}
        ${dado("Observações", esc(c.observacoes || ""))}
      </div>
    </div>

    <div id="cc-kpis">${carregando("Contando ativos vinculados…")}</div>

    <div class="pg-topo" style="margin-top:22px">
      <div><h2 style="font-size:17px">Ativos vinculados a este contrato</h2></div>
    </div>
    <div id="cc-ativos"></div>`;

  alvo.querySelector("#cc-editar")?.addEventListener("click", () =>
    abrirEditor("contratos_cliente", id, { aoSalvar: () => fichaContratoCliente(alvo, id) }));

  const [total, ...contagens] = await Promise.all([
    contar("ativos", base),
    ...STATUS_CARD.map(s => contarPorStatus(base, s.v))
  ]);
  const prev = Number(c.quantidade_prevista || 0);
  alvo.querySelector("#cc-kpis").innerHTML = `
    <div class="grade g3">
      ${kpi("Ativos no contrato", total, { cor: "azul", href: `#/ativos?contrato_cliente_id=${id}`,
        sub: prev ? `${pct(total, prev)}% dos ${num(prev)} previstos` : "" })}
      ${STATUS_CARD.map((s, i) => kpi(s.l, contagens[i], {
        cor: s.cor === "cinza" ? "" : s.cor,
        href: `#/ativos?contrato_cliente_id=${id}&status=${s.v}`
      })).join("")}
    </div>
    ${prev ? `<div style="margin-top:11px">${barraProgresso(pct(total, prev), true)}</div>` : ""}`;

  await paginaLista(alvo.querySelector("#cc-ativos"), "ativos", {
    titulo: "Equipamentos",
    subtitulo: "Lista paginada — a base de ativos nunca é carregada inteira.",
    filtrosFixos: [["contrato_cliente_id", "==", id]],
    filtrosUI: ["status", "unidade_id"],
    colunas: ["patrimonio_newpc", "categoria", "fabricante", "modelo", "unidade_id", "status"],
    semCriar: true,
    aoClicarLinha: d => irPara("ativos", d.id)
  });
}

/* ============================================================
 * LOCAÇÕES DE TERCEIROS  (#/locacoes) — controle de equipamentos de terceiros
 * Responde de imediato: quantos equipamentos existem por fornecedor e por operação.
 * ============================================================ */
export async function locacoes(alvo, ctx) {
  if (ctx.id) return fichaContratoFornecedor(alvo, ctx.id);
  await painelLocacoes(alvo);
}

async function painelLocacoes(alvo) {
  const recarregar = () => painelLocacoes(alvo);

  alvo.innerHTML = cabecalhoPagina(
    "Locações de Terceiros",
    "Equipamentos que pertencem a fornecedores e são operados pela NEWPC. Cada operação é contada separadamente.",
    `${pode("contrato.editar") ? `<button class="btn p" id="lo-novo">
        ${ico("plus", 15)}Novo contrato de locação</button>` : ""}`)
    + `<div id="lo-kpis">${carregando()}</div><div id="lo-secoes" style="margin-top:20px">${carregando()}</div>`;

  alvo.querySelector("#lo-novo")?.addEventListener("click", () =>
    abrirEditor("contratos_fornecedor", null, { aoSalvar: recarregar }));

  const p = await parametros();
  const diasAlerta = p.diasAlertaContrato || 60;

  /* Coleções referenciais são pequenas e vêm do cache do store. */
  const [fornecedoresLista, contratosLista, locados, comodatos, contratosAtivos] = await Promise.all([
    listaRef("fornecedores"),
    listaRef("contratos_fornecedor"),
    contar("ativos", [["origem_ativo", "==", "LOCADO"]]),
    contar("ativos", [["origem_ativo", "==", "COMODATO"]]),
    contar("contratos_fornecedor", [["status", "==", "ATIVO"]])
  ]);

  const vencendo = contratosLista.filter(c => {
    if (c.status === "ENCERRADO") return false;
    const d = diasRestantes(c.data_fim);
    return d !== null && d >= 0 && d <= diasAlerta;
  });

  alvo.querySelector("#lo-kpis").innerHTML = `<div class="grade g4">
    ${kpi("Equipamentos de terceiros", locados + comodatos, { cor: "azul",
      sub: `${num(locados)} locados · ${num(comodatos)} em comodato` })}
    ${kpi("Contratos ativos", contratosAtivos, { cor: "verde" })}
    ${kpi(`Vencendo em ${diasAlerta} dias`, vencendo.length, { cor: "laranja",
      sub: vencendo.length ? vencendo.map(c => c.codigo_interno).filter(Boolean).slice(0, 3).join(", ") : "" })}
    ${kpi("Operações cadastradas", contratosLista.length, { cor: "ciano",
      sub: `${num(new Set(contratosLista.map(c => c.fornecedor_id)).size)} fornecedor(es)` })}
  </div>`;

  const box = alvo.querySelector("#lo-secoes");

  if (!contratosLista.length) {
    box.innerHTML = vazio("Nenhum contrato de locação cadastrado",
      "Cadastre a primeira operação (ex.: “Aventis 01”) para começar a controlar os equipamentos de terceiros.",
      pode("contrato.editar") ? { texto: "Cadastrar contrato de locação", attr: 'id="lo-novo2"' } : null);
    box.querySelector("#lo-novo2")?.addEventListener("click", () =>
      abrirEditor("contratos_fornecedor", null, { aoSalvar: recarregar }));
    return;
  }

  /* Agrupa as operações por fornecedor (proprietário). */
  const porFornecedor = new Map();
  contratosLista.forEach(c => {
    const k = c.fornecedor_id || "__sem__";
    if (!porFornecedor.has(k)) porFornecedor.set(k, []);
    porFornecedor.get(k).push(c);
  });

  const nomeForn = fid => {
    const f = fornecedoresLista.find(x => x.id === fid);
    return f ? (f.nome_fantasia || f.razao_social) : "Fornecedor não informado";
  };
  const secoes = [...porFornecedor.entries()]
    .sort((a, b) => nomeForn(a[0]).localeCompare(nomeForn(b[0]), "pt-BR"));

  box.innerHTML = secoes.map(([fid, lista]) => {
    lista.sort((a, b) => String(a.codigo_interno || "").localeCompare(String(b.codigo_interno || ""), "pt-BR"));
    return `<div style="margin-bottom:26px">
      <div class="pg-topo" style="margin-bottom:11px">
        <div style="display:flex;align-items:center;gap:9px">
          ${ico("truck", 18)}
          <div><h2 style="font-size:17px">${esc(nomeForn(fid))}</h2>
            <p>${num(lista.length)} operação(ões) · proprietário dos equipamentos</p></div>
        </div>
        <div class="pg-acoes">
          ${fid !== "__sem__" ? `
            <button class="btn sm" data-ir="#/fornecedores/${esc(fid)}">${ico("eye", 14)}Abrir fornecedor</button>
            <button class="btn sm" data-ir="#/ativos?fornecedor_id=${esc(fid)}">${ico("cpu", 14)}Todos os ativos</button>` : ""}
        </div>
      </div>
      <div class="grade g3">${lista.map(c => cardOperacao(c)).join("")}</div>
    </div>`;
  }).join("");

  /* Fornecedores ainda sem nenhuma operação cadastrada — deixa o caminho pronto. */
  const semContrato = fornecedoresLista.filter(f => f.ativo !== false && !porFornecedor.has(f.id));
  if (semContrato.length) {
    box.insertAdjacentHTML("beforeend", `
      <div class="card card-pad">
        <b style="color:var(--marinho)">Fornecedores sem contrato cadastrado</b>
        <p style="font-size:12.8px;color:var(--texto-2);margin:4px 0 10px">
          Sem contrato não há como separar os equipamentos por operação.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${semContrato.map(f => `<button class="btn sm" data-novo-ct="${esc(f.id)}">
            ${ico("plus", 13)}${esc(f.nome_fantasia || f.razao_social)}</button>`).join("")}
        </div>
      </div>`);
    box.querySelectorAll("[data-novo-ct]").forEach(b => b.onclick = () =>
      abrirEditor("contratos_fornecedor", null, {
        valoresIniciais: { fornecedor_id: b.dataset.novoCt }, aoSalvar: recarregar
      }));
  }

  box.querySelectorAll("[data-abrir-ct]").forEach(b => b.onclick = () =>
    irPara("locacoes", b.dataset.abrirCt));

  await preencherContagens(contratosLista, box);
}

/* Card de uma operação. Os números entram depois, via preencherContagens(). */
function cardOperacao(c) {
  const prev = Number(c.quantidade_prevista || 0);
  return `<div class="card card-pad" data-ct="${esc(c.id)}">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div style="min-width:0">
        <div style="font-size:17px;font-weight:800;color:var(--marinho);letter-spacing:-.2px">
          ${esc(c.codigo_interno || "Sem código")}</div>
        <div style="font-size:12.2px;color:var(--texto-2)">
          Contrato ${esc(c.numero_contrato || "sem número")}</div>
      </div>
      <div style="margin-left:auto">${badge(C.STATUS_CONTRATO_FORNECEDOR, c.status)}</div>
    </div>
    <div style="font-size:12.2px;color:var(--texto-2);margin-top:8px">
      ${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))} · ${esc(textoVigencia(c))}</div>

    <button class="btn p bloco" style="margin-top:11px;justify-content:space-between"
      data-ir="#/ativos?contrato_fornecedor_id=${esc(c.id)}">
      <span>Total de equipamentos</span><b data-n="${esc(c.id)}:__total__">…</b></button>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px">
      ${STATUS_CARD.map(s => `<button class="btn sm" style="justify-content:space-between"
        data-ir="#/ativos?contrato_fornecedor_id=${esc(c.id)}&status=${s.v}">
        <span style="font-size:12px">${esc(s.l)}</span>
        <b data-n="${esc(c.id)}:${s.v}">…</b></button>`).join("")}
      <button class="btn sm" style="justify-content:space-between"
        data-ir="#/ativos?contrato_fornecedor_id=${esc(c.id)}">
        <span style="font-size:12px">Outros</span><b data-n="${esc(c.id)}:__outros__">…</b></button>
    </div>

    <div style="display:flex;justify-content:space-between;font-size:12.4px;margin:11px 0 5px">
      <span>Previstos: <b>${num(prev)}</b></span>
      <span>Cadastrados: <b data-n="${esc(c.id)}:__total2__">…</b></span>
    </div>
    <div data-barra="${esc(c.id)}">${barraProgresso(0)}</div>
    <div data-excedente="${esc(c.id)}"></div>

    <button class="btn sm bloco" style="margin-top:10px" data-abrir-ct="${esc(c.id)}">
      ${ico("eye", 14)}Abrir operação</button>
  </div>`;
}

/* Contagens dinâmicas de todos os cards. Vão em blocos paralelos para não
   serializar as consultas nem disparar centenas de requisições de uma vez. */
async function preencherContagens(lista, raiz) {
  const BLOCO = 6;
  for (let i = 0; i < lista.length; i += BLOCO) {
    if (!raiz.isConnected) return;               // usuário saiu da página: para de contar
    await Promise.all(lista.slice(i, i + BLOCO).map(async c => {
      const base = [["contrato_fornecedor_id", "==", c.id]];
      const [total, ...porStatus] = await Promise.all([
        contar("ativos", base),
        ...STATUS_CARD.map(s => contarPorStatus(base, s.v))
      ]);
      const outros = Math.max(0, total - porStatus.reduce((a, b) => a + b, 0));
      const escreve = (chave, valor) =>
        raiz.querySelectorAll(`[data-n="${c.id}:${chave}"]`).forEach(el => el.textContent = num(valor));

      escreve("__total__", total);
      escreve("__total2__", total);
      escreve("__outros__", outros);
      STATUS_CARD.forEach((s, k) => escreve(s.v, porStatus[k]));

      const prev = Number(c.quantidade_prevista || 0);
      const barra = raiz.querySelector(`[data-barra="${c.id}"]`);
      if (barra) barra.innerHTML = barraProgresso(pct(total, prev));
      const exc = raiz.querySelector(`[data-excedente="${c.id}"]`);
      if (exc && prev > 0 && total > prev) {
        exc.innerHTML = `<div class="aviso warn" style="margin-top:8px;font-size:12px">
          <div>${num(total - prev)} equipamento(s) acima do previsto.</div></div>`;
      }
    }));
  }
}

/* ---------------- ficha de uma operação/contrato de fornecedor ---------------- */
async function fichaContratoFornecedor(alvo, id) {
  const c = await obter("contratos_fornecedor", id);
  if (!c) { alvo.innerHTML = vazio("Contrato não encontrado", "O registro pode ter sido excluído."); return; }
  const forn = c.fornecedor_id ? await obter("fornecedores", c.fornecedor_id) : null;
  const base = [["contrato_fornecedor_id", "==", id]];
  const prev = Number(c.quantidade_prevista || 0);

  alvo.innerHTML = `
    <div class="ficha-topo">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:1px;opacity:.75;font-weight:700">
          ${ico("truck", 13)} OPERAÇÃO DE TERCEIRO · EQUIPAMENTOS DO FORNECEDOR</div>
        <div class="pat" style="font-size:22px">${esc(c.codigo_interno || "Sem código")}</div>
        <div class="desc">Proprietário: <b>${esc(forn ? (forn.nome_fantasia || forn.razao_social) : "não informado")}</b></div>
        <div class="desc">Contrato ${esc(c.numero_contrato || "sem número")} · ${esc(c.descricao || "")}</div>
      </div>
      <div class="dir">
        <button class="btn" data-ir="#/locacoes">${ico("arrows", 15)}Voltar</button>
        ${forn ? `<button class="btn" data-ir="#/fornecedores/${esc(forn.id)}">
          ${ico("truck", 15)}Abrir fornecedor</button>` : ""}
        ${pode("contrato.editar") ? `<button class="btn" id="cf-editar">${ico("edit", 15)}Editar</button>` : ""}
        <button class="btn" id="cf-exportar">${ico("down", 15)}Exportar</button>
        <button class="btn p" data-ir="#/ativos?contrato_fornecedor_id=${esc(id)}">
          ${ico("cpu", 15)}Ver ativos deste contrato</button>
      </div>
    </div>

    <div class="grade g2" style="margin-bottom:16px">
      <div class="card card-pad">
        ${dado("Status", badge(C.STATUS_CONTRATO_FORNECEDOR, c.status))}
        ${dado("Vigência", `${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))}`)}
        ${dado("Prazo", esc(textoVigencia(c)) + (c.prazo_meses ? ` · ${num(c.prazo_meses)} meses contratados` : ""))}
      </div>
      <div class="card card-pad">
        ${dado("Valor mensal", valorProtegido(c.valor_mensal))}
        ${dado("Quantidade prevista", num(prev))}
        ${dado("Observações", esc(c.observacoes || ""))}
      </div>
    </div>

    <div id="cf-kpis">${carregando("Contando equipamentos desta operação…")}</div>
    <div id="cf-dist" style="margin-top:20px">${carregando("Agrupando por cliente e município…")}</div>`;

  alvo.querySelector("#cf-editar")?.addEventListener("click", () =>
    abrirEditor("contratos_fornecedor", id, { aoSalvar: () => fichaContratoFornecedor(alvo, id) }));

  /* ---- contagens por status ---- */
  const [total, ...contagens] = await Promise.all([
    contar("ativos", base),
    ...STATUS_CARD.map(s => contarPorStatus(base, s.v))
  ]);
  const outros = Math.max(0, total - contagens.reduce((a, b) => a + b, 0));

  alvo.querySelector("#cf-kpis").innerHTML = `
    <div class="grade g4">
      ${kpi("Cadastrados", total, { cor: "azul", href: `#/ativos?contrato_fornecedor_id=${id}`,
        sub: prev ? `de ${num(prev)} previstos` : "Sem quantidade prevista" })}
      ${STATUS_CARD.map((s, i) => kpi(s.l, contagens[i], {
        cor: s.cor === "cinza" ? "" : s.cor,
        href: `#/ativos?contrato_fornecedor_id=${id}&status=${s.v}`
      })).join("")}
      ${kpi("Outros status", outros, { cor: "", href: `#/ativos?contrato_fornecedor_id=${id}` })}
    </div>
    ${prev ? `<div class="card card-pad" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:7px">
        <span>Previsto x real</span><b>${num(total)} / ${num(prev)} (${pct(total, prev)}%)</b></div>
      ${barraProgresso(pct(total, prev), true)}
      ${total > prev ? `<div class="aviso err" style="margin-top:10px">${ico("alert", 17)}
        <div><b>Quantidade acima do previsto.</b>
          Há ${num(total - prev)} equipamento(s) a mais do que o contrato prevê. Confira o cadastro
          antes de faturar ou devolver.</div></div>` : ""}
    </div>` : ""}`;

  /* ---- distribuição por cliente e município (agrupado em memória) ---- */
  const ativos = await ativosDoContrato("contrato_fornecedor_id", id, 1000);
  const boxD = alvo.querySelector("#cf-dist");

  if (!ativos.length) {
    boxD.innerHTML = vazio("Nenhum equipamento vinculado a esta operação",
      "Vincule os ativos ao contrato para acompanhar a quantidade real.");
  } else {
    const porCliente = agrupar(ativos, a => a.cliente_id);
    const porMunicipio = agrupar(ativos, a => a.municipio_id);
    const limitado = ativos.length >= 1000;

    boxD.innerHTML = `
      ${limitado ? `<div class="aviso info" style="margin-bottom:12px"><div>
        A distribuição considera os primeiros 1.000 equipamentos desta operação.
        Use a exportação para o total completo.</div></div>` : ""}
      <div class="grade g2">
        ${tabelaDistribuicao("Distribuição por cliente (onde estão instalados)", "clientes", porCliente,
          "#/ativos?contrato_fornecedor_id=" + id + "&cliente_id=")}
        ${tabelaDistribuicao("Distribuição por município", "municipios", porMunicipio,
          "#/ativos?contrato_fornecedor_id=" + id + "&municipio_id=")}
      </div>`;
  }

  alvo.querySelector("#cf-exportar").onclick = async () => {
    toast("Preparando exportação…", "info");
    const todos = await ativosDoContrato("contrato_fornecedor_id", id, 5000);
    baixarCSV(`locacao_${(c.codigo_interno || id).replace(/\s+/g, "_")}`,
      ["Patrimônio NEWPC", "Patrimônio fornecedor", "Categoria", "Fabricante", "Modelo",
       "Número de série", "Cliente", "Unidade", "Município", "Status", "Condição"],
      todos.map(a => [
        a.patrimonio_newpc || "", a.patrimonio_fornecedor || "",
        rotuloDeId("categorias", a.categoria), a.fabricante || "", a.modelo || "",
        a.numero_serie || "", rotuloDeId("clientes", a.cliente_id),
        rotuloDeId("unidades", a.unidade_id), rotuloDeId("municipios", a.municipio_id),
        C.labelDe(C.STATUS_ATIVO, a.status), C.labelDe(C.CONDICAO_ATIVO, a.condicao)
      ]));
    toast(`${todos.length} equipamento(s) exportado(s).`, "ok");
  };
}

/* Agrupa em memória: total, em uso e não localizados por chave. */
function agrupar(ativos, chaveDe) {
  const m = new Map();
  ativos.forEach(a => {
    const k = chaveDe(a) || "__sem__";
    if (!m.has(k)) m.set(k, { total: 0, emUso: 0, naoLocalizado: 0 });
    const g = m.get(k);
    g.total++;
    if (a.status === "EM_USO") g.emUso++;
    if (a.status === "NAO_LOCALIZADO") g.naoLocalizado++;
  });
  return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
}

function tabelaDistribuicao(titulo, colecao, grupos, hrefBase) {
  return `<div class="card">
    <div class="card-tit"><h3>${esc(titulo)}</h3></div>
    <div class="tab-wrap" style="border:0;box-shadow:none;border-radius:0">
      <table class="tab"><thead><tr>
        <th>${colecao === "clientes" ? "Cliente" : "Município"}</th>
        <th style="text-align:right">Total</th>
        <th style="text-align:right">Em uso</th>
        <th style="text-align:right">Não localizados</th>
      </tr></thead><tbody>
        ${grupos.map(([k, g]) => `<tr ${k !== "__sem__" ? `class="click" data-ir="${esc(hrefBase + k)}"` : ""}>
          <td>${k === "__sem__" ? "<i>Sem vínculo informado</i>" : esc(rotuloDeId(colecao, k))}</td>
          <td class="num"><b>${num(g.total)}</b></td>
          <td class="num">${num(g.emUso)}</td>
          <td class="num" ${g.naoLocalizado ? 'style="color:var(--vermelho);font-weight:700"' : ""}>
            ${num(g.naoLocalizado)}</td>
        </tr>`).join("")}
      </tbody></table>
    </div></div>`;
}
