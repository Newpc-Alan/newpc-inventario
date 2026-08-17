/* NEWPC INVENTÁRIO — Tela inicial
 * Item 50: home do técnico — mobile-first, botões grandes, zero jargão.
 * Item 51: home de administrador/diretoria/analista — KPIs, alertas e blocos de gestão.
 *
 * Nenhum número desta tela é estimado: tudo vem de contar()/buscar().
 */
import { sessao, ehTecnico } from "../auth.js";
import { irPara } from "../router.js";
import { buscar, rotuloDeId, parametros } from "../store.js";
import { ico, esc, num, pct, dataBR, badge, barraProgresso, carregando } from "../ui.js";
import { abrirScanner } from "./scanner.js";
import {
  kpisGerais, blocoKPIs, carregarAlertas, contarSeguro, buscarSeguro, avisoDeErro
} from "./dashboard.js";
import * as C from "../config.js";

/* ============================================================
 * Helpers de apresentação
 * ============================================================ */

/** "há 2 horas", "ontem", "há 3 meses" — sempre em português. */
export function tempoRelativo(valor) {
  if (!valor) return "—";
  const d = valor?.toDate ? valor.toDate() : new Date(valor);
  if (isNaN(d)) return "—";
  const seg = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seg < 0) return dataBR(d, true);
  if (seg < 45) return "agora há pouco";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} minuto${min > 1 ? "s" : ""}`;
  const hor = Math.floor(min / 60);
  if (hor < 24) return `há ${hor} hora${hor > 1 ? "s" : ""}`;
  const dias = Math.floor(hor / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  if (dias < 30) { const s = Math.floor(dias / 7); return `há ${s} semana${s > 1 ? "s" : ""}`; }
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses > 1 ? "meses" : "mês"}`;
  const anos = Math.floor(meses / 12);
  return `há ${anos} ano${anos > 1 ? "s" : ""}`;
}

const primeiroNome = n => String(n || "").trim().split(/\s+/)[0] || "colega";

