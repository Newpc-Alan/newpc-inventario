/* NEWPC INVENTÁRIO — Movimentações e Recolhimentos
 * Rotas expostas: movimentacoes(alvo, ctx) e recolhimentos(alvo, ctx).
 *
 * Regras de negócio implementadas aqui:
 *  - Equipamento BAIXADO não pode ser movimentado (STATUS_BLOQUEIA_MOVIMENTACAO).
 *  - Quem não tem "movimentacao.aprovar" gera movimentação PENDENTE + pendência de aprovação.
 *  - Recolhimento finalizado em "Devolução ao fornecedor" ou "Baixa" LIMPA a alocação em cliente,
 *    para o equipamento não continuar aparecendo como instalado (regra 5).
 *  - Nenhum número é inventado: tudo vem de contar()/buscar().
 */
import {
  buscar, contar, obter, criar, atualizar, listaRef, rotuloDeId, descreverLocal,
  proximoCodigo, registrarHistorico, parametros, serverTimestamp
} from "../store.js";
import {
  ico, esc, toast, modal, confirmar, badge, badgeStatusAtivo, cabecalhoPagina,
  vazio, carregando, baixarCSV, dataBR, diasDesde
} from "../ui.js";
import { pode, sessao } from "../auth.js";
import { abrirScanner, acharAtivoPorCodigo } from "./scanner.js";
import * as C from "../config.js";

const eu = () => sessao.usuario || {};
const dtIni = v => (v ? new Date(v + "T00:00:00") : null);
const dtFim = v => (v ? new Date(v + "T23:59:59") : null);

/* Mensagem amigável quando falta índice composto no Firestore. */
function avisoConsulta(e) {
  console.error(e);
  return `<div class="aviso err"><div><b>Não foi possível carregar a consulta</b>
    ${/index/i.test(e.message || "") ?
      "Falta um índice composto no Firestore. Abra o console do navegador e clique no link gerado pelo Firebase para criá-lo."
      : esc(e.message || "Erro inesperado.")}</div></div>`;
}

/* ============================================================
 *  SELECTS ENCADEADOS DE LOCALIZAÇÃO (cliente > unidade > setor > local)
 *  Reutilizado pela transferência e pela central de pendências.
 * ============================================================ */
export async function montarSelectsLocal(el, opcoes = {}) {
  const [clientes, unidades, setores, locais] = await Promise.all([
    listaRef("clientes"), listaRef("unidades"), listaRef("setores"), listaRef("locais")
  ]);
  const ativos = lista => lista.filter(x => x.ativo !== false);

  el.innerHTML = `<div class="form-grade">
    <div class="campo"><label>Cliente <span class="req">*</span></label>
      <select class="inp" data-l="cliente"></select></div>
    <div class="campo"><label>Unidade <span class="req">*</span></label>
      <select class="inp" data-l="unidade" disabled></select></div>
    <div class="campo"><label>Setor</label>
      <select class="inp" data-l="setor" disabled></select></div>
    <div class="campo"><label>Local / Sala</label>
      <select class="inp" data-l="local" disabled></select></div>
  </div>`;

  const sel = n => el.querySelector(`[data-l="${n}"]`);
  const preencher = (s, itens, vazioTxt, rot) => {
    s.innerHTML = `<option value="">${esc(vazioTxt)}</option>` +
      itens.map(i => `<option value="${esc(i.id)}">${esc(rot(i))}</option>`).join("");
    s.disabled = !itens.length;
  };

  preencher(sel("cliente"), ativos(clientes), "— selecione o cliente —",
    c => c.nome_fantasia || c.razao_social || c.id);

  sel("cliente").onchange = () => {
    const cid = sel("cliente").value;
    preencher(sel("unidade"), ativos(unidades).filter(u => u.cliente_id === cid),
      cid ? "— selecione a unidade —" : "Escolha o cliente primeiro", u => u.nome);
    sel("unidade").onchange();
    mudou();
  };
  sel("unidade").onchange = () => {
    const uid = sel("unidade").value;
    preencher(sel("setor"), setores.filter(s => s.unidade_id === uid),
      uid ? "— sem setor definido —" : "Escolha a unidade primeiro", s => s.nome);
    sel("setor").onchange();
    mudou();
  };
  sel("setor").onchange = () => {
    const sid = sel("setor").value;
    preencher(sel("local"), locais.filter(l => l.setor_id === sid),
      sid ? "— sem local definido —" : "Escolha o setor primeiro", l => l.nome);
    mudou();
  };
  sel("local").onchange = () => mudou();

  function mudou() { opcoes.aoMudar && opcoes.aoMudar(api.valores()); }

  sel("cliente").onchange();   // estado inicial dos selects dependentes

  const api = {
    valores() {
      const uid = sel("unidade").value || null;
      const un = unidades.find(u => u.id === uid);
      return {
        cliente_id: sel("cliente").value || null,
        unidade_id: uid,
        setor_id: sel("setor").value || null,
        local_id: sel("local").value || null,
        municipio_id: un?.municipio_id || null
      };
    },
    completo() { const v = api.valores(); return !!(v.cliente_id && v.unidade_id); },
    texto() { return descreverLocal(api.valores()); }
  };
  return api;
}

/* ============================================================
 *  APROVAR / REJEITAR MOVIMENTAÇÃO (usado aqui e em pendências)
 * ============================================================ */
export async function aprovarMovimentacao(mov) {
  const ativo = await obter("ativos", mov.ativo_id);
  if (!ativo) throw new Error("O equipamento desta movimentação não foi encontrado.");
  if (C.STATUS_BLOQUEIA_MOVIMENTACAO.includes(ativo.status))
    throw new Error("Equipamento baixado não pode ser movimentado sem reativação autorizada.");

  /* aplica o destino no ativo — o store grava o histórico de localização sozinho */
  await atualizar("ativos", mov.ativo_id, {
    cliente_id: mov.cliente_destino || null,
    unidade_id: mov.unidade_destino || null,
    setor_id: mov.setor_destino || null,
    local_id: mov.local_destino || null,
    municipio_id: mov.municipio_destino || null
  });

  await atualizar("movimentacoes", mov.id, {
    status: "EFETIVADA",
    aprovado_por: eu().id || null,
    aprovado_por_nome: eu().nome || null,
    aprovado_em: serverTimestamp()
  });

  await registrarHistorico(mov.ativo_id, "MOVIMENTACAO", "Transferência aprovada",
    `${mov.origem_texto || "Sem localização"} → ${mov.destino_texto || "—"}`,
    { movimentacao_id: mov.id, movimentacao_codigo: mov.codigo || null });

  await encerrarPendenciasDaMovimentacao(mov, "RESOLVIDA",
    `Transferência ${mov.codigo || ""} aprovada por ${eu().nome || "usuário"}.`);
}

