/* NEWPC INVENTÁRIO — Dashboards gerenciais (itens 32 a 36)
 *
 * Princípio inegociável deste arquivo: nenhum número é estimado ou inventado.
 * Todo valor exibido vem de contar() ou buscar(). Quando uma consulta não é
 * viável (falta de índice composto, campo inexistente na base), mostramos "—"
 * e explicamos ao usuário — nunca um zero enganoso.
 *
 * A coleção "ativos" NUNCA é carregada inteira: usamos apenas contagens
 * agregadas (getCountFromServer) e leituras pontuais de 1 documento.
 */
import {
  buscar, contar, listaRef, rotuloDeId, parametros, salvarParametros
} from "../store.js";
import {
  ico, esc, num, pct, dataBR, barraProgresso, kpi, cabecalhoPagina, baixarCSV, toast, vazio
} from "../ui.js";
import { pode, ehAdmin } from "../auth.js";
import * as C from "../config.js";

/* ============================================================
 * 1. INFRAESTRUTURA DE CONSULTA SEGURA
 * ============================================================ */

/* Guarda as falhas de consulta da sessão para explicar ao usuário, uma única vez,
   o que precisa ser feito (normalmente: criar um índice composto no Firestore). */
const FALHAS = new Set();

function registrarFalha(descricao, erro) {
  const faltaIndice = /index/i.test(erro?.message || "");
  FALHAS.add(faltaIndice ? `${descricao} (índice composto ausente)` : `${descricao}: ${erro?.message || "erro"}`);
  console.error("[dashboard]", descricao, erro);
}

/** contar() que nunca derruba a tela: devolve null quando a consulta falha. */
export async function contarSeguro(colecao, filtros = [], descricao = "") {
  try {
    return await contar(colecao, filtros);
  } catch (e) {
    registrarFalha(descricao || `contagem em ${colecao}`, e);
    return null;
  }
}

/** buscar() tolerante: devolve [] quando a consulta falha. */
export async function buscarSeguro(colecao, filtros = [], ordem = null, tam = 0, descricao = "") {
  try {
    const { dados } = await buscar(colecao, filtros, ordem, tam);
    return dados;
  } catch (e) {
    registrarFalha(descricao || `consulta em ${colecao}`, e);
    return [];
  }
}

/** Mensagem amigável para erro de índice ausente do Firestore. */
export function avisoDeErro(e, contexto = "esta consulta") {
  const faltaIndice = /index/i.test(e?.message || "");
  return `<div class="aviso err">${ico("alert", 17)}<div>
    <b>${faltaIndice ? "Falta um índice no banco de dados" : "Não foi possível carregar " + esc(contexto)}</b>
    ${faltaIndice
      ? `O Firestore precisa de um índice composto para ${esc(contexto)}.
         Abra o console do navegador (tecla F12, aba "Console") e clique no link do Firebase que aparece
         na mensagem de erro — o índice é criado automaticamente em poucos minutos.`
      : esc(e?.message || "Erro inesperado.")}
  </div></div>`;
}

/** Bloco de rodapé listando o que não pôde ser calculado (transparência total). */
function avisoFalhas() {
  if (!FALHAS.size) return "";
  return `<div class="aviso warn" style="margin-top:14px">${ico("alert", 17)}<div>
    <b>Alguns números aparecem como "—" porque a consulta não pôde ser feita</b>
    ${[...FALHAS].map(f => esc(f)).join(" · ")}.
    Se a causa for índice ausente, abra o console do navegador (F12) e clique no link do Firebase
    para criar o índice automaticamente. Nada foi estimado.
  </div></div>`;
}

/** Formata número que pode ser desconhecido. Nunca chuta zero. */
const vNum = n => (n === null || n === undefined ? "—" : num(n));
/** Soma tolerante: se todas as parcelas falharam, o resultado é desconhecido. */
const soma = (...ns) => ns.every(n => n === null || n === undefined)
  ? null : ns.reduce((a, b) => a + (b || 0), 0);

/** Processa uma lista em lotes para paralelizar sem sobrecarregar o Firestore. */
export async function emLotes(itens, tamanhoLote, tarefa, aoProgredir) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    const bloco = itens.slice(i, i + tamanhoLote);
    saida.push(...await Promise.all(bloco.map(tarefa)));
    if (aoProgredir) aoProgredir(Math.min(i + tamanhoLote, itens.length), itens.length);
  }
  return saida;
}

/* ============================================================
 * 2. O CAMPO ultimo_inventario
 * ============================================================
 * O fluxo de inventário carimba `ativos.ultimo_inventario` quando um item é
 * conferido. Dependendo de como o registro foi criado (fluxo do app x importação),
 * o campo pode estar gravado como Timestamp ou como texto ISO "AAAA-MM-DD".
 * Comparar com o tipo errado devolveria zero silenciosamente — o que seria
 * um número inventado. Por isso descobrimos o tipo real lendo UM documento.
 */
let _tipoDataInv;