function dataPorExtenso(d = new Date()) {
  const t = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function saudacaoHTML() {
  const nome = primeiroNome(sessao.usuario?.nome);
  const h = new Date().getHours();
  const cumprimento = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  return `<h2 class="saudacao">${cumprimento}, ${esc(nome)}</h2>
    <p>${esc(dataPorExtenso())}</p>`;
}

/* ============================================================
 * Rota
 * ============================================================ */
export async function home(alvo, ctx) {
  if (ehTecnico()) return homeTecnico(alvo);
  return homeGestao(alvo);
}

/* ============================================================
 * HOME DO TÉCNICO (item 50)
 * ============================================================ */
async function homeTecnico(alvo) {
  const uid = sessao.usuario?.id;

  alvo.innerHTML = `
    ${saudacaoHTML()}
    <div class="grade-campo" id="tc-acoes">
      <button class="btn-campo verde full" data-acao="inventario">
        ${ico("scan", 30)}INICIAR INVENTÁRIO</button>
      <button class="btn-campo azul" data-acao="escanear">
        ${ico("scan", 26)}ESCANEAR EQUIPAMENTO</button>
      <button class="btn-campo" data-acao="consultar">
        ${ico("cpu", 26)}CONSULTAR ATIVO</button>
      <button class="btn-campo" data-acao="transferencia">
        ${ico("arrows", 26)}TRANSFERÊNCIA</button>
      <button class="btn-campo" data-acao="recolhimento">
        ${ico("box", 26)}RECOLHIMENTO</button>
      <button class="btn-campo amarelo full" data-acao="pendencias">
        ${ico("alert", 26)}MINHAS PENDÊNCIAS
        <span style="font-size:12.5px;font-weight:600" id="tc-pend">carregando…</span></button>
    </div>

    <div style="margin-top:20px" id="tc-inventarios">${carregando("Buscando seus inventários…")}</div>
    <div style="margin-top:16px" id="tc-atividades"></div>`;

  alvo.querySelector("#tc-acoes").addEventListener("click", async e => {
    const b = e.target.closest("[data-acao]");
    if (!b) return;
    switch (b.dataset.acao) {
      case "inventario":    return irPara("inventario", "novo");
      case "consultar":     return irPara("ativos");
      case "transferencia": return irPara("movimentacoes", "nova");
      case "recolhimento":  return irPara("recolhimentos", "novo");
      case "pendencias":    return irPara("pendencias");
      case "escanear":
        return abrirScanner({
          titulo: "Escanear equipamento",
          textoAjuda: "Aponte para a etiqueta do equipamento ou digite o patrimônio.",
          aoLer: codigo => irPara("ativos", "qr:" + codigo)
        });
    }
  });

  /* --- contagem real de pendências abertas criadas por este técnico --- */
  contarSeguro("pendencias", [["criado_por", "==", uid], ["status", "in", ["ABERTA", "EM_ANALISE"]]],
    "pendências do técnico").then(n => {
      const el = alvo.querySelector("#tc-pend");
      if (!el) return;
      el.textContent = n === null ? "toque para ver"
        : n === 0 ? "nada pendente por aqui" : `${num(n)} em aberto`;
    });

  await Promise.all([
    inventariosEmAndamento(alvo.querySelector("#tc-inventarios"), uid),
    ultimasAtividades(alvo.querySelector("#tc-atividades"), uid)
  ]);
}

/* Inventários do próprio técnico, em andamento ou pausados. */
async function inventariosEmAndamento(box, uid) {
  let inventarios;
  try {
    const r = await buscar("inventarios",
      [["status", "in", ["EM_ANDAMENTO", "PAUSADO"]], ["responsavel_id", "==", uid]],
      ["iniciado_em", "desc"], 5);
    inventarios = r.dados;
  } catch (e) {
    box.innerHTML = avisoDeErro(e, "listar os inventários em andamento");
    return;
  }

  if (!inventarios.length) {
    box.innerHTML = `<div class="card"><div class="card-tit">${ico("scan", 17)}
        <h3>Inventários em andamento</h3></div>
      <div class="vazio" style="padding:30px 18px">${ico("check", 40)}
        <b>Nenhum inventário em aberto</b>
        <p>Quando você iniciar um inventário, ele aparece aqui para continuar de onde parou.</p>
        <button class="btn v" id="tc-iniciar">${ico("scan", 15)}Iniciar inventário</button></div></div>`;
    box.querySelector("#tc-iniciar").onclick = () => irPara("inventario", "novo");
    return;
  }

  const comProgresso = await Promise.all(inventarios.map(async inv => ({
    inv, ...(await progressoInventario(inv))
  })));

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("scan", 17)}<h3>Inventários em andamento</h3>
      <div class="dir"><button class="btn sm" data-ir="#/inventario">Ver todos</button></div></div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:10px">
      ${comProgresso.map(({ inv, conferidos, total, percentual }) => `
        <div class="item-card" data-inv="${esc(inv.id)}" style="box-shadow:none">
          <div class="l1"><b class="mono">${esc(inv.codigo || "Inventário")}</b>
            ${badge(C.STATUS_INVENTARIO, inv.status)}</div>
          <div class="l2">${esc(rotuloDeId("unidades", inv.unidade_id))}</div>
          <div style="margin-top:8px">${barraProgresso(percentual === null ? 0 : percentual)}</div>
          <div class="l3">${percentual === null
            ? "Progresso indisponível"
            : `${num(conferidos)} de ${num(total)} conferidos · ${percentual}%`}
            ${inv.iniciado_em ? ` · iniciado ${esc(tempoRelativo(inv.iniciado_em))}` : ""}</div>
        </div>`).join("")}
    </div></div>`;

  box.querySelectorAll("[data-inv]").forEach(el =>
    el.onclick = () => irPara("inventario", el.dataset.inv));
}

/**
 * Progresso real de um inventário.
 * Preferimos os totais já consolidados no documento (gravados pelo fluxo de
 * inventário). Se não existirem, contamos no servidor — nunca estimamos.
 */
async function progressoInventario(inv) {
  /* nomes gravados por inventario.js: total_encontrado / total_esperado */
  const conferidos = Number.isFinite(inv.total_encontrado)
    ? inv.total_encontrado
    : await contarSeguro("inventario_itens", [["inventario_id", "==", inv.id]], "itens conferidos do inventário");

  let total = Number.isFinite(inv.total_esperado) ? inv.total_esperado : null;
  if (total === null && inv.unidade_id) {
    total = await contarSeguro("ativos", [["unidade_id", "==", inv.unidade_id]], "ativos previstos na unidade");
  }
  const percentual = (conferidos === null || !total) ? null : Math.min(100, pct(conferidos, total));
  return { conferidos, total, percentual };
}

/* Últimas conferências feitas por este técnico. */
async function ultimasAtividades(box, uid) {
  let itens;
  try {
    const r = await buscar("inventario_itens", [["tecnico_id", "==", uid]], ["data_hora", "desc"], 8);
    itens = r.dados;
  } catch (e) {
    box.innerHTML = avisoDeErro(e, "listar suas últimas atividades");
    return;
  }

  if (!itens.length) {
    box.innerHTML = `<div class="card"><div class="card-tit">${ico("hist", 17)}<h3>Últimas atividades</h3></div>
      <div class="vazio" style="padding:30px 18px">${ico("clock", 40)}
        <b>Nada registrado ainda</b>
        <p>Assim que você conferir o primeiro equipamento, o histórico aparece aqui.</p></div></div>`;
    return;
  }

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("hist", 17)}<h3>Últimas atividades</h3>
      <div class="dir"><button class="btn sm" data-ir="#/inventario">Ver inventários</button></div></div>
    <div class="card-pad" style="padding-top:2px;padding-bottom:6px">
      ${itens.map(i => `
        <div class="dado" ${i.ativo_id ? `data-ir="#/ativos/${esc(i.ativo_id)}" style="cursor:pointer"` : ""}>
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            <span class="mono" style="flex:1;min-width:120px">${esc(i.ativo_patrimonio || "—")}</span>
            ${badge(C.RESULTADO_ITEM, i.resultado)}
            <span style="font-size:11.8px;color:var(--texto-2)">${esc(tempoRelativo(i.data_hora))}</span>
          </div></div>`).join("")}
    </div></div>`;
}