export async function rejeitarMovimentacao(mov, motivo) {
  await atualizar("movimentacoes", mov.id, {
    status: "REJEITADA",
    motivo_rejeicao: motivo,
    rejeitado_por: eu().id || null,
    rejeitado_por_nome: eu().nome || null,
    rejeitado_em: serverTimestamp()
  });
  /* nada é alterado no ativo — apenas registramos a decisão */
  if (mov.ativo_id) {
    await registrarHistorico(mov.ativo_id, "MOVIMENTACAO", "Transferência rejeitada", motivo,
      { movimentacao_id: mov.id, movimentacao_codigo: mov.codigo || null });
  }
  await encerrarPendenciasDaMovimentacao(mov, "DESCARTADA", `Transferência rejeitada: ${motivo}`);
}

async function encerrarPendenciasDaMovimentacao(mov, status, texto) {
  const { dados } = await buscar("pendencias", [["movimentacao_id", "==", mov.id]], null, 10);
  for (const p of dados) {
    if (["RESOLVIDA", "DESCARTADA"].includes(p.status)) continue;
    await atualizar("pendencias", p.id, {
      status,
      resolucao_texto: texto,
      resolvido_por: eu().id || null,
      resolvido_por_nome: eu().nome || null,
      resolvido_em: serverTimestamp()
    });
  }
}

function pedirMotivoRejeicao(mov, aoFim) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `<div class="aviso warn"><div>O equipamento <b>não</b> será alterado.
    Explique o motivo para quem solicitou entender a decisão.</div></div>
    <div class="campo" style="margin-top:13px"><label>Motivo da rejeição <span class="req">*</span></label>
      <textarea class="inp" id="rj-motivo" placeholder="Ex.: destino incorreto, equipamento já remanejado…"></textarea></div>`;
  modal({
    titulo: "Rejeitar transferência", tamanho: "p", corpo,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Rejeitar", classe: "d", icone: "x", aoClicar: async () => {
        const m = corpo.querySelector("#rj-motivo").value.trim();
        if (m.length < 5) { toast("Descreva o motivo da rejeição.", "warn"); return false; }
        await rejeitarMovimentacao(mov, m);
        toast("Transferência rejeitada.", "ok");
        aoFim && aoFim();
      }}
    ]
  });
}

/* ============================================================
 *  ROTA: MOVIMENTAÇÕES
 * ============================================================ */
export async function movimentacoes(alvo, ctx = {}) {
  const recarregar = await listagemMovimentacoes(alvo);

  if (ctx.id === "nova") {
    fluxoNovaTransferencia({
      aoFechar: () => {
        if ((location.hash || "").includes("/nova")) location.hash = "#/movimentacoes";
        else recarregar();
      }
    });
  }
}