async function tipoDataInventario() {
  if (_tipoDataInv !== undefined) return _tipoDataInv;
  _tipoDataInv = null;
  /* ATENÇÃO: no Firestore, Timestamp ordena ANTES de String. Uma consulta
     ">= new Date(0)" também devolve documentos cujo campo é texto — por isso
     não dá para deduzir o tipo pelo simples fato de a consulta trazer resultado.
     Lemos um documento e olhamos o tipo real do valor. */
  try {
    const { dados } = await buscar("ativos", [["ultimo_inventario", ">=", new Date(0)]], ["ultimo_inventario", "desc"], 1);
    const v = dados[0]?.ultimo_inventario;
    if (v !== undefined && v !== null) _tipoDataInv = typeof v === "string" ? "iso" : "ts";
  } catch (e) { /* pode simplesmente não haver documento com a data preenchida */ }
  return _tipoDataInv;
}

/** Valor limite comparável (X dias atrás), no mesmo tipo gravado na base. */
async function limiteInv(dias) {
  const d = new Date(Date.now() - dias * 86400000);
  return (await tipoDataInventario()) === "iso" ? d.toISOString().slice(0, 10) : d;
}
/** Menor valor possível do campo — serve para contar quem TEM a data preenchida. */
async function minimoInv() {
  return (await tipoDataInventario()) === "iso" ? "" : new Date(0);
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const isoEmDias = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

/* ============================================================
 * 3. KPIs GERAIS — reutilizados pela home dos gestores (item 51)
 * ============================================================ */

/**
 * Todas as contagens principais do sistema, em paralelo.
 * @param {number} dias janela para "Inventariados no Período".
 */
export async function kpisGerais(dias = 30) {
  const limite = await limiteInv(dias);

  const [
    total, emUso, emEstoque, emManutencao, aguardandoPeca, aguardandoRecolhimento,
    naoLocalizados, divergencias, pendenciasAbertas, inventariadosPeriodo,
    contratosCliente, contratosFornecedor
  ] = await Promise.all([
    contarSeguro("ativos", [], "total de ativos"),
    contarSeguro("ativos", [["status", "==", "EM_USO"]], "ativos em uso"),
    contarSeguro("ativos", [["status", "==", "EM_ESTOQUE"]], "ativos em estoque"),
    contarSeguro("ativos", [["status", "==", "EM_MANUTENCAO"]], "ativos em manutenção"),
    contarSeguro("ativos", [["status", "==", "AGUARDANDO_PECA"]], "ativos aguardando peça"),
    contarSeguro("ativos", [["status", "==", "AGUARDANDO_RECOLHIMENTO"]], "ativos aguardando recolhimento"),
    contarSeguro("ativos", [["status", "==", "NAO_LOCALIZADO"]], "ativos não localizados"),
    contarSeguro("pendencias", [["tipo", "==", "DIVERGENCIA_LOCAL"], ["status", "==", "ABERTA"]], "divergências de localização"),
    contarSeguro("pendencias", [["status", "in", ["ABERTA", "EM_ANALISE"]]], "pendências abertas"),
    contarSeguro("ativos", [["ultimo_inventario", ">=", limite]], "ativos inventariados no período"),
    contarSeguro("contratos_cliente", [["status", "==", "ATIVO"]], "contratos de cliente ativos"),
    contarSeguro("contratos_fornecedor", [["status", "==", "ATIVO"]], "contratos de fornecedor ativos")
  ]);

  return {
    dias, total, emUso, emEstoque, emManutencao, aguardandoPeca, aguardandoRecolhimento,
    naoLocalizados, divergencias, pendenciasAbertas, inventariadosPeriodo,
    contratosCliente, contratosFornecedor,
    contratosAtivos: soma(contratosCliente, contratosFornecedor),
    percentualInventariado: (total && inventariadosPeriodo !== null) ? pct(inventariadosPeriodo, total) : null
  };
}

/** HTML da faixa de KPIs. Cada card leva para a listagem já filtrada. */
export function blocoKPIs(d) {
  return `<div class="grade g5">
    ${kpi("Total de Ativos", vNum(d.total), { cor: "azul", href: "#/ativos" })}
    ${kpi("Em Uso", vNum(d.emUso), { cor: "verde", href: "#/ativos?status=EM_USO" })}
    ${kpi("Em Estoque", vNum(d.emEstoque), { cor: "azul", href: "#/ativos?status=EM_ESTOQUE" })}
    ${kpi("Em Manutenção", vNum(d.emManutencao), {
      cor: "laranja", href: "#/ativos?status=EM_MANUTENCAO",
      sub: d.aguardandoPeca ? `+ ${num(d.aguardandoPeca)} aguardando peça` : ""
    })}
    ${kpi("Aguardando Recolhimento", vNum(d.aguardandoRecolhimento), { cor: "amarelo", href: "#/ativos?status=AGUARDANDO_RECOLHIMENTO" })}
    ${kpi("Não Localizados", vNum(d.naoLocalizados), { cor: "vermelho", href: "#/ativos?status=NAO_LOCALIZADO" })}
    ${kpi("Divergências", vNum(d.divergencias), {
      cor: "laranja", sub: "Pendências de localização abertas",
      href: "#/pendencias?tipo=DIVERGENCIA_LOCAL&status=ABERTA"
    })}
    <div id="kpi-inv-periodo" style="display:contents">${kpiInventariados(d)}</div>
    ${kpi("Contratos Ativos", vNum(d.contratosAtivos), {
      cor: "verde", href: "#/contratos?status=ATIVO",
      sub: `${vNum(d.contratosCliente)} com clientes · ${vNum(d.contratosFornecedor)} locações`
    })}
  </div>`;
}

/* Os dois KPIs que dependem do período ficam isolados para recálculo rápido. */
function kpiInventariados(d) {
  const perc = d.percentualInventariado;
  return kpi(`Inventariados em ${d.dias} dias`, vNum(d.inventariadosPeriodo), {
    cor: "ciano", href: `#/relatorios?tipo=inventariados&dias=${d.dias}`,
    sub: "Ativos com conferência registrada"
  }) + kpi("Percentual Inventariado", perc === null ? "—" : perc + "%", {
    cor: perc === null ? "" : perc >= 80 ? "verde" : perc >= 50 ? "amarelo" : "vermelho",
    sub: `Base de ${vNum(d.total)} ativos`
  });
}

/* ============================================================
 * 4. ALERTAS — usados pela home dos gestores
 * ============================================================ */

/** @returns {Promise<Array<{nivel:"err"|"warn"|"info", titulo:string, texto:string, href:string}>>} */
export async function carregarAlertas() {
  const p = await parametros();
  const limiteContrato = isoEmDias(p.diasAlertaContrato);
  const hoje = hojeISO();
  const limiteInventario = await limiteInv(p.diasInventarioVencido);

  const [naoLoc, pendencias, movPendentes, ctrCliente, ctrFornecedor, invPausados, invVencidos] =
    await Promise.all([
      contarSeguro("ativos", [["status", "==", "NAO_LOCALIZADO"]], "ativos não localizados"),
      contarSeguro("pendencias", [["status", "in", ["ABERTA", "EM_ANALISE"]]], "pendências abertas"),
      contarSeguro("movimentacoes", [["status", "==", "PENDENTE"]], "movimentações pendentes"),
      /* Só faixa de datas (sem status junto) para não exigir índice composto. */
      contarSeguro("contratos_cliente", [["data_fim", ">=", hoje], ["data_fim", "<=", limiteContrato]], "contratos de cliente vencendo"),
      contarSeguro("contratos_fornecedor", [["data_fim", ">=", hoje], ["data_fim", "<=", limiteContrato]], "locações vencendo"),
      contarSeguro("inventarios", [["status", "==", "PAUSADO"]], "inventários pausados"),
      contarSeguro("ativos", [["ultimo_inventario", "<", limiteInventario]], "ativos com inventário vencido")
    ]);

  const alertas = [];
  if (naoLoc) alertas.push({
    nivel: "err", titulo: `${num(naoLoc)} equipamento(s) não localizado(s)`,
    texto: "Precisam de nova busca em campo ou abertura de ocorrência.",
    href: "#/ativos?status=NAO_LOCALIZADO"
  });
  if (pendencias) alertas.push({
    nivel: "warn", titulo: `${num(pendencias)} pendência(s) em aberto`,
    texto: "Divergências, defeitos e cadastros aguardando análise.",
    href: "#/pendencias?status=ABERTA"
  });
  if (movPendentes) alertas.push({
    nivel: "warn", titulo: `${num(movPendentes)} movimentação(ões) aguardando aprovação`,
    texto: "Transferências e substituições travadas até a liberação.",
    href: "#/movimentacoes?status=PENDENTE"
  });
  const contratos = soma(ctrCliente, ctrFornecedor);
  if (contratos) alertas.push({
    nivel: "warn", titulo: `${num(contratos)} contrato(s) vencendo em até ${p.diasAlertaContrato} dias`,
    texto: `${vNum(ctrCliente)} com clientes e ${vNum(ctrFornecedor)} de locação de terceiros.`,
    href: "#/contratos"
  });
  if (invVencidos) alertas.push({
    nivel: "info", titulo: `${num(invVencidos)} ativo(s) com inventário vencido`,
    texto: `Sem conferência de localização há mais de ${p.diasInventarioVencido} dias.`,
    href: "#/dashboard/saude"
  });
  if (invPausados) alertas.push({
    nivel: "info", titulo: `${num(invPausados)} inventário(s) pausado(s)`,
    texto: "Retome para não perder o trabalho já conferido.",
    href: "#/inventario?status=PAUSADO"
  });
  return alertas;
}

/* ============================================================
 * 5. SAÚDE DO INVENTÁRIO (item 36)
 * ============================================================ */

/**
 * Quatro números que somam a realidade da base:
 *  confirmados     — ultimo_inventario dentro do prazo
 *  revisao         — pendências abertas (necessitam revisão humana)
 *  naoLocalizados  — status NAO_LOCALIZADO
 *  vencidos        — ultimo_inventario mais antigo que o prazo OU campo ausente
 *
 * PERFORMANCE / LIMITAÇÃO DO FIRESTORE: não existe consulta "campo ausente".
 * Uma cláusula de range já exclui automaticamente os documentos sem o campo.
 * Então fazemos duas contagens de range (dentro do prazo e antes do prazo) e
 * deduzimos os "nunca inventariados" por: total − (documentos que têm a data).
 * Nada é estimado: as três parcelas vêm todas do servidor.
 */
export async function saudeInventario(dias) {
  const limite = await limiteInv(dias);
  const minimo = await minimoInv();

  const [total, comData, confirmados, anteriores, naoLocalizados, revisao] = await Promise.all([
    contarSeguro("ativos", [], "total de ativos"),
    contarSeguro("ativos", [["ultimo_inventario", ">=", minimo]], "ativos com data de inventário"),
    contarSeguro("ativos", [["ultimo_inventario", ">=", limite]], "ativos confirmados no prazo"),
    contarSeguro("ativos", [["ultimo_inventario", "<", limite]], "ativos com inventário vencido"),
    contarSeguro("ativos", [["status", "==", "NAO_LOCALIZADO"]], "ativos não localizados"),
    contarSeguro("pendencias", [["status", "in", ["ABERTA", "EM_ANALISE"]]], "pendências abertas")
  ]);

  const nuncaInventariados = (total === null || comData === null) ? null : Math.max(0, total - comData);
  const vencidos = soma(anteriores, nuncaInventariados);

  return {
    dias, total, confirmados, revisao, naoLocalizados, vencidos, nuncaInventariados,
    percentual: (total && confirmados !== null) ? pct(confirmados, total) : null
  };
}

/* ============================================================
 * 6. VIEW PRINCIPAL — abas
 * ============================================================ */

const ABAS = [
  { id: "geral",     titulo: "Geral",                 montar: abaGeral },
  { id: "saude",     titulo: "Saúde do Inventário",   montar: abaSaude },
  { id: "origem",    titulo: "Por Origem",            montar: abaOrigem },
  { id: "cliente",   titulo: "Por Cliente",           montar: abaPorCliente },
  { id: "municipio", titulo: "Por Município",         montar: abaPorMunicipio }
];

export async function dashboard(alvo, ctx = {}) {
  if (!pode("dashboard.ver")) {
    alvo.innerHTML = cabecalhoPagina("Dashboard") +
      `<div class="aviso warn">${ico("shield", 17)}<div><b>Painel indisponível para o seu perfil</b>
        Sua tela inicial já traz os atalhos e indicadores do seu dia a dia.</div></div>`;
    return;
  }

  alvo.innerHTML = cabecalhoPagina("Dashboard", "Indicadores consolidados do inventário de TI") +
    `<div class="abas" id="dash-abas">
      ${ABAS.map(a => `<div class="aba" data-aba="${a.id}">${esc(a.titulo)}</div>`).join("")}
    </div>
    <div id="dash-painel"></div>`;

  const painel = alvo.querySelector("#dash-painel");
  const montados = new Map();   /* cache de DOM por aba: trocar de aba não recarrega */
  let atual = null;

  async function abrir(id) {
    const aba = ABAS.find(a => a.id === id) || ABAS[0];
    if (atual === aba.id) return;
    atual = aba.id;
    alvo.querySelectorAll("[data-aba]").forEach(el => el.classList.toggle("on", el.dataset.aba === aba.id));

    if (!montados.has(aba.id)) {
      const box = document.createElement("div");
      montados.set(aba.id, box);
      painel.replaceChildren(box);
      try { await aba.montar(box); }
      catch (e) { box.innerHTML = avisoDeErro(e, `a aba ${aba.titulo.toLowerCase()}`); }
    } else {
      painel.replaceChildren(montados.get(aba.id));
    }
  }

  alvo.querySelectorAll("[data-aba]").forEach(el => el.onclick = () => abrir(el.dataset.aba));
  await abrir(ctx.id || "geral");
}

/* ---------- esqueletos de carregamento ---------- */
function skelKPIs(n = 10) {
  return `<div class="grade g5">${Array.from({ length: n }, () => `
    <div class="kpi"><span class="faixa"></span>
      <div class="skel" style="width:62%"></div>
      <div class="skel" style="width:42%;height:24px;margin-top:9px"></div>
    </div>`).join("")}</div>`;
}
function skelLinhas(n = 6) {
  return `<div class="card card-pad">${Array.from({ length: n }, () =>
    `<div class="skel" style="margin-bottom:10px"></div>`).join("")}</div>`;
}

/* ---------- seletor de período reutilizável ---------- */
function seletorPeriodo(idBase, diasAtual, rotulo = "Período de apuração") {
  const fixos = [30, 60, 90, 180];
  const personalizado = !fixos.includes(diasAtual);
  return `<div class="filtros" style="margin-top:14px;margin-bottom:0">
    <div class="linha">
      <div class="campo"><label>${esc(rotulo)}</label>
        <select class="inp" id="${idBase}-sel">
          ${fixos.map(d => `<option value="${d}" ${d === diasAtual && !personalizado ? "selected" : ""}>Últimos ${d} dias</option>`).join("")}
          <option value="custom" ${personalizado ? "selected" : ""}>Personalizado…</option>
        </select>
      </div>
      <div class="campo ${personalizado ? "" : "oculto"}" id="${idBase}-cx">
        <label>Quantidade de dias</label>
        <input class="inp" type="number" min="1" max="3650" id="${idBase}-dias" value="${diasAtual}">
      </div>
      <div class="campo" style="justify-content:flex-end">
        <label>&nbsp;</label>
        <button class="btn p" id="${idBase}-ok">${ico("chart", 15)}Recalcular</button>
      </div>
    </div>
  </div>`;
}

function ligarSeletorPeriodo(box, idBase, aoMudar) {
  const sel = box.querySelector(`#${idBase}-sel`);
  const cx = box.querySelector(`#${idBase}-cx`);
  const inp = box.querySelector(`#${idBase}-dias`);
  const btn = box.querySelector(`#${idBase}-ok`);
  sel.onchange = () => cx.classList.toggle("oculto", sel.value !== "custom");
  const disparar = async () => {
    const dias = sel.value === "custom" ? Math.max(1, Number(inp.value) || 30) : Number(sel.value);
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="spin"></span>`;
    try { await aoMudar(dias); } finally { btn.disabled = false; btn.innerHTML = orig; }
  };
  btn.onclick = disparar;
  inp && inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); disparar(); } });
}

/* ============================================================
 * ABA GERAL (item 32)
 * ============================================================ */
async function abaGeral(box) {
  let dias = 30;
  box.innerHTML = skelKPIs(10);

  let dados = await kpisGerais(dias);
  box.innerHTML = `<div id="g-kpis">${blocoKPIs(dados)}</div>
    ${seletorPeriodo("g-per", dias, "Período de \"Inventariados\"")}
    <p class="hint" style="margin-top:8px;color:var(--texto-2);font-size:12px">
      Clique em qualquer indicador para abrir a listagem já filtrada.</p>
    ${avisoFalhas()}`;

  ligarSeletorPeriodo(box, "g-per", async novoDias => {
    dias = novoDias;
    /* Recalcula apenas o que depende do período — os demais KPIs não mudam. */
    const limite = await limiteInv(dias);
    const inventariados = await contarSeguro("ativos", [["ultimo_inventario", ">=", limite]], "ativos inventariados no período");
    dados = {
      ...dados, dias, inventariadosPeriodo: inventariados,
      percentualInventariado: (dados.total && inventariados !== null) ? pct(inventariados, dados.total) : null
    };
    box.querySelector("#kpi-inv-periodo").innerHTML = kpiInventariados(dados);
  });
}

/* ============================================================
 * ABA SAÚDE DO INVENTÁRIO (item 36)
 * ============================================================ */
async function abaSaude(box) {
  const p = await parametros();
  let dias = p.diasInventarioVencido;
  box.innerHTML = skelKPIs(4);

  async function pintar() {
    const s = await saudeInventario(dias);
    const perc = s.percentual;
    const cor = perc === null ? "azul" : perc >= 85 ? "verde" : perc >= 60 ? "amarelo" : "vermelho";

    box.innerHTML = `
      <div class="card card-pad">
        <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <div class="kpi-rot" style="font-size:11.5px;color:var(--texto-2);font-weight:600;
              text-transform:uppercase;letter-spacing:.4px">Localização confirmada no prazo</div>
            <div style="font-size:54px;font-weight:800;line-height:1.05;color:var(--${
              cor === "verde" ? "verde" : cor === "amarelo" ? "amarelo" : cor === "vermelho" ? "vermelho" : "petroleo"
            });font-variant-numeric:tabular-nums">${perc === null ? "—" : perc + "%"}</div>
            <div style="font-size:13px;color:var(--texto-2)">
              ${vNum(s.confirmados)} de ${vNum(s.total)} ativos conferidos nos últimos ${s.dias} dias</div>
          </div>
          <div style="flex:1;min-width:240px;padding-bottom:8px">${barraProgresso(perc || 0, true)}</div>
        </div>
      </div>

      <div class="grade g4" style="margin-top:14px">
        ${kpi("Confirmados", vNum(s.confirmados), {
          cor: "verde", sub: `Conferidos nos últimos ${s.dias} dias`,
          href: `#/relatorios?tipo=inventariados&dias=${s.dias}`
        })}
        ${kpi("Necessitam revisão", vNum(s.revisao), {
          cor: "amarelo", sub: "Com pendência aberta ou em análise", href: "#/pendencias?status=ABERTA"
        })}
        ${kpi("Não localizados", vNum(s.naoLocalizados), {
          cor: "vermelho", sub: "Status Não Localizado", href: "#/ativos?status=NAO_LOCALIZADO"
        })}
        ${kpi("Inventário vencido", vNum(s.vencidos), {
          cor: "laranja",
          sub: s.nuncaInventariados === null ? "Fora do prazo"
             : `Inclui ${num(s.nuncaInventariados)} nunca inventariado(s)`,
          href: "#/ativos"
        })}
      </div>

      <div class="aviso info" style="margin-top:14px">${ico("clock", 17)}<div>
        <b>Como lemos "vencido"</b>
        São os ativos cuja última conferência é anterior ao prazo escolhido, somados aos que nunca
        tiveram conferência registrada. O Firestore não consulta campo ausente, então os "nunca
        inventariados" saem de <i>total de ativos menos ativos com data de conferência</i> — ambas
        as contagens vêm do servidor, sem estimativa.
      </div></div>

      ${seletorPeriodo("s-per", dias, "Prazo considerado válido")}
      ${ehAdmin() ? `<div style="margin-top:10px">
        <button class="btn" id="s-salvar">${ico("check", 15)}Salvar ${dias} dias como padrão do sistema</button>
        <span class="hint" style="margin-left:8px;color:var(--texto-2);font-size:12px">
          Padrão atual: ${num(p.diasInventarioVencido)} dias</span>
      </div>` : ""}
      ${avisoFalhas()}`;

    ligarSeletorPeriodo(box, "s-per", async novoDias => { dias = novoDias; await pintar(); });

    const btnSalvar = box.querySelector("#s-salvar");
    if (btnSalvar) btnSalvar.onclick = async () => {
      btnSalvar.disabled = true;
      const orig = btnSalvar.innerHTML;
      btnSalvar.innerHTML = `<span class="spin"></span>`;
      try {
        await salvarParametros({ diasInventarioVencido: dias });
        p.diasInventarioVencido = dias;
        toast(`Prazo padrão de inventário definido em ${dias} dias.`, "ok");
        await pintar();
      } catch (e) {
        console.error(e);
        toast("Não foi possível salvar o parâmetro.", "err");
        btnSalvar.disabled = false; btnSalvar.innerHTML = orig;
      }
    };
  }

  await pintar();
}

/* ============================================================
 * ABA POR ORIGEM (item 33)
 * ============================================================ */
const STATUS_QUEBRA = [
  { v: "EM_USO", l: "Em uso", cor: "verde" },
  { v: "EM_ESTOQUE", l: "Em estoque", cor: "azul" },
  { v: "EM_MANUTENCAO", l: "Em manutenção", cor: "laranja" },
  { v: "AGUARDANDO_RECOLHIMENTO", l: "Aguard. recolhimento", cor: "amarelo" },
  { v: "NAO_LOCALIZADO", l: "Não localizado", cor: "vermelho" }
];

function linhaContagem(rot, valor, href, cor = "") {
  return `<div class="dado" ${href ? `data-ir="${esc(href)}" style="cursor:pointer"` : ""}>
    <div style="display:flex;align-items:center;gap:9px">
      <span style="flex:1;font-size:13px">${esc(rot)}</span>
      <b class="${cor}" style="font-variant-numeric:tabular-nums">${vNum(valor)}</b>
      ${href ? ico("arrows", 13) : ""}
    </div></div>`;
}

async function abaOrigem(box) {
  box.innerHTML = skelKPIs(5);

  /* 5 origens × (1 total + 5 status) = 30 contagens, executadas em lotes. */
  const origens = await emLotes(C.ORIGEM_ATIVO, 2, async o => {
    const base = [["origem_ativo", "==", o.v]];
    const [total, ...porStatus] = await Promise.all([
      contarSeguro("ativos", base, `ativos de origem ${o.label}`),
      ...STATUS_QUEBRA.map(s => contarSeguro("ativos", [...base, ["status", "==", s.v]], `ativos ${o.label}/${s.l}`))
    ]);
    return { ...o, total, porStatus };
  });

  box.innerHTML = `<div class="grade g3">
    ${origens.map(o => `
      <div class="card">
        <div class="card-tit">
          <h3>${esc(o.label)}</h3>
          <div class="dir"><b style="font-size:20px;color:var(--marinho);font-variant-numeric:tabular-nums">${vNum(o.total)}</b></div>
        </div>
        <div class="card-pad" style="padding-top:2px;padding-bottom:6px">
          ${STATUS_QUEBRA.map((s, i) => linhaContagem(s.l, o.porStatus[i],
            `#/ativos?origem_ativo=${o.v}&status=${s.v}`)).join("")}
        </div>
        <div style="padding:0 16px 13px">
          <button class="btn sm bloco" data-ir="#/ativos?origem_ativo=${o.v}">
            ${ico("eye", 14)}Ver todos os ${esc(o.label.toLowerCase())}</button>
        </div>
      </div>`).join("")}
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-tit">${ico("truck", 17)}<h3>Locados de Terceiros por fornecedor</h3>
      <div class="dir"><span class="hint" style="font-size:12px;color:var(--texto-2)">Clique no fornecedor para abrir os contratos/operações</span></div>
    </div>
    <div id="orig-forn">${skelLinhas(5)}</div>
  </div>
  ${avisoFalhas()}`;

  await detalharLocados(box.querySelector("#orig-forn"));
}

async function detalharLocados(alvo) {
  const fornecedores = await listaRef("fornecedores");
  if (!fornecedores.length) {
    alvo.innerHTML = vazio("Nenhum fornecedor cadastrado",
      "Cadastre os fornecedores para acompanhar os equipamentos locados por operação.");
    return;
  }

  alvo.innerHTML = `<div class="card-pad" id="orig-prog">
    <div class="skel" style="width:40%"></div></div>`;
  const prog = alvo.querySelector("#orig-prog");

  const linhas = await emLotes(fornecedores, 8, async f => ({
    f,
    total: await contarSeguro("ativos",
      [["origem_ativo", "==", "LOCADO"], ["fornecedor_id", "==", f.id]], "ativos locados por fornecedor")
  }), (feitos, tudo) => {
    prog.innerHTML = `<div class="carregando" style="padding:16px">
      <span class="spin"></span>Calculando ${feitos} de ${tudo} fornecedores…</div>`;
  });

  const comAtivos = linhas.filter(l => l.total).sort((a, b) => (b.total || 0) - (a.total || 0));
  if (!comAtivos.length) {
    alvo.innerHTML = `<div class="card-pad"><div class="aviso info">${ico("bell", 17)}<div>
      Nenhum ativo com origem <b>Locado de Terceiro</b> vinculado a fornecedor no momento.</div></div></div>`;
    return;
  }

  alvo.innerHTML = `<div class="card-pad" style="padding-top:4px">
    ${comAtivos.map(l => `
      <div class="dado">
        <div style="display:flex;align-items:center;gap:9px;cursor:pointer" data-forn="${esc(l.f.id)}">
          ${ico("down", 14)}
          <span style="flex:1;font-size:13.5px;font-weight:600">${esc(l.f.nome_fantasia || l.f.razao_social)}</span>
          <b data-ir="#/ativos?origem_ativo=LOCADO&fornecedor_id=${esc(l.f.id)}"
             style="font-variant-numeric:tabular-nums">${num(l.total)}</b>
        </div>
        <div class="oculto" data-corpo="${esc(l.f.id)}" style="padding:8px 0 2px 23px"></div>
      </div>`).join("")}
  </div>`;

  alvo.querySelectorAll("[data-forn]").forEach(cab => cab.onclick = async e => {
    if (e.target.closest("[data-ir]")) return;
    const id = cab.dataset.forn;
    const corpo = alvo.querySelector(`[data-corpo="${id}"]`);
    corpo.classList.toggle("oculto");
    if (corpo.dataset.pronto || corpo.classList.contains("oculto")) return;
    corpo.dataset.pronto = "1";
    corpo.innerHTML = `<div class="skel" style="width:55%"></div>`;

    /* Quebra por contrato/operação — carregada só quando o fornecedor é aberto,
       para não disparar centenas de contagens de uma vez. */
    const contratos = (await listaRef("contratos_fornecedor")).filter(c => c.fornecedor_id === id);
    const resultados = await emLotes(contratos, 8, async c => ({
      c,
      total: await contarSeguro("ativos",
        [["origem_ativo", "==", "LOCADO"], ["contrato_fornecedor_id", "==", c.id]], "ativos por contrato de fornecedor")
    }));
    const semContrato = await contarSeguro("ativos",
      [["origem_ativo", "==", "LOCADO"], ["fornecedor_id", "==", id], ["contrato_fornecedor_id", "==", null]],
      "ativos locados sem contrato");

    corpo.innerHTML = (resultados.length
      ? resultados.map(r => linhaContagem(
          `${r.c.codigo_interno || r.c.numero_contrato || "Operação"}${r.c.status ? "" : ""}`,
          r.total, `#/ativos?origem_ativo=LOCADO&contrato_fornecedor_id=${r.c.id}`).replace("class=\"dado\"", "class=\"dado\" style=\"border-bottom:0\"")).join("")
      : `<div class="hint" style="font-size:12.5px;color:var(--texto-2)">Nenhum contrato/operação cadastrado para este fornecedor.</div>`)
      + (semContrato ? linhaContagem("Sem contrato vinculado", semContrato,
          `#/ativos?origem_ativo=LOCADO&fornecedor_id=${id}`) : "");
  });
}

/* ============================================================
 * ABAS POR CLIENTE (item 34) E POR MUNICÍPIO (item 35)
 * ============================================================ */
async function abaPorCliente(box) {
  await abaAgrupada(box, {
    colecao: "clientes", campo: "cliente_id", rotuloCol: "Cliente",
    rotaListagem: "clientes", nomeArquivo: "dashboard_por_cliente"
  });
}
async function abaPorMunicipio(box) {
  await abaAgrupada(box, {
    colecao: "municipios", campo: "municipio_id", rotuloCol: "Município",
    rotaListagem: "municipios", nomeArquivo: "dashboard_por_municipio"
  });
}

/**
 * Tabela ordenável de cobertura por agrupamento.
 * Contagens feitas em lotes de 8 grupos por vez (4 contagens + 1 leitura cada),
 * com progresso visível. Nunca carrega a coleção de ativos.
 */
async function abaAgrupada(box, cfg) {
  const p = await parametros();
  const dias = p.diasInventarioVencido;
  const limite = await limiteInv(dias);
  const grupos = (await listaRef(cfg.colecao)).filter(g => g.ativo !== false);

  box.innerHTML = `<div class="card"><div class="card-tit">${ico("chart", 17)}
      <h3>Cobertura por ${esc(cfg.rotuloCol.toLowerCase())}</h3></div>
    <div id="ag-corpo"><div class="carregando"><span class="spin"></span>Preparando…</div></div></div>`;
  const corpo = box.querySelector("#ag-corpo");

  if (!grupos.length) {
    corpo.innerHTML = vazio(`Nenhum ${cfg.rotuloCol.toLowerCase()} cadastrado`,
      "Cadastre primeiro para acompanhar a cobertura do inventário.");
    return;
  }

  const linhas = await emLotes(grupos, 8, async g => {
    const base = [[cfg.campo, "==", g.id]];
    const [total, inventariados, divergentes, naoLoc, ultimo] = await Promise.all([
      contarSeguro("ativos", base, `ativos por ${cfg.rotuloCol.toLowerCase()}`),
      /* equality + range: exige índice composto (campo + ultimo_inventario) */
      contarSeguro("ativos", [...base, ["ultimo_inventario", ">=", limite]],
        `ativos inventariados por ${cfg.rotuloCol.toLowerCase()}`),
      contarSeguro("pendencias", [...base, ["tipo", "==", "DIVERGENCIA_LOCAL"], ["status", "==", "ABERTA"]],
        `divergências por ${cfg.rotuloCol.toLowerCase()}`),
      contarSeguro("ativos", [...base, ["status", "==", "NAO_LOCALIZADO"]],
        `não localizados por ${cfg.rotuloCol.toLowerCase()}`),
      buscarSeguro("ativos", [...base, ["ultimo_inventario", ">=", await minimoInv()]],
        ["ultimo_inventario", "desc"], 1, `última conferência por ${cfg.rotuloCol.toLowerCase()}`)
    ]);
    const pendentes = (total === null || inventariados === null) ? null : Math.max(0, total - inventariados);
    return {
      id: g.id,
      nome: rotuloDeId(cfg.colecao, g.id),
      total, inventariados, pendentes, divergentes, naoLoc,
      perc: (total && inventariados !== null) ? pct(inventariados, total) : null,
      ultimo: ultimo[0]?.ultimo_inventario || null
    };
  }, (feitos, tudo) => {
    corpo.innerHTML = `<div class="carregando"><span class="spin"></span>
      Calculando ${feitos} de ${tudo} ${cfg.colecao === "clientes" ? "clientes" : "municípios"}…</div>`;
  });

  const COLS = [
    { k: "nome",          t: cfg.rotuloCol, tipo: "txt" },
    { k: "total",         t: "Total",          tipo: "n" },
    { k: "inventariados", t: "Inventariados",  tipo: "n" },
    { k: "pendentes",     t: "Pendentes",      tipo: "n" },
    { k: "divergentes",   t: "Divergentes",    tipo: "n" },
    { k: "naoLoc",        t: "Não localizados",tipo: "n" },
    { k: "perc",          t: "% atualizado",   tipo: "n" },
    { k: "ultimo",        t: "Último inventário", tipo: "data" }
  ];
  const ordem = { campo: "total", dir: "desc" };

  function ordenar() {
    const { campo, dir } = ordem;
    const s = dir === "asc" ? 1 : -1;
    linhas.sort((a, b) => {
      const va = a[campo], vb = b[campo];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * s;
      const na = va?.toDate ? va.toDate().getTime() : (va instanceof Date ? va.getTime() : Number(new Date(va)) || va);
      const nb = vb?.toDate ? vb.toDate().getTime() : (vb instanceof Date ? vb.getTime() : Number(new Date(vb)) || vb);
      return (na - nb) * s;
    });
  }

  function corPerc(v) {
    if (v === null) return "";
    return v >= 85 ? "st st-verde" : v >= 60 ? "st st-amarelo" : v >= 30 ? "st st-laranja" : "st st-vermelho";
  }

  function pintar() {
    ordenar();
    corpo.innerHTML = `
      <div class="tab-wrap responsiva" style="border:0;box-shadow:none;border-radius:0">
        <table class="tab"><thead><tr>
          ${COLS.map(c => `<th data-ord="${c.k}" style="cursor:pointer">${esc(c.t)}
            ${ordem.campo === c.k ? (ordem.dir === "asc" ? "▲" : "▼") : ""}</th>`).join("")}
        </tr></thead><tbody>
          ${linhas.map(l => `<tr class="click" data-id="${esc(l.id)}">
            <td><b>${esc(l.nome)}</b></td>
            <td class="num">${vNum(l.total)}</td>
            <td class="num">${vNum(l.inventariados)}</td>
            <td class="num">${vNum(l.pendentes)}</td>
            <td class="num">${vNum(l.divergentes)}</td>
            <td class="num">${vNum(l.naoLoc)}</td>
            <td class="num">${l.perc === null ? "—" : `<span class="${corPerc(l.perc)}">${l.perc}%</span>`}</td>
            <td>${l.ultimo ? esc(dataBR(l.ultimo)) : "—"}</td>
          </tr>`).join("")}
        </tbody></table>
      </div>

      <div class="lista-cards" style="padding:12px">
        ${linhas.map(l => `<div class="item-card" data-id="${esc(l.id)}">
          <div class="l1"><b>${esc(l.nome)}</b>
            ${l.perc === null ? "" : `<span class="${corPerc(l.perc)}">${l.perc}%</span>`}</div>
          <div class="l2">${vNum(l.total)} ativos · ${vNum(l.inventariados)} inventariados</div>
          <div class="l3">Divergentes: ${vNum(l.divergentes)} · Não localizados: ${vNum(l.naoLoc)}
            · Último: ${l.ultimo ? esc(dataBR(l.ultimo)) : "—"}</div>
        </div>`).join("")}
      </div>

      <div class="paginacao">
        <span style="margin-right:auto">Prazo considerado: ${num(dias)} dias · ${num(linhas.length)} registro(s)</span>
        <button class="btn sm" id="ag-csv">${ico("down", 14)}Exportar CSV</button>
      </div>
      ${avisoFalhas()}`;

    corpo.querySelectorAll("[data-ord]").forEach(th => th.onclick = () => {
      const k = th.dataset.ord;
      if (ordem.campo === k) ordem.dir = ordem.dir === "asc" ? "desc" : "asc";
      else { ordem.campo = k; ordem.dir = k === "nome" ? "asc" : "desc"; }
      pintar();
    });
    corpo.querySelectorAll("[data-id]").forEach(el => el.onclick = () => {
      location.hash = `#/ativos?${cfg.campo}=${el.dataset.id}`;
    });
    corpo.querySelector("#ag-csv").onclick = () => {
      baixarCSV(cfg.nomeArquivo, COLS.map(c => c.t), linhas.map(l => [
        l.nome, l.total, l.inventariados, l.pendentes, l.divergentes, l.naoLoc,
        l.perc === null ? "—" : l.perc + "%", l.ultimo ? dataBR(l.ultimo) : "—"
      ]));
      toast(`${linhas.length} linha(s) exportada(s).`, "ok");
    };
  }

  pintar();
}