/* ============================================================
 * HOME DE GESTÃO — ADMINISTRADOR / DIRETORIA / ANALISTA (item 51)
 * ============================================================ */
async function homeGestao(alvo) {
  alvo.innerHTML = `
    ${saudacaoHTML()}
    <div id="hg-kpis">${skelKPIs()}</div>
    <div class="grade g2" style="margin-top:16px;align-items:start">
      <div id="hg-alertas">${skelCard("Alertas")}</div>
      <div id="hg-divergencias">${skelCard("Divergências e não localizados")}</div>
    </div>
    <div style="margin-top:16px" id="hg-inventarios">${skelCard("Inventários recentes")}</div>
    <div class="grade g2" style="margin-top:16px;align-items:start">
      <div id="hg-contratos">${skelCard("Contratos vencendo")}</div>
      <div id="hg-movimentacoes">${skelCard("Movimentações recentes")}</div>
    </div>`;

  /* Cada bloco carrega de forma independente: a tela nunca fica travada num só. */
  await Promise.all([
    blocoKpisHome(alvo.querySelector("#hg-kpis")),
    blocoAlertas(alvo.querySelector("#hg-alertas")),
    blocoDivergencias(alvo.querySelector("#hg-divergencias")),
    blocoInventariosRecentes(alvo.querySelector("#hg-inventarios")),
    blocoContratosVencendo(alvo.querySelector("#hg-contratos")),
    blocoMovimentacoes(alvo.querySelector("#hg-movimentacoes"))
  ]);
}