async function listagemMovimentacoes(alvo) {
  const p = await parametros();
  const tam = p.paginaTamanho || 25;
  const podeAprovar = pode("movimentacao.aprovar");
  const clientes = (await listaRef("clientes")).filter(c => c.ativo !== false);
  const estado = { pagina: 0, cursores: [null], tipo: "", status: "", cliente: "", de: "", ate: "" };

  alvo.innerHTML = cabecalhoPagina("Movimentações",
    "Todo remanejamento de equipamento fica registrado aqui, com origem, destino e responsável.",
    `<button class="btn" id="mv-exp">${ico("down", 15)}Exportar</button>
     ${pode("movimentacao.criar") ? `<button class="btn p" id="mv-nova">${ico("plus", 15)}Nova transferência</button>` : ""}`)
    + `<div class="filtros">
        <div class="linha">
          <select class="inp" data-f="tipo"><option value="">Tipo: todos</option>
            ${C.TIPO_MOVIMENTACAO.map(t => `<option value="${t.v}">${esc(t.label)}</option>`).join("")}</select>
          <select class="inp" data-f="status"><option value="">Situação: todas</option>
            ${C.STATUS_MOVIMENTACAO.map(t => `<option value="${t.v}">${esc(t.label)}</option>`).join("")}</select>
          <select class="inp" data-f="cliente"><option value="">Cliente de destino: todos</option>
            ${clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome_fantasia || c.razao_social)}</option>`).join("")}</select>
          <input class="inp" type="date" data-f="de" title="Data inicial">
          <input class="inp" type="date" data-f="ate" title="Data final">
        </div>
        <div class="pe"><span class="cont" id="mv-cont"></span>
          <button class="btn sm" id="mv-limpar">Limpar filtros</button></div>
      </div>
      <div id="mv-corpo">${carregando()}</div>`;

  alvo.querySelectorAll("[data-f]").forEach(el => el.onchange = () => {
    estado[el.dataset.f] = el.value || "";
    estado.pagina = 0; estado.cursores = [null];
    carregar();
  });
  alvo.querySelector("#mv-limpar").onclick = () => {
    Object.assign(estado, { pagina: 0, cursores: [null], tipo: "", status: "", cliente: "", de: "", ate: "" });
    alvo.querySelectorAll("[data-f]").forEach(el => el.value = "");
    carregar();
  };
  alvo.querySelector("#mv-nova")?.addEventListener("click", () =>
    fluxoNovaTransferencia({ aoFechar: () => carregar() }));
  alvo.querySelector("#mv-exp").onclick = exportar;

  function filtros() {
    const f = [];
    if (estado.tipo) f.push(["tipo", "==", estado.tipo]);
    if (estado.status) f.push(["status", "==", estado.status]);
    if (estado.cliente) f.push(["cliente_destino", "==", estado.cliente]);
    if (estado.de) f.push(["data", ">=", dtIni(estado.de)]);
    if (estado.ate) f.push(["data", "<=", dtFim(estado.ate)]);
    return f;
  }

  async function carregar() {
    const corpo = alvo.querySelector("#mv-corpo");
    corpo.innerHTML = carregando();
    const f = filtros();
    let res;
    try { res = await buscar("movimentacoes", f, ["data", "desc"], tam, estado.cursores[estado.pagina]); }
    catch (e) { corpo.innerHTML = avisoConsulta(e); return; }
    const { dados, ultimo, fim } = res;

    const cont = alvo.querySelector("#mv-cont");
    try { cont.textContent = `${await contar("movimentacoes", f)} movimentação(ões)`; }
    catch { cont.textContent = `${dados.length} nesta página`; }

    if (!dados.length && estado.pagina === 0) {
      corpo.innerHTML = vazio("Nenhuma movimentação encontrada",
        "Assim que um equipamento for transferido, o registro aparece aqui.");
      return;
    }

    const acoesLinha = d => (d.status === "PENDENTE" && podeAprovar)
      ? `<div class="acoes">
          <button class="btn sm v" data-ap="${d.id}" title="Aprovar">${ico("check", 14)}</button>
          <button class="btn sm d" data-rj="${d.id}" title="Rejeitar">${ico("x", 14)}</button>
        </div>` : "";

    corpo.innerHTML = `
      <div class="tab-wrap responsiva"><table class="tab"><thead><tr>
        <th>Código</th><th>Data/hora</th><th>Equipamento</th><th>Tipo</th>
        <th>Origem → Destino</th><th>Usuário</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        ${dados.map(d => `<tr class="click" data-id="${d.id}">
          <td><span class="mono">${esc(d.codigo || "—")}</span></td>
          <td>${dataBR(d.data, true)}</td>
          <td><span class="mono">${esc(d.ativo_patrimonio || "—")}</span></td>
          <td>${esc(C.labelDe(C.TIPO_MOVIMENTACAO, d.tipo))}</td>
          <td>${esc(d.origem_texto || "—")} <span style="color:var(--texto-2)">→</span> <b>${esc(d.destino_texto || "—")}</b></td>
          <td>${esc(d.usuario_nome || "—")}</td>
          <td>${badge(C.STATUS_MOVIMENTACAO, d.status)}</td>
          <td>${acoesLinha(d)}</td>
        </tr>`).join("")}
      </tbody></table></div>

      <div class="lista-cards">
        ${dados.map(d => `<div class="item-card" data-id="${d.id}">
          <div class="l1"><b class="mono">${esc(d.codigo || "—")}</b>${badge(C.STATUS_MOVIMENTACAO, d.status)}</div>
          <div class="l2"><b class="mono">${esc(d.ativo_patrimonio || "—")}</b> ·
            ${esc(C.labelDe(C.TIPO_MOVIMENTACAO, d.tipo))}</div>
          <div class="l3">${esc(d.origem_texto || "—")} → ${esc(d.destino_texto || "—")}</div>
          <div class="l3">${dataBR(d.data, true)} · ${esc(d.usuario_nome || "—")}</div>
          ${acoesLinha(d)}
        </div>`).join("")}
      </div>

      <div class="paginacao">
        <span>Página ${estado.pagina + 1}</span>
        <button class="btn sm" id="mv-ant" ${estado.pagina === 0 ? "disabled" : ""}>Anterior</button>
        <button class="btn sm" id="mv-prox" ${fim ? "disabled" : ""}>Próxima</button>
      </div>`;

    corpo.querySelectorAll("[data-id]").forEach(el => el.onclick = e => {
      if (e.target.closest("[data-ap],[data-rj]")) return;
      detalheMovimentacao(dados.find(x => x.id === el.dataset.id), carregar);
    });
    corpo.querySelectorAll("[data-ap]").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const mov = dados.find(x => x.id === b.dataset.ap);
      if (!await confirmar("Aprovar transferência?",
        `O equipamento <b>${esc(mov.ativo_patrimonio || "")}</b> passará a constar em
         <b>${esc(mov.destino_texto || "—")}</b>. A alteração fica registrada no histórico.`, "Aprovar")) return;
      await aprovarMovimentacao(mov);
      toast("Transferência aprovada e aplicada no equipamento.", "ok");
      window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
      carregar();
    });
    corpo.querySelectorAll("[data-rj]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      pedirMotivoRejeicao(dados.find(x => x.id === b.dataset.rj), () => {
        window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
        carregar();
      });
    });
    corpo.querySelector("#mv-ant").onclick = () => { estado.pagina--; carregar(); };
    corpo.querySelector("#mv-prox").onclick = () => {
      estado.cursores[estado.pagina + 1] = ultimo; estado.pagina++; carregar();
    };
  }

  async function exportar() {
    toast("Preparando exportação…", "info");
    const { dados } = await buscar("movimentacoes", filtros(), ["data", "desc"], 5000);
    baixarCSV("movimentacoes",
      ["Código", "Data/hora", "Patrimônio", "Tipo", "Origem", "Destino", "Usuário", "Motivo", "Situação"],
      dados.map(d => [
        d.codigo || "", dataBR(d.data, true), d.ativo_patrimonio || "",
        C.labelDe(C.TIPO_MOVIMENTACAO, d.tipo), d.origem_texto || "", d.destino_texto || "",
        d.usuario_nome || "", d.motivo || "", C.labelDe(C.STATUS_MOVIMENTACAO, d.status)
      ]));
    toast(`${dados.length} movimentação(ões) exportada(s).`, "ok");
  }

  await carregar();
  return carregar;
}

function detalheMovimentacao(mov, aoMudar) {
  if (!mov) return;
  const linha = (r, v) => `<div class="dado"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;
  const corpo = document.createElement("div");
  corpo.innerHTML =
    linha("Código", `<span class="mono">${esc(mov.codigo || "—")}</span>`) +
    linha("Situação", badge(C.STATUS_MOVIMENTACAO, mov.status)) +
    linha("Tipo", esc(C.labelDe(C.TIPO_MOVIMENTACAO, mov.tipo))) +
    linha("Equipamento", `<span class="mono">${esc(mov.ativo_patrimonio || "—")}</span>`) +
    linha("Origem", esc(mov.origem_texto || "—")) +
    linha("Destino", `<b>${esc(mov.destino_texto || "—")}</b>`) +
    linha("Motivo", esc(mov.motivo || "—")) +
    linha("Registrado por", `${esc(mov.usuario_nome || "—")} · ${dataBR(mov.data, true)}`) +
    (mov.aprovado_por_nome ? linha("Aprovado por", `${esc(mov.aprovado_por_nome)} · ${dataBR(mov.aprovado_em, true)}`) : "") +
    (mov.motivo_rejeicao ? linha("Motivo da rejeição", esc(mov.motivo_rejeicao)) : "");

  const acoes = [{ texto: "Fechar" }];
  if (mov.ativo_id) acoes.unshift({ texto: "Abrir equipamento", icone: "cpu",
    aoClicar: () => { location.hash = `#/ativos/${mov.ativo_id}`; } });
  if (mov.status === "PENDENTE" && pode("movimentacao.aprovar")) {
    acoes.push({ texto: "Rejeitar", classe: "d", icone: "x",
      aoClicar: fechar => { fechar(); pedirMotivoRejeicao(mov, aoMudar); return false; } });
    acoes.push({ texto: "Aprovar", classe: "v", icone: "check", aoClicar: async () => {
      await aprovarMovimentacao(mov);
      toast("Transferência aprovada e aplicada no equipamento.", "ok");
      window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
      aoMudar && aoMudar();
    }});
  }
  modal({ titulo: "Movimentação", corpo, acoes });
}