function skelKPIs(n = 10) {
  return `<div class="grade g5">${Array.from({ length: n }, () => `
    <div class="kpi"><span class="faixa"></span>
      <div class="skel" style="width:62%"></div>
      <div class="skel" style="width:42%;height:24px;margin-top:9px"></div></div>`).join("")}</div>`;
}
function skelCard(titulo) {
  return `<div class="card"><div class="card-tit"><h3>${esc(titulo)}</h3></div>
    <div class="card-pad">${Array.from({ length: 4 }, () =>
      `<div class="skel" style="margin-bottom:10px"></div>`).join("")}</div></div>`;
}

/* ---- KPIs principais (reaproveitados do dashboard) ---- */
async function blocoKpisHome(box) {
  try {
    const dados = await kpisGerais(30);
    box.innerHTML = blocoKPIs(dados) +
      `<div style="display:flex;justify-content:flex-end;margin-top:9px">
        <button class="btn sm" data-ir="#/dashboard">${ico("chart", 14)}Abrir dashboard completo</button></div>`;
  } catch (e) {
    box.innerHTML = avisoDeErro(e, "os indicadores gerais");
  }
}

/* ---- Alertas ---- */
async function blocoAlertas(box) {
  let alertas;
  try { alertas = await carregarAlertas(); }
  catch (e) { box.innerHTML = avisoDeErro(e, "os alertas"); return; }

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("bell", 17)}<h3>Alertas</h3>
      <div class="dir"><button class="btn sm" data-ir="#/pendencias">Ver todos</button></div></div>
    <div class="card-pad" style="display:flex;flex-direction:column;gap:9px">
      ${alertas.length
        ? alertas.map(a => `<div class="aviso ${a.nivel}" data-ir="${esc(a.href)}" style="cursor:pointer">
            ${ico(a.nivel === "err" ? "alert" : a.nivel === "warn" ? "alert" : "bell", 17)}
            <div><b>${esc(a.titulo)}</b>${esc(a.texto)}</div></div>`).join("")
        : `<div class="aviso ok">${ico("check", 17)}<div>Nenhum alerta no momento.</div></div>`}
    </div></div>`;
}

/* ---- Divergências e não localizados ---- */
async function blocoDivergencias(box) {
  const [divergencias, naoLocalizados, defeitos, cadastros] = await Promise.all([
    contarSeguro("pendencias", [["tipo", "==", "DIVERGENCIA_LOCAL"], ["status", "==", "ABERTA"]], "divergências abertas"),
    contarSeguro("ativos", [["status", "==", "NAO_LOCALIZADO"]], "ativos não localizados"),
    contarSeguro("pendencias", [["tipo", "==", "DEFEITO"], ["status", "==", "ABERTA"]], "defeitos abertos"),
    contarSeguro("pendencias", [["tipo", "==", "CADASTRO_PENDENTE"], ["status", "==", "ABERTA"]], "cadastros pendentes")
  ]);
  const v = n => (n === null ? "—" : num(n));

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("alert", 17)}<h3>Divergências e não localizados</h3>
      <div class="dir"><button class="btn sm" data-ir="#/pendencias">Ver todas</button></div></div>
    <div class="card-pad" style="padding-top:2px;padding-bottom:8px">
      ${linhaNumero("Divergências de localização", v(divergencias), "#/pendencias?tipo=DIVERGENCIA_LOCAL&status=ABERTA", "laranja")}
      ${linhaNumero("Equipamentos não localizados", v(naoLocalizados), "#/ativos?status=NAO_LOCALIZADO", "vermelho")}
      ${linhaNumero("Defeitos registrados", v(defeitos), "#/pendencias?tipo=DEFEITO&status=ABERTA", "laranja")}
      ${linhaNumero("Cadastros aguardando validação", v(cadastros), "#/pendencias?tipo=CADASTRO_PENDENTE&status=ABERTA", "amarelo")}
    </div></div>`;
}

function linhaNumero(rot, valor, href, cor = "") {
  const cores = { verde: "var(--verde)", vermelho: "var(--vermelho)", laranja: "var(--laranja)", amarelo: "#9a7100" };
  return `<div class="dado" data-ir="${esc(href)}" style="cursor:pointer">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="flex:1;font-size:13.3px">${esc(rot)}</span>
      <b style="font-size:16px;font-variant-numeric:tabular-nums;color:${cores[cor] || "var(--marinho)"}">${valor}</b>
      ${ico("arrows", 13)}</div></div>`;
}

/* ---- Inventários recentes ---- */
async function blocoInventariosRecentes(box) {
  let inventarios;
  try {
    const r = await buscar("inventarios", [], ["iniciado_em", "desc"], 5);
    inventarios = r.dados;
  } catch (e) { box.innerHTML = avisoDeErro(e, "os inventários recentes"); return; }

  if (!inventarios.length) {
    box.innerHTML = `<div class="card"><div class="card-tit">${ico("scan", 17)}<h3>Inventários recentes</h3></div>
      <div class="vazio" style="padding:30px 18px">${ico("scan", 40)}<b>Nenhum inventário registrado</b>
        <p>Os inventários realizados em campo aparecerão aqui assim que forem iniciados.</p></div></div>`;
    return;
  }

  const linhas = await Promise.all(inventarios.map(async inv => ({ inv, ...(await progressoInventario(inv)) })));

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("scan", 17)}<h3>Inventários recentes</h3>
      <div class="dir"><button class="btn sm" data-ir="#/inventario">Ver todos</button></div></div>
    <div class="tab-wrap responsiva" style="border:0;box-shadow:none;border-radius:0">
      <table class="tab"><thead><tr>
        <th>Código</th><th>Unidade</th><th>Responsável</th><th style="min-width:150px">Progresso</th><th>Status</th>
      </tr></thead><tbody>
        ${linhas.map(({ inv, conferidos, total, percentual }) => `
          <tr class="click" data-inv="${esc(inv.id)}">
            <td class="mono">${esc(inv.codigo || "—")}</td>
            <td>${esc(rotuloDeId("unidades", inv.unidade_id))}</td>
            <td>${esc(rotuloDeId("usuarios", inv.responsavel_id))}</td>
            <td>${percentual === null ? "—" : `${barraProgresso(percentual)}
              <span style="font-size:11.5px;color:var(--texto-2)">${num(conferidos)} de ${num(total)}</span>`}</td>
            <td>${badge(C.STATUS_INVENTARIO, inv.status)}</td>
          </tr>`).join("")}
      </tbody></table></div>

    <div class="lista-cards" style="padding:12px">
      ${linhas.map(({ inv, conferidos, total, percentual }) => `
        <div class="item-card" data-inv="${esc(inv.id)}">
          <div class="l1"><b class="mono">${esc(inv.codigo || "—")}</b>${badge(C.STATUS_INVENTARIO, inv.status)}</div>
          <div class="l2">${esc(rotuloDeId("unidades", inv.unidade_id))}</div>
          <div class="l3">${esc(rotuloDeId("usuarios", inv.responsavel_id))}
            ${percentual === null ? "" : ` · ${num(conferidos)} de ${num(total)} (${percentual}%)`}</div>
        </div>`).join("")}
    </div></div>`;

  box.querySelectorAll("[data-inv]").forEach(el => el.onclick = () => irPara("inventario", el.dataset.inv));
}

/* ---- Contratos vencendo ---- */
async function blocoContratosVencendo(box) {
  const p = await parametros();
  const hoje = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + p.diasAlertaContrato * 86400000).toISOString().slice(0, 10);
  const faixa = [["data_fim", ">=", hoje], ["data_fim", "<=", limite]];

  const [cliente, fornecedor] = await Promise.all([
    buscarSeguro("contratos_cliente", faixa, ["data_fim", "asc"], 6, "contratos de cliente vencendo"),
    buscarSeguro("contratos_fornecedor", faixa, ["data_fim", "asc"], 6, "locações vencendo")
  ]);

  const itens = [
    ...cliente.map(c => ({
      tipo: "Cliente", rota: "contratos", d: c,
      titulo: c.numero_contrato || "Contrato",
      sub: rotuloDeId("clientes", c.cliente_id),
      status: badge(C.STATUS_CONTRATO_CLIENTE, c.status)
    })),
    ...fornecedor.map(c => ({
      tipo: "Locação", rota: "locacoes", d: c,
      titulo: c.codigo_interno || c.numero_contrato || "Operação",
      sub: rotuloDeId("fornecedores", c.fornecedor_id),
      status: badge(C.STATUS_CONTRATO_FORNECEDOR, c.status)
    }))
  ].sort((a, b) => String(a.d.data_fim).localeCompare(String(b.d.data_fim))).slice(0, 8);

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("file", 17)}<h3>Contratos vencendo</h3>
      <div class="dir"><button class="btn sm" data-ir="#/contratos">Ver todos</button></div></div>
    ${itens.length ? `<div class="card-pad" style="padding-top:2px;padding-bottom:8px">
      ${itens.map(i => `<div class="dado" data-ir="#/${i.rota}/${esc(i.d.id)}" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <div style="flex:1;min-width:150px">
            <b style="font-size:13.5px">${esc(i.titulo)}</b>
            <div style="font-size:12px;color:var(--texto-2)">${esc(i.tipo)} · ${esc(i.sub)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12.8px;font-weight:600">${esc(dataBR(i.d.data_fim))}</div>
            <div style="font-size:11.5px;color:var(--texto-2)">${esc(diasAte(i.d.data_fim))}</div>
          </div>
          ${i.status}
        </div></div>`).join("")}
      </div>`
    : `<div class="vazio" style="padding:30px 18px">${ico("check", 40)}
        <b>Nenhum contrato vencendo</b>
        <p>Nada com data de término nos próximos ${num(p.diasAlertaContrato)} dias.</p></div>`}
  </div>`;
}