/* ============================================================
 *  FLUXO DE NOVA TRANSFERÊNCIA (item 29) — rápido e pensado para o celular
 * ============================================================ */
export function fluxoNovaTransferencia(opcoes = {}) {
  let ativo = opcoes.ativo || null;
  let destinoApi = null;
  let destino = null, destinoTexto = "";
  let motivo = "";
  const precisaAprovacao = !pode("movimentacao.aprovar");

  const caixa = document.createElement("div");
  const m = modal({
    titulo: "Nova transferência", corpo: caixa, tamanho: "g", aoFechar: opcoes.aoFechar
  });

  const passos = ["Equipamento", "Conferência", "Destino", "Motivo", "Confirmação"];
  const trilha = n => `<div class="abas" style="margin-bottom:14px">${passos.map((t, i) =>
    `<div class="aba ${i === n ? "on" : ""}">${i + 1}. ${esc(t)}</div>`).join("")}</div>`;

  /* ---- Passo 1: identificar o equipamento ---- */
  function passo1(auto) {
    caixa.innerHTML = trilha(0) +
      `<div class="aviso info"><div><b>Comece pelo equipamento</b>
        Escaneie o QR Code da etiqueta ou digite o patrimônio, o número de série ou a service tag.</div></div>
      <div class="grade-campo" style="margin-top:14px">
        <button class="btn-campo verde full" id="tr-scan">${ico("scan", 30)}Escanear ou digitar identificador</button>
      </div>`;
    caixa.querySelector("#tr-scan").onclick = abrirBusca;
    if (auto) abrirBusca();
  }

  function abrirBusca() {
    abrirScanner({
      titulo: "Identificar equipamento",
      permitirManual: true,
      textoAjuda: "Sem câmera? Digite o identificador no campo acima.",
      aoLer: async codigo => {
        const a = await acharAtivoPorCodigo(codigo);
        if (!a) throw new Error(`Nenhum equipamento encontrado para "${codigo}".`);
        ativo = a;
        passo2();
      }
    });
  }

  /* ---- Passo 2: conferir o equipamento e a localização atual ---- */
  function passo2() {
    const bloqueado = C.STATUS_BLOQUEIA_MOVIMENTACAO.includes(ativo.status);
    const devolvido = ativo.status === "DEVOLVIDO_FORNECEDOR";
    caixa.innerHTML = trilha(1) + `
      <div class="ficha-topo">
        <div style="min-width:0">
          <div class="pat">${esc(ativo.patrimonio_newpc || "—")}</div>
          <div class="desc">${esc(rotuloDeId("categorias", ativo.categoria))} ·
            ${esc([ativo.fabricante, ativo.modelo].filter(Boolean).join(" ") || "—")}</div>
          <div class="desc">Série: ${esc(ativo.numero_serie || "—")}</div>
        </div>
        <div class="dir">${badgeStatusAtivo(ativo.status)}</div>
      </div>
      <div class="aviso info"><div><b>Localização atual</b>${esc(descreverLocal(ativo))}</div></div>
      ${bloqueado ? `<div class="aviso err" style="margin-top:11px"><div><b>Movimentação bloqueada</b>
        Equipamento baixado não pode ser movimentado sem reativação autorizada.</div></div>` : ""}
      ${devolvido ? `<div class="aviso warn" style="margin-top:11px"><div><b>Atenção</b>
        Este equipamento consta como devolvido ao fornecedor. Confirme com o analista antes de instalá-lo
        novamente em um cliente.</div></div>` : ""}
      <div class="grade-campo" style="margin-top:15px">
        <button class="btn-campo cinza" id="tr-outro">${ico("scan", 24)}Outro equipamento</button>
        <button class="btn-campo verde" id="tr-seguir" ${bloqueado ? "disabled" : ""}>
          ${ico("arrows", 24)}Escolher destino</button>
      </div>`;
    caixa.querySelector("#tr-outro").onclick = () => passo1(true);
    caixa.querySelector("#tr-seguir").onclick = () => { if (!bloqueado) passo3(); };
  }

  /* ---- Passo 3: destino ---- */
  async function passo3() {
    caixa.innerHTML = trilha(2) +
      `<div class="aviso info"><div><b>Para onde vai o equipamento?</b>
        Cliente e unidade são obrigatórios. Setor e sala ajudam a achar o equipamento depois.</div></div>
      <div id="tr-destino" style="margin-top:13px">${carregando("Carregando locais…")}</div>
      <div id="tr-resumo" style="margin-top:11px"></div>
      <div class="grade-campo" style="margin-top:15px">
        <button class="btn-campo cinza" id="tr-voltar">${ico("arrows", 24)}Voltar</button>
        <button class="btn-campo verde" id="tr-seguir2" disabled>${ico("check", 24)}Continuar</button>
      </div>`;
    const btn = caixa.querySelector("#tr-seguir2");
    const resumo = caixa.querySelector("#tr-resumo");
    destinoApi = await montarSelectsLocal(caixa.querySelector("#tr-destino"), {
      aoMudar: () => {
        const ok = destinoApi.completo();
        btn.disabled = !ok;
        const v = destinoApi.valores();
        const igual = ok && v.cliente_id === ativo.cliente_id && v.unidade_id === ativo.unidade_id
          && (v.setor_id || null) === (ativo.setor_id || null) && (v.local_id || null) === (ativo.local_id || null);
        resumo.innerHTML = !ok ? "" : igual
          ? `<div class="aviso warn"><div>O destino escolhido é igual à localização atual.
              Se o equipamento não mudou de lugar, não é preciso registrar transferência.</div></div>`
          : `<div class="aviso ok"><div><b>Destino</b>${esc(destinoApi.texto())}</div></div>`;
      }
    });
    caixa.querySelector("#tr-voltar").onclick = () => passo2();
    btn.onclick = () => {
      destino = destinoApi.valores();
      destinoTexto = destinoApi.texto();
      passo4();
    };
  }

  /* ---- Passo 4: motivo obrigatório ---- */
  const MOTIVOS_RAPIDOS = ["Remanejamento interno", "Atendimento de chamado",
    "Substituição de equipamento", "Nova instalação", "Solicitação do cliente"];

  function passo4() {
    caixa.innerHTML = trilha(3) +
      `<div class="aviso info"><div><b>Por que o equipamento está sendo movido?</b>
        O motivo fica no histórico do equipamento e é o que explica a mudança em auditorias.</div></div>
      <div class="grade-campo" style="margin-top:13px">
        ${MOTIVOS_RAPIDOS.map(t => `<button class="btn-campo azul" data-mt="${esc(t)}">${esc(t)}</button>`).join("")}
      </div>
      <div class="campo" style="margin-top:13px"><label>Motivo <span class="req">*</span></label>
        <textarea class="inp" id="tr-motivo" placeholder="Descreva o motivo da transferência">${esc(motivo)}</textarea></div>
      <div class="grade-campo" style="margin-top:13px">
        <button class="btn-campo cinza" id="tr-voltar2">${ico("arrows", 24)}Voltar</button>
        <button class="btn-campo verde" id="tr-seguir3">${ico("check", 24)}Revisar e confirmar</button>
      </div>`;
    const txt = caixa.querySelector("#tr-motivo");
    caixa.querySelectorAll("[data-mt]").forEach(b => b.onclick = () => {
      txt.value = b.dataset.mt; txt.focus();
    });
    caixa.querySelector("#tr-voltar2").onclick = () => { motivo = txt.value.trim(); passo3(); };
    caixa.querySelector("#tr-seguir3").onclick = () => {
      motivo = txt.value.trim();
      if (motivo.length < 3) return toast("Informe o motivo da transferência.", "warn");
      passo5();
    };
  }

  /* ---- Passo 5: confirmação ---- */
  function passo5() {
    const linha = (r, v) => `<div class="dado"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;
    caixa.innerHTML = trilha(4) +
      `<div class="card card-pad">
        ${linha("Equipamento", `<span class="mono">${esc(ativo.patrimonio_newpc)}</span> ·
          ${esc([ativo.fabricante, ativo.modelo].filter(Boolean).join(" "))}`)}
        ${linha("Sai de", esc(descreverLocal(ativo)))}
        ${linha("Vai para", `<b>${esc(destinoTexto)}</b>`)}
        ${linha("Motivo", esc(motivo))}
        ${linha("Responsável", esc(eu().nome || "—"))}
      </div>
      ${precisaAprovacao
        ? `<div class="aviso warn" style="margin-top:12px"><div><b>Sua solicitação será enviada para aprovação do analista</b>
            A localização do equipamento só muda depois que o analista aprovar. Você pode acompanhar em Pendências.</div></div>`
        : `<div class="aviso ok" style="margin-top:12px"><div><b>Efetivação imediata</b>
            A localização do equipamento será atualizada agora e o histórico registrado.</div></div>`}
      <div class="grade-campo" style="margin-top:15px">
        <button class="btn-campo cinza" id="tr-voltar3">${ico("arrows", 24)}Voltar</button>
        <button class="btn-campo verde" id="tr-gravar">${ico("check", 26)}
          ${precisaAprovacao ? "Enviar para aprovação" : "Confirmar transferência"}</button>
      </div>`;
    caixa.querySelector("#tr-voltar3").onclick = () => passo4();
    caixa.querySelector("#tr-gravar").onclick = async e => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = `<span class="spin"></span>Gravando…`;
      try { await gravar(); }
      catch (err) {
        console.error(err);
        toast(err.message || "Não foi possível registrar a transferência.", "err");
        b.disabled = false; b.innerHTML = `${ico("check", 26)}Tentar novamente`;
      }
    };
  }

  async function gravar() {
    const status = precisaAprovacao ? "PENDENTE" : "EFETIVADA";
    const origemTexto = descreverLocal(ativo);
    const codigo = await proximoCodigo("movimentacoes");
    const movId = await criar("movimentacoes", {
      codigo,
      ativo_id: ativo.id,
      ativo_patrimonio: ativo.patrimonio_newpc || null,
      tipo: "TRANSFERENCIA",
      origem_texto: origemTexto,
      destino_texto: destinoTexto,
      cliente_origem: ativo.cliente_id || null,
      cliente_destino: destino.cliente_id || null,
      unidade_origem: ativo.unidade_id || null,
      unidade_destino: destino.unidade_id || null,
      municipio_destino: destino.municipio_id || null,
      setor_destino: destino.setor_id || null,
      local_destino: destino.local_id || null,
      data: serverTimestamp(),
      usuario_id: eu().id || null,
      usuario_nome: eu().nome || null,
      motivo,
      status
    });

    if (status === "EFETIVADA") {
      /* o store grava o histórico de localização automaticamente */
      await atualizar("ativos", ativo.id, {
        cliente_id: destino.cliente_id || null,
        unidade_id: destino.unidade_id || null,
        setor_id: destino.setor_id || null,
        local_id: destino.local_id || null,
        municipio_id: destino.municipio_id || null
      });
      await registrarHistorico(ativo.id, "MOVIMENTACAO", "Transferência efetivada",
        `${origemTexto} → ${destinoTexto} · ${motivo}`, { movimentacao_id: movId, movimentacao_codigo: codigo });
      toast("Transferência registrada.", "ok", codigo);
    } else {
      await criar("pendencias", {
        codigo: await proximoCodigo("pendencias"),
        tipo: "MOVIMENTACAO",
        status: "ABERTA",
        ativo_id: ativo.id,
        ativo_patrimonio: ativo.patrimonio_newpc || null,
        cliente_id: ativo.cliente_id || null,
        unidade_id: ativo.unidade_id || null,
        movimentacao_id: movId,
        movimentacao_codigo: codigo,
        descricao: `Transferência solicitada: ${origemTexto} → ${destinoTexto}. Motivo: ${motivo}`
      });
      await registrarHistorico(ativo.id, "MOVIMENTACAO", "Transferência solicitada",
        `${origemTexto} → ${destinoTexto} · aguardando aprovação`, { movimentacao_id: movId, movimentacao_codigo: codigo });
      toast("Solicitação enviada para aprovação do analista.", "ok", codigo);
    }
    window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
    m.fechar();
  }

  if (ativo) passo2(); else passo1(true);
  return m;
}

/* ============================================================
 *  ROTA: RECOLHIMENTOS (item 30) — painel de fluxo em colunas
 * ============================================================ */
const STATUS_ATIVO_POR_ETAPA = {
  AGUARDANDO: "AGUARDANDO_RECOLHIMENTO",
  RECOLHIDO: "EM_RECOLHIMENTO",
  EM_TRANSITO: "EM_TRANSITO",
  RECEBIDO: "RECEBIDO_NEWPC"
};

export async function recolhimentos(alvo, ctx = {}) {
  const recarregar = await painelRecolhimentos(alvo);
  if (ctx.id === "novo") {
    fluxoNovoRecolhimento({
      aoFechar: () => {
        if ((location.hash || "").includes("/novo")) location.hash = "#/recolhimentos";
        else recarregar();
      }
    });
  }
}

async function painelRecolhimentos(alvo) {
  const podeAvancar = pode("recolhimento.aprovar");

  alvo.innerHTML = cabecalhoPagina("Recolhimentos",
    "Acompanhe cada equipamento desde a solicitação até a conferência na NEWPC.",
    `<button class="btn" id="rc-exp">${ico("down", 15)}Exportar</button>
     ${pode("recolhimento.criar") ? `<button class="btn p" id="rc-novo">${ico("plus", 15)}Novo recolhimento</button>` : ""}`)
    + `<style>
        @media(min-width:821px){ #rc-abas{display:none} }
        @media(max-width:820px){ #rc-colunas{grid-template-columns:1fr}
          #rc-colunas .col-rec{display:none} #rc-colunas .col-rec.on{display:block} }
        .rec-card{border:1px solid var(--borda);border-radius:var(--r-s);padding:10px 11px;margin-bottom:9px;background:#fff}
        .rec-card .pt{font-weight:700;color:var(--marinho)}
        .rec-card .lin{font-size:12px;color:var(--texto-2);margin-top:2px}
      </style>
      <div class="abas" id="rc-abas"></div>
      <div class="grade g5" id="rc-colunas">${carregando()}</div>`;

  alvo.querySelector("#rc-novo")?.addEventListener("click", () =>
    fluxoNovoRecolhimento({ aoFechar: () => carregar() }));
  alvo.querySelector("#rc-exp").onclick = exportar;

  let abaAtiva = C.FLUXO_RECOLHIMENTO[0].v;

  async function carregar() {
    const cols = alvo.querySelector("#rc-colunas");
    cols.innerHTML = carregando();
    let porEtapa;
    try {
      porEtapa = await Promise.all(C.FLUXO_RECOLHIMENTO.map(async et => {
        const f = [["etapa", "==", et.v]];
        const [{ dados }, total] = await Promise.all([
          buscar("recolhimentos", f, ["criado_em", "desc"], 60),
          contar("recolhimentos", f).catch(() => null)
        ]);
        return { etapa: et, dados, total: total == null ? dados.length : total };
      }));
    } catch (e) { cols.innerHTML = avisoConsulta(e); return; }

    const todos = porEtapa.flatMap(x => x.dados);

    alvo.querySelector("#rc-abas").innerHTML = porEtapa.map(x =>
      `<div class="aba ${x.etapa.v === abaAtiva ? "on" : ""}" data-aba="${x.etapa.v}">
        ${esc(x.etapa.label)} (${x.total})</div>`).join("");
    alvo.querySelector("#rc-abas").querySelectorAll("[data-aba]").forEach(t => t.onclick = () => {
      abaAtiva = t.dataset.aba;
      alvo.querySelectorAll("#rc-abas .aba").forEach(a => a.classList.toggle("on", a.dataset.aba === abaAtiva));
      alvo.querySelectorAll(".col-rec").forEach(c => c.classList.toggle("on", c.dataset.col === abaAtiva));
    });

    cols.innerHTML = porEtapa.map(x => `
      <div class="card col-rec ${x.etapa.v === abaAtiva ? "on" : ""}" data-col="${x.etapa.v}">
        <div class="card-tit"><h3>${esc(x.etapa.label)}</h3>
          <div class="dir"><span class="st ${C.corDe(C.FLUXO_RECOLHIMENTO, x.etapa.v)}">${x.total}</span></div></div>
        <div class="card-pad">
          ${x.dados.length ? x.dados.map(r => cardRecolhimento(r, x.etapa)).join("")
            : `<div style="font-size:12.5px;color:var(--texto-2)">Nenhum equipamento nesta etapa.</div>`}
          ${x.dados.length < x.total
            ? `<div style="font-size:11.5px;color:var(--texto-2)">Mostrando ${x.dados.length} de ${x.total}.</div>` : ""}
        </div>
      </div>`).join("");

    cols.querySelectorAll("[data-av]").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const r = todos.find(x => x.id === b.dataset.av);
      await avancarEtapa(r, carregar);
    });
    cols.querySelectorAll("[data-rec]").forEach(el => el.onclick = () =>
      detalheRecolhimento(todos.find(x => x.id === el.dataset.rec), carregar));
  }

  function cardRecolhimento(r, etapa) {
    const dias = diasDesde(r.etapa_em || r.criado_em);
    const idx = C.FLUXO_RECOLHIMENTO.findIndex(x => x.v === etapa.v);
    const prox = C.FLUXO_RECOLHIMENTO[idx + 1];
    /* a conferência final altera vínculo comercial do ativo: só quem aprova recolhimento */
    const meu = r.solicitado_por && r.solicitado_por === eu().id && prox?.v !== "CONFERIDO";
    return `<div class="rec-card" data-rec="${r.id}" style="cursor:pointer">
      <div class="pt mono">${esc(r.ativo_patrimonio || "—")}</div>
      <div class="lin">${esc(rotuloDeId("clientes", r.cliente_id))} · ${esc(rotuloDeId("unidades", r.unidade_id))}</div>
      <div class="lin">${esc(r.motivo || "—")}</div>
      <div class="lin">${dias == null ? "" : `${dias} dia(s) nesta etapa`}</div>
      ${prox && (podeAvancar || meu)
        ? `<button class="btn sm p" style="margin-top:8px;width:100%" data-av="${r.id}">
            ${ico("arrows", 13)}Avançar para ${esc(prox.label)}</button>` : ""}
    </div>`;
  }

  async function exportar() {
    toast("Preparando exportação…", "info");
    const { dados } = await buscar("recolhimentos", [], ["criado_em", "desc"], 5000);
    baixarCSV("recolhimentos",
      ["Código", "Patrimônio", "Cliente", "Unidade", "Motivo", "Etapa", "Destino final",
       "Solicitado por", "Solicitado em", "Dias na etapa", "Observação"],
      dados.map(d => [
        d.codigo || "", d.ativo_patrimonio || "",
        rotuloDeId("clientes", d.cliente_id), rotuloDeId("unidades", d.unidade_id),
        d.motivo || "", C.labelDe(C.FLUXO_RECOLHIMENTO, d.etapa),
        d.destino_final ? C.labelDe(C.DESTINO_POS_RECOLHIMENTO, d.destino_final) : "",
        d.solicitado_por_nome || "", dataBR(d.criado_em, true),
        diasDesde(d.etapa_em || d.criado_em) ?? "", d.observacao || ""
      ]));
    toast(`${dados.length} recolhimento(s) exportado(s).`, "ok");
  }

  await carregar();
  return carregar;
}

function detalheRecolhimento(r, aoMudar) {
  if (!r) return;
  const linha = (rot, v) => `<div class="dado"><div class="r">${esc(rot)}</div><div class="v">${v}</div></div>`;
  const corpo = document.createElement("div");
  corpo.innerHTML =
    linha("Código", `<span class="mono">${esc(r.codigo || "—")}</span>`) +
    linha("Etapa", badge(C.FLUXO_RECOLHIMENTO, r.etapa)) +
    linha("Equipamento", `<span class="mono">${esc(r.ativo_patrimonio || "—")}</span>`) +
    linha("Cliente / Unidade", `${esc(rotuloDeId("clientes", r.cliente_id))} · ${esc(rotuloDeId("unidades", r.unidade_id))}`) +
    linha("Motivo", esc(r.motivo || "—")) +
    linha("Observação", esc(r.observacao || "—")) +
    linha("Solicitado por", `${esc(r.solicitado_por_nome || "—")} · ${dataBR(r.criado_em, true)}`) +
    (r.destino_final ? linha("Destino final", esc(C.labelDe(C.DESTINO_POS_RECOLHIMENTO, r.destino_final))) : "");

  const acoes = [{ texto: "Fechar" }];
  if (r.ativo_id) acoes.unshift({ texto: "Abrir equipamento", icone: "cpu",
    aoClicar: () => { location.hash = `#/ativos/${r.ativo_id}`; } });
  const idx = C.FLUXO_RECOLHIMENTO.findIndex(x => x.v === r.etapa);
  const prox = C.FLUXO_RECOLHIMENTO[idx + 1];
  if (prox && (pode("recolhimento.aprovar")
      || (r.solicitado_por === eu().id && prox.v !== "CONFERIDO"))) {
    acoes.push({ texto: `Avançar para ${prox.label}`, classe: "p", icone: "arrows",
      aoClicar: fechar => { fechar(); avancarEtapa(r, aoMudar); return false; } });
  }
  modal({ titulo: "Recolhimento", corpo, acoes });
}

/* Avança uma etapa do fluxo. Ao entrar em "Conferido" pergunta o destino final. */
async function avancarEtapa(r, aoFim) {
  if (!r) return;
  const idx = C.FLUXO_RECOLHIMENTO.findIndex(x => x.v === r.etapa);
  const atual = C.FLUXO_RECOLHIMENTO[idx];
  const prox = C.FLUXO_RECOLHIMENTO[idx + 1];
  if (!prox) return toast("Este recolhimento já está na última etapa.", "info");

  if (prox.v === "CONFERIDO") return perguntarDestinoFinal(r, atual, aoFim);

  if (!await confirmar(`Avançar para ${prox.label}?`,
    `O equipamento <b>${esc(r.ativo_patrimonio || "")}</b> passa de <b>${esc(atual.label)}</b>
     para <b>${esc(prox.label)}</b>. O histórico do equipamento registra a mudança.`, "Avançar")) return;

  await atualizar("recolhimentos", r.id, {
    etapa: prox.v, etapa_em: serverTimestamp(),
    etapa_por: eu().id || null, etapa_por_nome: eu().nome || null
  });
  if (r.ativo_id && STATUS_ATIVO_POR_ETAPA[prox.v]) {
    await atualizar("ativos", r.ativo_id, { status: STATUS_ATIVO_POR_ETAPA[prox.v] });
  }
  if (r.ativo_id) {
    await registrarHistorico(r.ativo_id, "RECOLHIMENTO", `Recolhimento: ${prox.label}`,
      `${atual.label} → ${prox.label}`, { recolhimento_id: r.id, recolhimento_codigo: r.codigo || null });
  }
  toast(`Recolhimento em "${prox.label}".`, "ok");
  aoFim && aoFim();
}

function perguntarDestinoFinal(r, atual, aoFim) {
  let escolhido = "";
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso info"><div><b>Conferência final</b>
      O equipamento <b>${esc(r.ativo_patrimonio || "")}</b> foi conferido na NEWPC.
      Escolha o destino — é isto que define o status do equipamento daqui em diante.</div></div>
    <div class="grade-campo" style="margin-top:13px">
      ${C.DESTINO_POS_RECOLHIMENTO.map(d => `<button class="btn-campo azul" data-dst="${d.v}">${esc(d.label)}</button>`).join("")}
    </div>
    <div id="dst-aviso" style="margin-top:12px"></div>
    <div class="campo" style="margin-top:11px"><label>Observação da conferência</label>
      <textarea class="inp" id="dst-obs" placeholder="Estado do equipamento, acessórios recebidos…"></textarea></div>`;

  const m = modal({
    titulo: "Destino final do equipamento", corpo,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Confirmar conferência", classe: "p", icone: "check", aoClicar: async () => {
        if (!escolhido) { toast("Escolha o destino do equipamento.", "warn"); return false; }
        await concluirConferencia(r, atual, escolhido, corpo.querySelector("#dst-obs").value.trim());
        aoFim && aoFim();
      }}
    ]
  });

  corpo.querySelectorAll("[data-dst]").forEach(b => b.onclick = () => {
    escolhido = b.dataset.dst;
    corpo.querySelectorAll("[data-dst]").forEach(x => x.classList.toggle("verde", x === b));
    const limpa = ["DEVOLVIDO_FORNECEDOR", "BAIXADO"].includes(escolhido);
    corpo.querySelector("#dst-aviso").innerHTML = limpa
      ? `<div class="aviso warn"><div><b>O vínculo com o cliente será removido</b>
          Como o equipamento vai para <b>${esc(C.labelDe(C.DESTINO_POS_RECOLHIMENTO, escolhido))}</b>,
          o cliente, o contrato comercial, a unidade, o setor e a sala serão limpos do cadastro.
          Assim ele deixa de aparecer como instalado em cliente. O histórico é preservado.</div></div>`
      : `<div class="aviso ok"><div>O equipamento ficará com o status
          <b>${esc(C.labelDe(C.STATUS_ATIVO, escolhido))}</b>.</div></div>`;
  });
  return m;
}

async function concluirConferencia(r, atual, destino, observacao) {
  const ativo = r.ativo_id ? await obter("ativos", r.ativo_id) : null;
  const limpaAlocacao = ["DEVOLVIDO_FORNECEDOR", "BAIXADO"].includes(destino);

  await atualizar("recolhimentos", r.id, {
    etapa: "CONFERIDO", etapa_em: serverTimestamp(),
    etapa_por: eu().id || null, etapa_por_nome: eu().nome || null,
    destino_final: destino, observacao_conferencia: observacao || null,
    conferido_em: serverTimestamp(), conferido_por: eu().id || null, conferido_por_nome: eu().nome || null
  });

  if (ativo) {
    const dados = { status: destino };
    if (limpaAlocacao) {
      /* regra 5: equipamento fora de operação não pode continuar alocado em cliente */
      Object.assign(dados, {
        cliente_id: null, contrato_cliente_id: null,
        unidade_id: null, setor_id: null, local_id: null
      });
    }
    await atualizar("ativos", ativo.id, dados);
    await registrarHistorico(ativo.id, "RECOLHIMENTO", "Recolhimento conferido",
      `Destino: ${C.labelDe(C.DESTINO_POS_RECOLHIMENTO, destino)}` +
      (limpaAlocacao ? ` · alocação em cliente removida (origem: ${descreverLocal(ativo)})` : "") +
      (observacao ? ` · ${observacao}` : ""),
      { recolhimento_id: r.id, recolhimento_codigo: r.codigo || null });
  }
  toast("Conferência concluída.", "ok",
    limpaAlocacao ? "Equipamento desvinculado do cliente" : "");
}

/* ============================================================
 *  FLUXO DE NOVO RECOLHIMENTO — pensado para o celular
 * ============================================================ */
export function fluxoNovoRecolhimento(opcoes = {}) {
  let ativo = opcoes.ativo || null;
  let motivo = "";
  const caixa = document.createElement("div");
  const m = modal({ titulo: "Novo recolhimento", corpo: caixa, tamanho: "g", aoFechar: opcoes.aoFechar });

  const passos = ["Equipamento", "Motivo", "Confirmação"];
  const trilha = n => `<div class="abas" style="margin-bottom:14px">${passos.map((t, i) =>
    `<div class="aba ${i === n ? "on" : ""}">${i + 1}. ${esc(t)}</div>`).join("")}</div>`;

  function passo1(auto) {
    caixa.innerHTML = trilha(0) +
      `<div class="aviso info"><div><b>Qual equipamento será recolhido?</b>
        Escaneie o QR Code da etiqueta ou digite o identificador.</div></div>
      <div class="grade-campo" style="margin-top:14px">
        <button class="btn-campo verde full" id="rn-scan">${ico("scan", 30)}Escanear ou digitar identificador</button>
      </div>`;
    caixa.querySelector("#rn-scan").onclick = abrirBusca;
    if (auto) abrirBusca();
  }

  function abrirBusca() {
    abrirScanner({
      titulo: "Identificar equipamento", permitirManual: true,
      aoLer: async codigo => {
        const a = await acharAtivoPorCodigo(codigo);
        if (!a) throw new Error(`Nenhum equipamento encontrado para "${codigo}".`);
        ativo = a;
        passo2();
      }
    });
  }

  function passo2() {
    caixa.innerHTML = trilha(1) + `
      <div class="ficha-topo"><div style="min-width:0">
        <div class="pat">${esc(ativo.patrimonio_newpc || "—")}</div>
        <div class="desc">${esc([ativo.fabricante, ativo.modelo].filter(Boolean).join(" ") || "—")}</div>
        <div class="desc">${esc(descreverLocal(ativo))}</div>
      </div><div class="dir">${badgeStatusAtivo(ativo.status)}</div></div>
      <div class="grade-campo" style="margin-top:13px">
        ${C.MOTIVO_RECOLHIMENTO.map(t => `<button class="btn-campo azul" data-mt="${esc(t)}">${esc(t)}</button>`).join("")}
      </div>
      <div class="campo" style="margin-top:13px"><label>Observação</label>
        <textarea class="inp" id="rn-obs" placeholder="Informações úteis para quem vai buscar o equipamento"></textarea></div>
      <div class="grade-campo" style="margin-top:13px">
        <button class="btn-campo cinza" id="rn-outro">${ico("scan", 24)}Outro equipamento</button>
        <button class="btn-campo verde" id="rn-seguir">${ico("check", 24)}Continuar</button>
      </div>`;
    caixa.querySelectorAll("[data-mt]").forEach(b => b.onclick = () => {
      motivo = b.dataset.mt;
      caixa.querySelectorAll("[data-mt]").forEach(x => x.classList.toggle("verde", x === b));
    });
    caixa.querySelector("#rn-outro").onclick = () => passo1(true);
    caixa.querySelector("#rn-seguir").onclick = () => {
      if (!motivo) return toast("Escolha o motivo do recolhimento.", "warn");
      passo3(caixa.querySelector("#rn-obs").value.trim());
    };
  }

  function passo3(observacao) {
    const linha = (r, v) => `<div class="dado"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;
    caixa.innerHTML = trilha(2) + `
      <div class="card card-pad">
        ${linha("Equipamento", `<span class="mono">${esc(ativo.patrimonio_newpc)}</span>`)}
        ${linha("Onde está", esc(descreverLocal(ativo)))}
        ${linha("Motivo", esc(motivo))}
        ${linha("Observação", esc(observacao || "—"))}
      </div>
      <div class="aviso info" style="margin-top:12px"><div>
        O equipamento passa para <b>Aguardando Recolhimento</b> e entra na primeira coluna do painel.
        O destino final (estoque, manutenção, devolução ou baixa) só é definido na conferência na NEWPC.</div></div>
      <div class="grade-campo" style="margin-top:15px">
        <button class="btn-campo cinza" id="rn-voltar">${ico("arrows", 24)}Voltar</button>
        <button class="btn-campo verde" id="rn-gravar">${ico("check", 26)}Registrar recolhimento</button>
      </div>`;
    caixa.querySelector("#rn-voltar").onclick = () => passo2();
    caixa.querySelector("#rn-gravar").onclick = async e => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = `<span class="spin"></span>Gravando…`;
      try {
        const codigo = await proximoCodigo("recolhimentos");
        const recId = await criar("recolhimentos", {
          codigo,
          ativo_id: ativo.id,
          ativo_patrimonio: ativo.patrimonio_newpc || null,
          cliente_id: ativo.cliente_id || null,
          unidade_id: ativo.unidade_id || null,
          motivo,
          observacao: observacao || null,
          etapa: "AGUARDANDO",
          etapa_em: serverTimestamp(),
          origem_texto: descreverLocal(ativo),
          solicitado_por: eu().id || null,
          solicitado_por_nome: eu().nome || null,
          criado_em: serverTimestamp()
        });
        await atualizar("ativos", ativo.id, { status: "AGUARDANDO_RECOLHIMENTO" });
        await registrarHistorico(ativo.id, "RECOLHIMENTO", "Recolhimento solicitado",
          `${motivo}${observacao ? " · " + observacao : ""}`,
          { recolhimento_id: recId, recolhimento_codigo: codigo });
        toast("Recolhimento registrado.", "ok", codigo);
        m.fechar();
      } catch (err) {
        console.error(err);
        toast(err.message || "Não foi possível registrar o recolhimento.", "err");
        b.disabled = false; b.innerHTML = `${ico("check", 26)}Tentar novamente`;
      }
    };
  }

  if (ativo) passo2(); else passo1(true);
  return m;
}