function diasAte(dataFim) {
  const d = new Date(String(dataFim).slice(0, 10) + "T12:00:00");
  if (isNaN(d)) return "";
  const dias = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (dias <= 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `em ${dias} dias`;
}

/* ---- Movimentações recentes ---- */
async function blocoMovimentacoes(box) {
  let movs;
  try {
    const r = await buscar("movimentacoes", [], ["data", "desc"], 5);
    movs = r.dados;
  } catch (e) { box.innerHTML = avisoDeErro(e, "as movimentações recentes"); return; }

  box.innerHTML = `<div class="card">
    <div class="card-tit">${ico("arrows", 17)}<h3>Movimentações recentes</h3>
      <div class="dir"><button class="btn sm" data-ir="#/movimentacoes">Ver todas</button></div></div>
    ${movs.length ? `<div class="card-pad" style="padding-top:2px;padding-bottom:8px">
      ${movs.map(m => `<div class="dado" data-ir="#/movimentacoes/${esc(m.id)}" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <div style="flex:1;min-width:150px">
            <b style="font-size:13.5px">${esc(C.labelDe(C.TIPO_MOVIMENTACAO, m.tipo))}</b>
            <div style="font-size:12px;color:var(--texto-2)">
              ${esc(m.codigo || "")}${m.codigo ? " · " : ""}${esc(m.destino_texto || rotuloDeId("unidades", m.unidade_destino))}</div>
          </div>
          ${badge(C.STATUS_MOVIMENTACAO, m.status)}
          <span style="font-size:11.5px;color:var(--texto-2)">${esc(tempoRelativo(m.data))}</span>
        </div></div>`).join("")}
      </div>`
    : `<div class="vazio" style="padding:30px 18px">${ico("arrows", 40)}
        <b>Nenhuma movimentação registrada</b>
        <p>Transferências, implantações e recolhimentos aparecem aqui.</p></div>`}
  </div>`;
}
