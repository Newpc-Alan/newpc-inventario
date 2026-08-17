/* NEWPC INVENTÁRIO — Central de Pendências e Painel de Manutenção
 * Rotas expostas: pendencias(alvo, ctx) e manutencao(alvo, ctx).
 *
 * A central de pendências é onde as divergências do inventário viram decisão:
 *  - Divergência de localização: atualiza o cadastro ou mantém o que estava (item 21).
 *  - Não localizado: uma vistoria isolada NÃO transforma o equipamento em perda (regra 8).
 *  - Defeito, cadastro pendente e movimentação aguardando aprovação (itens 24 e 49).
 * Toda resolução grava quem resolveu, quando e o texto da decisão, além do histórico do ativo.
 */
import {
  buscar, contar, obter, criar, atualizar, listaRef, rotuloDeId, descreverLocal,
  proximoCodigo, registrarHistorico, historicoDoAtivo, parametros, serverTimestamp
} from "../store.js";
import {
  ico, esc, toast, modal, confirmar, badge, badgeStatusAtivo, cabecalhoPagina, kpi,
  vazio, carregando, baixarCSV, dataBR, diasDesde
} from "../ui.js";
import { pode, ehAdmin, sessao } from "../auth.js";
import { abrirEditor } from "./lista.js";
import { acharAtivoPorCodigo } from "./scanner.js";
import {
  montarSelectsLocal, aprovarMovimentacao, rejeitarMovimentacao
} from "./movimentacoes.js";
import * as C from "../config.js";

const eu = () => sessao.usuario || {};
const dtIni = v => (v ? new Date(v + "T00:00:00") : null);
const dtFim = v => (v ? new Date(v + "T23:59:59") : null);
const linhaDado = (r, v) => `<div class="dado"><div class="r">${esc(r)}</div><div class="v">${v}</div></div>`;

function avisoConsulta(e) {
  console.error(e);
  return `<div class="aviso err"><div><b>Não foi possível carregar a consulta</b>
    ${/index/i.test(e.message || "") ?
      "Falta um índice composto no Firestore. Abra o console do navegador e clique no link gerado pelo Firebase para criá-lo."
      : esc(e.message || "Erro inesperado.")}</div></div>`;
}

/* Grava a decisão na pendência e registra o histórico do equipamento. */
async function fecharPendencia(p, status, texto, extra = {}) {
  await atualizar("pendencias", p.id, {
    status,
    resolucao_texto: texto,
    resolvido_por: eu().id || null,
    resolvido_por_nome: eu().nome || null,
    resolvido_em: serverTimestamp(),
    ...extra
  });
  if (p.ativo_id) {
    await registrarHistorico(p.ativo_id, "PENDENCIA",
      `Pendência ${C.labelDe(C.STATUS_PENDENCIA, status).toLowerCase()}: ${C.labelDe(C.TIPO_PENDENCIA, p.tipo)}`,
      texto, { pendencia_id: p.id, pendencia_codigo: p.codigo || null });
  }
  window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
}

/* ============================================================
 *  ROTA: PENDÊNCIAS
 * ============================================================ */
export async function pendencias(alvo, ctx = {}) {
  const p = await parametros();
  const tam = p.paginaTamanho || 25;
  const podeResolver = pode("pendencia.resolver");
  const clientes = (await listaRef("clientes")).filter(c => c.ativo !== false);

  const ABAS = [{ v: "", label: "Todas" }, ...C.TIPO_PENDENCIA];
  const estado = { aba: "", status: "ABERTAS", cliente: "", de: "", ate: "", pagina: 0, cursores: [null] };

  alvo.innerHTML = cabecalhoPagina("Pendências",
    "Divergências, defeitos e solicitações que dependem de uma decisão.",
    `<button class="btn" id="pd-exp">${ico("down", 15)}Exportar</button>`)
    + `<div class="abas" id="pd-abas"></div>
      <div class="filtros">
        <div class="linha">
          <select class="inp" data-f="status">
            <option value="ABERTAS">Em aberto (aberta + em análise)</option>
            ${C.STATUS_PENDENCIA.map(s => `<option value="${s.v}">${esc(s.label)}</option>`).join("")}
            <option value="TODAS">Todas as situações</option>
          </select>
          <select class="inp" data-f="cliente"><option value="">Cliente: todos</option>
            ${clientes.map(c => `<option value="${esc(c.id)}">${esc(c.nome_fantasia || c.razao_social)}</option>`).join("")}</select>
          <input class="inp" type="date" data-f="de" title="Registradas a partir de">
          <input class="inp" type="date" data-f="ate" title="Registradas até">
        </div>
        <div class="pe"><span class="cont" id="pd-cont"></span>
          <button class="btn sm" id="pd-limpar">Limpar filtros</button></div>
      </div>
      <div id="pd-corpo">${carregando()}</div>`;

  alvo.querySelectorAll("[data-f]").forEach(el => el.onchange = () => {
    estado[el.dataset.f] = el.value;
    estado.pagina = 0; estado.cursores = [null];
    carregar();
  });
  alvo.querySelector("#pd-limpar").onclick = () => {
    Object.assign(estado, { status: "ABERTAS", cliente: "", de: "", ate: "", pagina: 0, cursores: [null] });
    alvo.querySelectorAll("[data-f]").forEach(el => { el.value = el.dataset.f === "status" ? "ABERTAS" : ""; });
    carregar();
  };
  alvo.querySelector("#pd-exp").onclick = exportar;

  function filtroStatus() {
    if (estado.status === "TODAS") return [];
    if (estado.status === "ABERTAS") return [["status", "in", ["ABERTA", "EM_ANALISE"]]];
    return [["status", "==", estado.status]];
  }
  function filtros(tipo = estado.aba) {
    const f = [...filtroStatus()];
    if (tipo) f.push(["tipo", "==", tipo]);
    if (estado.cliente) f.push(["cliente_id", "==", estado.cliente]);
    if (estado.de) f.push(["criado_em", ">=", dtIni(estado.de)]);
    if (estado.ate) f.push(["criado_em", "<=", dtFim(estado.ate)]);
    return f;
  }

  async function pintarAbas() {
    const box = alvo.querySelector("#pd-abas");
    box.innerHTML = ABAS.map(a =>
      `<div class="aba ${a.v === estado.aba ? "on" : ""}" data-aba="${a.v}">${esc(a.label)}
        <span class="mono" data-n="${a.v}">…</span></div>`).join("");
    box.querySelectorAll("[data-aba]").forEach(t => t.onclick = () => {
      estado.aba = t.dataset.aba;
      estado.pagina = 0; estado.cursores = [null];
      box.querySelectorAll(".aba").forEach(a => a.classList.toggle("on", a.dataset.aba === estado.aba));
      carregar();
    });
    /* contagem real de cada aba, respeitando os filtros ativos */
    await Promise.all(ABAS.map(async a => {
      const el = box.querySelector(`[data-n="${a.v}"]`);
      if (!el) return;
      try { el.textContent = `(${await contar("pendencias", filtros(a.v))})`; }
      catch { el.textContent = ""; }
    }));
  }

  async function carregar() {
    const corpo = alvo.querySelector("#pd-corpo");
    corpo.innerHTML = carregando();
    pintarAbas();

    const f = filtros();
    let res;
    try { res = await buscar("pendencias", f, ["criado_em", "desc"], tam, estado.cursores[estado.pagina]); }
    catch (e) { corpo.innerHTML = avisoConsulta(e); return; }
    const { dados, ultimo, fim } = res;

    const cont = alvo.querySelector("#pd-cont");
    try { cont.textContent = `${await contar("pendencias", f)} pendência(s)`; }
    catch { cont.textContent = `${dados.length} nesta página`; }

    if (!dados.length && estado.pagina === 0) {
      corpo.innerHTML = vazio("Nenhuma pendência por aqui",
        estado.status === "ABERTAS"
          ? "Nada aguardando decisão com os filtros atuais."
          : "Ajuste os filtros para ver outras situações.");
      return;
    }

    corpo.innerHTML = `<div class="lista-cards" style="display:flex">
      ${dados.map(d => `<div class="item-card" data-id="${d.id}">
        <div class="l1"><b class="mono">${esc(d.codigo || "—")}</b>${badge(C.STATUS_PENDENCIA, d.status)}</div>
        <div class="l2"><b>${esc(C.labelDe(C.TIPO_PENDENCIA, d.tipo))}</b>
          ${d.ativo_patrimonio ? ` · <span class="mono">${esc(d.ativo_patrimonio)}</span>` : ""}
          ${d.criticidade ? ` · ${badge(C.CRITICIDADE, d.criticidade)}` : ""}</div>
        <div class="l2" style="color:var(--texto-2)">${esc(d.descricao || d.justificativa || "—")}</div>
        <div class="l3">${esc(d.criado_por_nome || "—")} · ${dataBR(d.criado_em, true)}
          ${d.cliente_id ? ` · ${esc(rotuloDeId("clientes", d.cliente_id))}` : ""}
          ${d.inventario_codigo ? ` · Inventário <span class="mono">${esc(d.inventario_codigo)}</span>` : ""}</div>
      </div>`).join("")}
    </div>
    <div class="paginacao">
      <span>Página ${estado.pagina + 1}</span>
      <button class="btn sm" id="pd-ant" ${estado.pagina === 0 ? "disabled" : ""}>Anterior</button>
      <button class="btn sm" id="pd-prox" ${fim ? "disabled" : ""}>Próxima</button>
    </div>`;

    corpo.querySelectorAll("[data-id]").forEach(el => el.onclick = () =>
      abrirResolucao(dados.find(x => x.id === el.dataset.id), podeResolver, carregar));
    corpo.querySelector("#pd-ant").onclick = () => { estado.pagina--; carregar(); };
    corpo.querySelector("#pd-prox").onclick = () => {
      estado.cursores[estado.pagina + 1] = ultimo; estado.pagina++; carregar();
    };
  }

  async function exportar() {
    toast("Preparando exportação…", "info");
    const { dados } = await buscar("pendencias", filtros(), ["criado_em", "desc"], 5000);
    baixarCSV("pendencias",
      ["Código", "Tipo", "Situação", "Patrimônio", "Cliente", "Descrição", "Inventário",
       "Registrado por", "Registrado em", "Resolvido por", "Resolvido em", "Decisão"],
      dados.map(d => [
        d.codigo || "", C.labelDe(C.TIPO_PENDENCIA, d.tipo), C.labelDe(C.STATUS_PENDENCIA, d.status),
        d.ativo_patrimonio || "", rotuloDeId("clientes", d.cliente_id),
        d.descricao || d.justificativa || "", d.inventario_codigo || "",
        d.criado_por_nome || "", dataBR(d.criado_em, true),
        d.resolvido_por_nome || "", dataBR(d.resolvido_em, true), d.resolucao_texto || ""
      ]));
    toast(`${dados.length} pendência(s) exportada(s).`, "ok");
  }

  await carregar();

  /* #/pendencias/<id> abre a resolução direto */
  if (ctx.id) {
    const p1 = await obter("pendencias", ctx.id);
    if (p1) abrirResolucao(p1, podeResolver, carregar);
  }
}

/* ============================================================
 *  MODAL DE RESOLUÇÃO — conteúdo depende do tipo
 * ============================================================ */
function cabecalhoPendencia(p) {
  return `<div class="card card-pad" style="margin-bottom:13px">
    <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
      <span class="mono" style="font-weight:700">${esc(p.codigo || "—")}</span>
      ${badge(C.STATUS_PENDENCIA, p.status)}
      ${p.criticidade ? badge(C.CRITICIDADE, p.criticidade) : ""}
    </div>
    ${linhaDado("Equipamento", p.ativo_patrimonio
      ? `<span class="mono">${esc(p.ativo_patrimonio)}</span>` : "Ainda não cadastrado")}
    ${linhaDado("Registrado por", `${esc(p.criado_por_nome || "—")} · ${dataBR(p.criado_em, true)}`)}
    ${p.inventario_codigo ? linhaDado("Inventário de origem",
      `<span class="mono">${esc(p.inventario_codigo)}</span>`) : ""}
    ${p.descricao ? linhaDado("Descrição", esc(p.descricao)) : ""}
  </div>`;
}

const foto = url => url
  ? `<div style="margin:11px 0"><img src="${esc(url)}" alt="Foto registrada em campo"
      style="max-width:100%;border-radius:var(--r-s);border:1px solid var(--borda)"></div>` : "";

async function abrirResolucao(p, podeResolver, aoMudar) {
  if (!p) return;
  const finalizada = ["RESOLVIDA", "DESCARTADA"].includes(p.status);
  const corpo = document.createElement("div");
  corpo.innerHTML = cabecalhoPendencia(p) + carregando();

  const m = modal({
    titulo: C.labelDe(C.TIPO_PENDENCIA, p.tipo),
    corpo, tamanho: "g",
    acoes: [{ texto: "Fechar" }]
  });

  const fim = () => { m.fechar(); aoMudar && aoMudar(); };
  const bloqueio = finalizada
    ? `<div class="aviso ok"><div><b>Pendência já ${esc(C.labelDe(C.STATUS_PENDENCIA, p.status).toLowerCase())}</b>
        ${esc(p.resolvido_por_nome || "")} · ${dataBR(p.resolvido_em, true)}<br>${esc(p.resolucao_texto || "")}</div></div>`
    : (!podeResolver
      ? `<div class="aviso warn"><div>Seu perfil pode acompanhar, mas não resolver pendências.
          Procure o analista responsável.</div></div>` : "");

  const montar = { DIVERGENCIA_LOCAL: divergencia, NAO_LOCALIZADO: naoLocalizado,
    DEFEITO: defeito, CADASTRO_PENDENTE: cadastroPendente, MOVIMENTACAO: movimentacaoPendente,
    RECOLHIMENTO: recolhimentoPendente }[p.tipo] || generica;

  try {
    const html = await montar(p, { podeAgir: podeResolver && !finalizada, fim, corpo });
    corpo.innerHTML = cabecalhoPendencia(p) + bloqueio + html.corpo;
    html.ligar && html.ligar(corpo);
  } catch (e) {
    console.error(e);
    corpo.innerHTML = cabecalhoPendencia(p) +
      `<div class="aviso err"><div><b>Não foi possível abrir esta pendência</b>
        ${esc(e.message || "Erro inesperado.")}</div></div>`;
  }
}

/* ---------- DIVERGÊNCIA DE LOCALIZAÇÃO (item 21) ---------- */
async function divergencia(p, ctx) {
  const corpo = `
    <div class="grade g2">
      <div class="card card-pad">
        <div class="dado"><div class="r">Local cadastrado</div>
          <div class="v">${esc(p.local_esperado_texto || descreverLocal({
            cliente_id: p.cliente_id, unidade_id: p.unidade_id, setor_id: p.setor_id, local_id: p.local_id }))}</div></div>
      </div>
      <div class="card card-pad" style="border-color:var(--laranja)">
        <div class="dado"><div class="r">Local encontrado pelo técnico</div>
          <div class="v"><b>${esc(p.local_encontrado_texto || descreverLocal({
            cliente_id: p.cliente_encontrado, unidade_id: p.unidade_encontrada,
            setor_id: p.setor_encontrado, local_id: p.local_encontrado }))}</b></div></div>
      </div>
    </div>
    ${foto(p.foto_url)}
    ${p.justificativa ? `<div class="aviso info" style="margin-top:11px"><div>
      <b>Justificativa do técnico</b>${esc(p.justificativa)}</div></div>` : ""}
    <div class="campo" style="margin-top:13px"><label>Observação da decisão</label>
      <textarea class="inp" id="dv-obs" placeholder="Obrigatória para manter o cadastro atual"></textarea></div>
    ${ctx.podeAgir ? `<div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo cinza" id="dv-manter">${ico("x", 22)}Manter cadastro</button>
      <button class="btn-campo verde" id="dv-atualizar">${ico("pin", 22)}Atualizar localização</button>
    </div>` : ""}`;

  return { corpo, ligar(el) {
    el.querySelector("#dv-atualizar")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const obs = el.querySelector("#dv-obs").value.trim();
        const ativo = await obter("ativos", p.ativo_id);
        if (!ativo) throw new Error("Equipamento não encontrado.");
        const destino = {
          cliente_id: p.cliente_encontrado || null,
          unidade_id: p.unidade_encontrada || null,
          setor_id: p.setor_encontrado || null,
          local_id: p.local_encontrado || null
        };
        const origemTexto = p.local_esperado_texto || descreverLocal(ativo);
        const destinoTexto = p.local_encontrado_texto || descreverLocal(destino);
        /* o store grava o histórico de localização automaticamente */
        await atualizar("ativos", ativo.id, destino);
        const codigo = await proximoCodigo("movimentacoes");
        await criar("movimentacoes", {
          codigo, ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc || null,
          tipo: "TRANSFERENCIA", status: "EFETIVADA",
          origem_texto: origemTexto, destino_texto: destinoTexto,
          cliente_origem: ativo.cliente_id || null, cliente_destino: destino.cliente_id,
          unidade_origem: ativo.unidade_id || null, unidade_destino: destino.unidade_id,
          setor_destino: destino.setor_id, local_destino: destino.local_id,
          data: serverTimestamp(),
          usuario_id: eu().id || null, usuario_nome: eu().nome || null,
          motivo: "Regularização de divergência de inventário",
          pendencia_id: p.id, pendencia_codigo: p.codigo || null
        });
        await fecharPendencia(p, "RESOLVIDA",
          `Cadastro atualizado para o local encontrado em campo: ${destinoTexto}.${obs ? " " + obs : ""}`);
        toast("Localização atualizada e divergência resolvida.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao atualizar.", "err"); b.disabled = false; }
    });
    el.querySelector("#dv-manter")?.addEventListener("click", async e => {
      const obs = el.querySelector("#dv-obs").value.trim();
      if (obs.length < 5) return toast("Explique por que o cadastro atual será mantido.", "warn");
      const b = e.currentTarget; b.disabled = true;
      try {
        await fecharPendencia(p, "DESCARTADA", `Cadastro mantido. ${obs}`);
        toast("Divergência descartada. O cadastro permanece como estava.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });
  }};
}

/* ---------- NÃO LOCALIZADO (regra 8) ---------- */
async function naoLocalizado(p, ctx) {
  const ativo = p.ativo_id ? await obter("ativos", p.ativo_id) : null;
  const corpo = `
    <div class="aviso warn"><div><b>Uma vistoria sem sucesso não significa equipamento perdido</b>
      O equipamento pode estar em outra sala, em manutenção ou emprestado. A baixa por perda definitiva
      só deve ser registrada depois de nova busca e autorização — e apenas pelo administrador.</div></div>
    ${linhaDado("Última localização conhecida", esc(ativo ? descreverLocal(ativo) : "—"))}
    ${linhaDado("Situação atual do equipamento", ativo ? badgeStatusAtivo(ativo.status) : "—")}
    ${p.justificativa ? linhaDado("Relato do técnico", esc(p.justificativa)) : ""}
    ${foto(p.foto_url)}
    <div id="nl-local" style="margin-top:13px"></div>
    <div class="campo" style="margin-top:11px"><label>Observação / justificativa</label>
      <textarea class="inp" id="nl-obs" placeholder="Onde procurou, com quem falou, o que ficou combinado"></textarea></div>
    ${ctx.podeAgir ? `<div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo verde" id="nl-achou">${ico("check", 22)}Equipamento localizado</button>
      <button class="btn-campo amarelo" id="nl-manter">${ico("clock", 22)}Manter como não localizado</button>
      ${ehAdmin() ? `<button class="btn-campo vermelho full" id="nl-perda">${ico("alert", 22)}
        Registrar como perda definitiva</button>` : `<div class="aviso info full" style="grid-column:1/-1">
        <div>A baixa por perda definitiva é exclusiva do administrador.</div></div>`}
    </div>` : ""}`;

  return { corpo, async ligar(el) {
    let selLocal = null;
    const caixaLocal = el.querySelector("#nl-local");

    el.querySelector("#nl-achou")?.addEventListener("click", async e => {
      if (!selLocal) {
        caixaLocal.innerHTML = `<div class="aviso info"><div><b>Onde o equipamento está agora?</b>
          Informe o local atual e confirme novamente.</div></div><div id="nl-selects"></div>`;
        selLocal = await montarSelectsLocal(caixaLocal.querySelector("#nl-selects"));
        caixaLocal.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (!selLocal.completo()) return toast("Informe pelo menos o cliente e a unidade.", "warn");
      const b = e.currentTarget; b.disabled = true;
      try {
        const v = selLocal.valores();
        const texto = selLocal.texto();
        const dados = { ...v };
        /* equipamento reaparece: volta a ser um equipamento em uso */
        if (ativo && ativo.status === "NAO_LOCALIZADO") dados.status = "EM_USO";
        await atualizar("ativos", p.ativo_id, dados);
        await fecharPendencia(p, "RESOLVIDA",
          `Equipamento localizado em ${texto}. ${el.querySelector("#nl-obs").value.trim()}`.trim());
        toast("Equipamento localizado e cadastro atualizado.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });

    el.querySelector("#nl-manter")?.addEventListener("click", async e => {
      const obs = el.querySelector("#nl-obs").value.trim();
      if (obs.length < 5) return toast("Registre o que já foi verificado.", "warn");
      const b = e.currentTarget; b.disabled = true;
      try {
        if (p.ativo_id) await atualizar("ativos", p.ativo_id, { status: "NAO_LOCALIZADO" });
        await fecharPendencia(p, "EM_ANALISE", `Mantido como não localizado. ${obs}`);
        toast("Pendência mantida em análise para nova busca.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });

    el.querySelector("#nl-perda")?.addEventListener("click", async e => {
      const obs = el.querySelector("#nl-obs").value.trim();
      if (obs.length < 30) return toast("A justificativa da perda precisa ser detalhada (mínimo 30 caracteres).", "warn");
      if (!await confirmar("Registrar perda definitiva?",
        `O equipamento <b>${esc(p.ativo_patrimonio || "")}</b> passará para <b>Baixado</b>.
         Esta decisão fica registrada em auditoria com o seu nome.`, "Continuar", true)) return;
      if (!await confirmar("Confirmação final",
        `Confirma a <b>baixa por perda definitiva</b>? O equipamento sai do inventário operacional.`,
        "Registrar perda", true)) return;
      const b = e.currentTarget; b.disabled = true;
      try {
        await atualizar("ativos", p.ativo_id, { status: "BAIXADO" });
        await registrarHistorico(p.ativo_id, "BAIXA", "Baixa por perda definitiva", obs,
          { pendencia_id: p.id, pendencia_codigo: p.codigo || null });
        await fecharPendencia(p, "RESOLVIDA", `Perda definitiva registrada. ${obs}`);
        toast("Perda definitiva registrada.", "warn");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });
  }};
}

/* ---------- DEFEITO ---------- */
async function defeito(p, ctx) {
  const ativo = p.ativo_id ? await obter("ativos", p.ativo_id) : null;
  const corpo = `
    ${linhaDado("Tipo de defeito", esc(p.tipo_defeito || "—"))}
    ${linhaDado("Criticidade", p.criticidade ? badge(C.CRITICIDADE, p.criticidade) : "—")}
    ${linhaDado("Descrição", esc(p.descricao || p.justificativa || "—"))}
    ${linhaDado("Onde está", esc(ativo ? descreverLocal(ativo) : "—"))}
    ${foto(p.foto_url)}
    <div class="campo" style="margin-top:13px"><label>Observação / descrição do reparo</label>
      <textarea class="inp" id="df-obs" placeholder="Obrigatória para resolver no local"></textarea></div>
    ${ctx.podeAgir ? `<div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo laranja" id="df-manut">${ico("wrench", 22)}Enviar para manutenção</button>
      <button class="btn-campo verde" id="df-local">${ico("check", 22)}Resolver no local</button>
      <button class="btn-campo azul full" id="df-recolher">${ico("box", 22)}Programar recolhimento</button>
    </div>` : ""}`;

  return { corpo, ligar(el) {
    el.querySelector("#df-manut")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const anterior = {
          cliente_id: ativo?.cliente_id || null, unidade_id: ativo?.unidade_id || null,
          setor_id: ativo?.setor_id || null, local_id: ativo?.local_id || null,
          municipio_id: ativo?.municipio_id || null
        };
        const origemTexto = ativo ? descreverLocal(ativo) : "—";
        /* guardamos a localização anterior para o retorno de manutenção saber para onde devolver */
        await atualizar("ativos", p.ativo_id, {
          status: "EM_MANUTENCAO",
          local_anterior: anterior,
          local_anterior_texto: origemTexto,
          manutencao_desde: serverTimestamp()
        });
        const codigo = await proximoCodigo("movimentacoes");
        await criar("movimentacoes", {
          codigo, ativo_id: p.ativo_id, ativo_patrimonio: p.ativo_patrimonio || null,
          tipo: "ENVIO_MANUTENCAO", status: "EFETIVADA",
          origem_texto: origemTexto, destino_texto: "Manutenção",
          cliente_origem: anterior.cliente_id, unidade_origem: anterior.unidade_id,
          data: serverTimestamp(),
          usuario_id: eu().id || null, usuario_nome: eu().nome || null,
          motivo: `Defeito: ${p.tipo_defeito || p.descricao || "não especificado"}`,
          pendencia_id: p.id, pendencia_codigo: p.codigo || null
        });
        await registrarHistorico(p.ativo_id, "MANUTENCAO", "Enviado para manutenção",
          `${p.tipo_defeito || ""} ${p.descricao || ""}`.trim(), { local_anterior: anterior, movimentacao_codigo: codigo });
        await fecharPendencia(p, "RESOLVIDA", "Equipamento enviado para manutenção.");
        toast("Equipamento enviado para manutenção.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });

    el.querySelector("#df-local")?.addEventListener("click", async e => {
      const obs = el.querySelector("#df-obs").value.trim();
      if (obs.length < 5) return toast("Descreva o reparo realizado.", "warn");
      const b = e.currentTarget; b.disabled = true;
      try {
        if (p.ativo_id) await registrarHistorico(p.ativo_id, "MANUTENCAO", "Reparo realizado no local", obs,
          { pendencia_id: p.id, pendencia_codigo: p.codigo || null });
        await fecharPendencia(p, "RESOLVIDA", `Resolvido no local. ${obs}`);
        toast("Defeito resolvido no local.", "ok");
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });

    el.querySelector("#df-recolher")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        const codigo = await proximoCodigo("recolhimentos");
        const recId = await criar("recolhimentos", {
          codigo, ativo_id: p.ativo_id, ativo_patrimonio: p.ativo_patrimonio || null,
          cliente_id: ativo?.cliente_id || null, unidade_id: ativo?.unidade_id || null,
          motivo: "Defeito",
          observacao: `${p.tipo_defeito || ""} ${p.descricao || ""} ${el.querySelector("#df-obs").value.trim()}`.trim(),
          etapa: "AGUARDANDO", etapa_em: serverTimestamp(),
          origem_texto: ativo ? descreverLocal(ativo) : null,
          solicitado_por: eu().id || null, solicitado_por_nome: eu().nome || null,
          criado_em: serverTimestamp()
        });
        if (p.ativo_id) {
          await atualizar("ativos", p.ativo_id, { status: "AGUARDANDO_RECOLHIMENTO" });
          await registrarHistorico(p.ativo_id, "RECOLHIMENTO", "Recolhimento programado por defeito",
            p.descricao || "", { recolhimento_id: recId, recolhimento_codigo: codigo });
        }
        await fecharPendencia(p, "RESOLVIDA", `Recolhimento ${codigo} programado por defeito.`);
        toast("Recolhimento registrado.", "ok", codigo);
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); b.disabled = false; }
    });
  }};
}

/* ---------- CADASTRO PENDENTE ---------- */
function dadosColetados(p) {
  const d = p.dados_coletados || {};
  return {
    categoria: d.categoria ?? p.categoria ?? null,
    fabricante: d.fabricante ?? p.fabricante ?? null,
    modelo: d.modelo ?? p.modelo ?? null,
    numero_serie: d.numero_serie ?? p.numero_serie ?? null,
    patrimonio: d.patrimonio_visivel ?? p.patrimonio_visivel ?? p.ativo_patrimonio ?? null,
    foto_url: d.foto_url ?? p.foto_url ?? null,
    local_texto: p.local_encontrado_texto || descreverLocal({
      cliente_id: p.cliente_encontrado || p.cliente_id, unidade_id: p.unidade_encontrada || p.unidade_id,
      setor_id: p.setor_encontrado, local_id: p.local_encontrado })
  };
}

async function cadastroPendente(p, ctx) {
  const d = dadosColetados(p);
  const corpo = `
    <div class="aviso info"><div><b>Equipamento encontrado em campo sem cadastro</b>
      Confira os dados coletados pelo técnico antes de criar o ativo ou vincular a um já existente.</div></div>
    <div class="card card-pad" style="margin-top:12px">
      ${linhaDado("Categoria", esc(d.categoria ? rotuloDeId("categorias", d.categoria) : "—"))}
      ${linhaDado("Fabricante / Modelo", esc([d.fabricante, d.modelo].filter(Boolean).join(" ") || "—"))}
      ${linhaDado("Número de série", `<span class="mono">${esc(d.numero_serie || "—")}</span>`)}
      ${linhaDado("Patrimônio visível na etiqueta", `<span class="mono">${esc(d.patrimonio || "—")}</span>`)}
      ${linhaDado("Local encontrado", esc(d.local_texto))}
    </div>
    ${foto(d.foto_url)}
    ${ctx.podeAgir ? `<div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo verde" id="cp-novo">${ico("plus", 22)}Cadastrar como novo ativo</button>
      <button class="btn-campo azul" id="cp-vincular">${ico("search", 22)}Vincular a ativo existente</button>
    </div>
    <div id="cp-busca" style="margin-top:13px"></div>` : ""}`;

  return { corpo, ligar(el) {
    const localEncontrado = {
      cliente_id: p.cliente_encontrado || p.cliente_id || null,
      unidade_id: p.unidade_encontrada || p.unidade_id || null,
      setor_id: p.setor_encontrado || null,
      local_id: p.local_encontrado || null
    };

    el.querySelector("#cp-novo")?.addEventListener("click", () => {
      abrirEditor("ativos", null, {
        valoresIniciais: {
          patrimonio_newpc: d.patrimonio || "",
          categoria: d.categoria || "",
          fabricante: d.fabricante || "",
          modelo: d.modelo || "",
          numero_serie: d.numero_serie || "",
          status: "EM_USO",
          ...localEncontrado
        },
        aoSalvar: async novoId => {
          await registrarHistorico(novoId, "CADASTRO", "Cadastrado a partir de pendência de inventário",
            `Pendência ${p.codigo || ""} · ${d.local_texto}`, { pendencia_id: p.id });
          await fecharPendencia({ ...p, ativo_id: p.ativo_id || novoId }, "RESOLVIDA",
            `Ativo cadastrado a partir dos dados coletados em campo.`, { ativo_id: p.ativo_id || novoId });
          toast("Ativo cadastrado e pendência resolvida.", "ok");
          ctx.fim();
        }
      });
    });

    el.querySelector("#cp-vincular")?.addEventListener("click", () => {
      const box = el.querySelector("#cp-busca");
      box.innerHTML = `<div class="card card-pad">
        <div class="campo"><label>Patrimônio ou número de série do ativo já cadastrado</label>
          <div style="display:flex;gap:8px">
            <input class="inp mono" id="cp-cod" placeholder="${esc(C.APP?.prefixoQR || "NEWPC-")}000123" autocapitalize="characters">
            <button class="btn p" id="cp-buscar" style="flex:0 0 auto">${ico("search", 15)}Buscar</button>
          </div></div>
        <div id="cp-res" style="margin-top:11px"></div></div>`;
      const res = box.querySelector("#cp-res");
      box.querySelector("#cp-buscar").onclick = async () => {
        const cod = box.querySelector("#cp-cod").value.trim();
        if (!cod) return;
        res.innerHTML = carregando("Procurando…");
        const a = await acharAtivoPorCodigo(cod);
        if (!a) { res.innerHTML = `<div class="aviso warn"><div>Nenhum ativo encontrado para "${esc(cod)}".</div></div>`; return; }
        res.innerHTML = `<div class="aviso ok"><div><b>${esc(a.patrimonio_newpc)}</b> ·
          ${esc([a.fabricante, a.modelo].filter(Boolean).join(" "))}<br>
          Local atual: ${esc(descreverLocal(a))}</div></div>
          <button class="btn p bloco" id="cp-confirmar" style="margin-top:10px">
            ${ico("check", 15)}Vincular e atualizar para o local encontrado</button>`;
        res.querySelector("#cp-confirmar").onclick = async e => {
          const b = e.currentTarget; b.disabled = true;
          try {
            await atualizar("ativos", a.id, localEncontrado);
            await registrarHistorico(a.id, "PENDENCIA", "Vinculado a cadastro pendente de inventário",
              `Pendência ${p.codigo || ""} · ${d.local_texto}`, { pendencia_id: p.id });
            await fecharPendencia({ ...p, ativo_id: a.id }, "RESOLVIDA",
              `Vinculado ao ativo ${a.patrimonio_newpc} e localização atualizada.`,
              { ativo_id: a.id, ativo_patrimonio: a.patrimonio_newpc || null });
            toast("Pendência vinculada ao ativo existente.", "ok");
            ctx.fim();
          } catch (err) { console.error(err); toast(err.message || "Falha ao vincular.", "err"); b.disabled = false; }
        };
      };
    });
  }};
}

/* ---------- MOVIMENTAÇÃO AGUARDANDO APROVAÇÃO ---------- */
async function movimentacaoPendente(p, ctx) {
  const mov = p.movimentacao_id ? await obter("movimentacoes", p.movimentacao_id) : null;
  if (!mov) return { corpo: `<div class="aviso warn"><div>A movimentação vinculada não foi encontrada.</div></div>` };
  const podeAprovar = pode("movimentacao.aprovar") && !["EFETIVADA", "REJEITADA", "CANCELADA"].includes(mov.status);
  const corpo = `
    <div class="card card-pad">
      ${linhaDado("Movimentação", `<span class="mono">${esc(mov.codigo || "—")}</span> ·
        ${esc(C.labelDe(C.TIPO_MOVIMENTACAO, mov.tipo))} · ${badge(C.STATUS_MOVIMENTACAO, mov.status)}`)}
      ${linhaDado("Sai de", esc(mov.origem_texto || "—"))}
      ${linhaDado("Vai para", `<b>${esc(mov.destino_texto || "—")}</b>`)}
      ${linhaDado("Motivo", esc(mov.motivo || "—"))}
      ${linhaDado("Solicitado por", `${esc(mov.usuario_nome || "—")} · ${dataBR(mov.data, true)}`)}
    </div>
    ${podeAprovar ? `<div class="aviso info" style="margin-top:12px"><div>
      Ao aprovar, a localização do equipamento é atualizada na hora e o histórico registrado.</div></div>
      <div class="grade-campo" style="margin-top:13px">
        <button class="btn-campo vermelho" id="mp-rejeitar">${ico("x", 22)}Rejeitar</button>
        <button class="btn-campo verde" id="mp-aprovar">${ico("check", 22)}Aprovar transferência</button>
      </div>` : ""}`;

  return { corpo, ligar(el) {
    el.querySelector("#mp-aprovar")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try {
        await aprovarMovimentacao(mov);
        toast("Transferência aprovada e aplicada no equipamento.", "ok");
        window.NEWPC_atualizarAlertas && window.NEWPC_atualizarAlertas();
        ctx.fim();
      } catch (err) { console.error(err); toast(err.message || "Falha ao aprovar.", "err"); b.disabled = false; }
    });
    el.querySelector("#mp-rejeitar")?.addEventListener("click", async e => {
      const caixa = document.createElement("div");
      caixa.innerHTML = `<div class="campo"><label>Motivo da rejeição <span class="req">*</span></label>
        <textarea class="inp" id="mp-motivo"></textarea></div>`;
      modal({ titulo: "Rejeitar transferência", tamanho: "p", corpo: caixa, acoes: [
        { texto: "Cancelar" },
        { texto: "Rejeitar", classe: "d", aoClicar: async () => {
          const t = caixa.querySelector("#mp-motivo").value.trim();
          if (t.length < 5) { toast("Descreva o motivo.", "warn"); return false; }
          await rejeitarMovimentacao(mov, t);
          toast("Transferência rejeitada.", "ok");
          ctx.fim();
        }}
      ]});
    });
  }};
}

/* ---------- RECOLHIMENTO PENDENTE ---------- */
async function recolhimentoPendente(p, ctx) {
  const rec = p.recolhimento_id ? await obter("recolhimentos", p.recolhimento_id) : null;
  const corpo = `
    ${rec ? `<div class="card card-pad">
      ${linhaDado("Recolhimento", `<span class="mono">${esc(rec.codigo || "—")}</span> ·
        ${badge(C.FLUXO_RECOLHIMENTO, rec.etapa)}`)}
      ${linhaDado("Motivo", esc(rec.motivo || "—"))}
      ${linhaDado("Origem", esc(rec.origem_texto || descreverLocal(rec)))}
    </div>` : `<div class="aviso info"><div>${esc(p.descricao || "Recolhimento pendente de providência.")}</div></div>`}
    <div class="aviso info" style="margin-top:12px"><div>
      O andamento das etapas é feito no painel de Recolhimentos.</div></div>
    <div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo azul ${ctx.podeAgir ? "" : "full"}" id="rp-painel">${ico("box", 22)}Abrir painel de recolhimentos</button>
      ${ctx.podeAgir ? `<button class="btn-campo verde" id="rp-resolver">${ico("check", 22)}Marcar como resolvida</button>` : ""}
    </div>`;
  return { corpo, ligar(el) {
    el.querySelector("#rp-painel").onclick = () => { location.hash = "#/recolhimentos"; };
    el.querySelector("#rp-resolver")?.addEventListener("click", async e => {
      e.currentTarget.disabled = true;
      await fecharPendencia(p, "RESOLVIDA", "Recolhimento providenciado.");
      toast("Pendência resolvida.", "ok");
      ctx.fim();
    });
  }};
}

/* ---------- FALLBACK ---------- */
async function generica(p, ctx) {
  const corpo = `<div class="aviso info"><div>${esc(p.descricao || "Sem descrição registrada.")}</div></div>
    ${foto(p.foto_url)}
    <div class="campo" style="margin-top:13px"><label>Decisão</label>
      <textarea class="inp" id="gn-obs"></textarea></div>
    ${ctx.podeAgir ? `<div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo cinza" id="gn-desc">${ico("x", 22)}Descartar</button>
      <button class="btn-campo verde" id="gn-res">${ico("check", 22)}Resolver</button>
    </div>` : ""}`;
  return { corpo, ligar(el) {
    const gravar = async (status, e) => {
      const t = el.querySelector("#gn-obs").value.trim();
      if (t.length < 5) return toast("Descreva a decisão.", "warn");
      e.currentTarget.disabled = true;
      await fecharPendencia(p, status, t);
      toast("Pendência atualizada.", "ok");
      ctx.fim();
    };
    el.querySelector("#gn-res")?.addEventListener("click", e => gravar("RESOLVIDA", e));
    el.querySelector("#gn-desc")?.addEventListener("click", e => gravar("DESCARTADA", e));
  }};
}

/* ============================================================
 *  ROTA: MANUTENÇÃO
 * ============================================================ */
const STATUS_MANUTENCAO = ["EM_MANUTENCAO", "AGUARDANDO_PECA"];

export async function manutencao(alvo) {
  alvo.innerHTML = cabecalhoPagina("Manutenção",
    "Equipamentos parados em conserto ou aguardando peça — com o tempo de parada de cada um.",
    `<button class="btn" id="mn-exp">${ico("down", 15)}Exportar</button>`)
    + `<div class="grade g4" id="mn-kpis"></div>
       <div id="mn-corpo" style="margin-top:15px">${carregando()}</div>`;

  let listaAtual = [];
  alvo.querySelector("#mn-exp").onclick = () => {
    baixarCSV("manutencao",
      ["Patrimônio", "Categoria", "Fabricante", "Modelo", "Série", "Situação", "Defeito relatado",
       "Dias parado", "Proprietário", "Cliente de origem"],
      listaAtual.map(x => [
        x.ativo.patrimonio_newpc || "", rotuloDeId("categorias", x.ativo.categoria),
        x.ativo.fabricante || "", x.ativo.modelo || "", x.ativo.numero_serie || "",
        C.labelDe(C.STATUS_ATIVO, x.ativo.status), x.defeito,
        x.dias ?? "", proprietarioDe(x.ativo), x.clienteOrigem
      ]));
    toast(`${listaAtual.length} equipamento(s) exportado(s).`, "ok");
  };

  function proprietarioDe(a) {
    if (a.fornecedor_id) return rotuloDeId("fornecedores", a.fornecedor_id);
    return C.labelDe(C.ORIGEM_ATIVO, a.origem_ativo);
  }

  async function ultimaOcorrencia(ativoId) {
    try {
      /* "data" é o campo gravado pela ocorrência e é o que está indexado */
      const { dados } = await buscar("ocorrencias", [["ativo_id", "==", ativoId]], ["data", "desc"], 1);
      return dados[0] || null;
    } catch {
      try {
        const { dados } = await buscar("ocorrencias", [["ativo_id", "==", ativoId]], null, 5);
        return dados[0] || null;
      } catch { return null; }
    }
  }

  async function carregar() {
    const corpo = alvo.querySelector("#mn-corpo");
    corpo.innerHTML = carregando();
    let ativos = [];
    try {
      const r = await buscar("ativos", [["status", "in", STATUS_MANUTENCAO]], null, 500);
      ativos = r.dados;
    } catch (e) { corpo.innerHTML = avisoConsulta(e); return; }

    const [nManut, nPeca] = await Promise.all([
      contar("ativos", [["status", "==", "EM_MANUTENCAO"]]).catch(() =>
        ativos.filter(a => a.status === "EM_MANUTENCAO").length),
      contar("ativos", [["status", "==", "AGUARDANDO_PECA"]]).catch(() =>
        ativos.filter(a => a.status === "AGUARDANDO_PECA").length)
    ]);

    const ocorrencias = await Promise.all(ativos.map(a => ultimaOcorrencia(a.id)));
    listaAtual = ativos.map((a, i) => {
      const o = ocorrencias[i];
      return {
        ativo: a,
        dias: diasDesde(a.manutencao_desde || a.atualizado_em),
        defeito: [o?.tipo_defeito, o?.descricao].filter(Boolean).join(" — ") || "Não informado",
        criticidade: o?.criticidade || null,
        clienteOrigem: a.cliente_id ? rotuloDeId("clientes", a.cliente_id)
          : (a.local_anterior?.cliente_id ? rotuloDeId("clientes", a.local_anterior.cliente_id) : "Estoque NEWPC")
      };
    }).sort((x, y) => (y.dias ?? 0) - (x.dias ?? 0));

    const parados30 = listaAtual.filter(x => (x.dias ?? 0) > 30).length;
    const maisAntigo = listaAtual[0]?.dias ?? 0;

    alvo.querySelector("#mn-kpis").innerHTML =
      kpi("Em manutenção", nManut, { cor: "laranja" }) +
      kpi("Aguardando peça", nPeca, { cor: "amarelo" }) +
      kpi("Parados há mais de 30 dias", parados30, { cor: parados30 ? "vermelho" : "verde" }) +
      kpi("Maior tempo parado", `${maisAntigo} dia(s)`, { cor: "azul" });

    if (!listaAtual.length) {
      corpo.innerHTML = vazio("Nenhum equipamento em manutenção",
        "Quando um equipamento for enviado para conserto, ele aparece aqui.");
      return;
    }

    const acoes = x => `<div class="acoes">
      <button class="btn sm v" data-ret="${x.ativo.id}">${ico("arrows", 13)}Retornar</button>
      <button class="btn sm" data-peca="${x.ativo.id}">${ico("clock", 13)}
        ${x.ativo.status === "AGUARDANDO_PECA" ? "Em manutenção" : "Aguardando peça"}</button>
      ${ehAdmin() ? `<button class="btn sm d" data-baixa="${x.ativo.id}">${ico("trash", 13)}Baixa</button>` : ""}
    </div>`;

    corpo.innerHTML = `
      <div class="tab-wrap responsiva"><table class="tab"><thead><tr>
        <th>Patrimônio</th><th>Equipamento</th><th>Defeito relatado</th><th>Parado há</th>
        <th>Proprietário</th><th>Cliente de origem</th><th>Situação</th><th></th>
      </tr></thead><tbody>
        ${listaAtual.map(x => `<tr data-ativo="${x.ativo.id}">
          <td><span class="mono">${esc(x.ativo.patrimonio_newpc || "—")}</span></td>
          <td>${esc([x.ativo.fabricante, x.ativo.modelo].filter(Boolean).join(" ") || "—")}<br>
            <small style="color:var(--texto-2)">${esc(rotuloDeId("categorias", x.ativo.categoria))}</small></td>
          <td>${esc(x.defeito)}${x.criticidade ? " " + badge(C.CRITICIDADE, x.criticidade) : ""}</td>
          <td class="num">${x.dias == null ? "—" : `${x.dias} dia(s)`}</td>
          <td>${esc(proprietarioDe(x.ativo))}</td>
          <td>${esc(x.clienteOrigem)}</td>
          <td>${badgeStatusAtivo(x.ativo.status)}</td>
          <td>${acoes(x)}</td>
        </tr>`).join("")}
      </tbody></table></div>

      <div class="lista-cards">
        ${listaAtual.map(x => `<div class="item-card">
          <div class="l1"><b class="mono">${esc(x.ativo.patrimonio_newpc || "—")}</b>${badgeStatusAtivo(x.ativo.status)}</div>
          <div class="l2">${esc([x.ativo.fabricante, x.ativo.modelo].filter(Boolean).join(" ") || "—")}</div>
          <div class="l2" style="color:var(--texto-2)">${esc(x.defeito)}</div>
          <div class="l3">${x.dias == null ? "" : `${x.dias} dia(s) parado`} ·
            ${esc(proprietarioDe(x.ativo))} · ${esc(x.clienteOrigem)}</div>
          ${acoes(x)}
        </div>`).join("")}
      </div>`;

    corpo.querySelectorAll("[data-ret]").forEach(b => b.onclick = () =>
      retornarDeManutencao(listaAtual.find(x => x.ativo.id === b.dataset.ret).ativo, carregar));
    corpo.querySelectorAll("[data-peca]").forEach(b => b.onclick = () =>
      alternarAguardandoPeca(listaAtual.find(x => x.ativo.id === b.dataset.peca).ativo, carregar));
    corpo.querySelectorAll("[data-baixa]").forEach(b => b.onclick = () =>
      encaminharBaixa(listaAtual.find(x => x.ativo.id === b.dataset.baixa).ativo, carregar));
  }

  await carregar();
}

/* Retorno de manutenção: volta para o cliente de origem ou entra no estoque. */
async function retornarDeManutencao(ativo, aoFim) {
  let anterior = ativo.local_anterior || null;
  /* registros antigos gravaram texto neste campo; texto não pode ser reaplicado no ativo */
  if (typeof anterior === "string") anterior = null;
  if (!anterior) {
    /* fallback: procura no histórico o envio para manutenção */
    const h = await historicoDoAtivo(ativo.id, 60);
    anterior = h.find(x => x.local_anterior)?.local_anterior || null;
  }
  const textoAnterior = ativo.local_anterior_texto || (anterior ? descreverLocal(anterior) : null);

  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso info"><div><b>${esc(ativo.patrimonio_newpc || "")}</b> está saindo da manutenção.
      Escolha para onde ele vai — a movimentação fica registrada no histórico.</div></div>
    <div class="grade-campo" style="margin-top:13px">
      <button class="btn-campo verde" id="rt-cliente" ${anterior ? "" : "disabled"}>
        ${ico("building", 22)}Voltar ao cliente de origem</button>
      <button class="btn-campo azul" id="rt-estoque">${ico("box", 22)}Entrar no estoque (Disponível)</button>
    </div>
    <div class="aviso ${anterior ? "ok" : "warn"}" style="margin-top:12px"><div>${anterior
      ? `Localização anterior registrada: <b>${esc(textoAnterior)}</b>`
      : "Não há localização anterior registrada para este equipamento. Ele pode entrar no estoque e ser transferido depois."
    }</div></div>
    <div class="campo" style="margin-top:11px"><label>Observação do retorno</label>
      <textarea class="inp" id="rt-obs" placeholder="O que foi feito na manutenção"></textarea></div>`;

  const m = modal({ titulo: "Retornar de manutenção", corpo, acoes: [{ texto: "Cancelar" }] });

  async function gravar(destino, destinoTexto, dadosAtivo) {
    const obs = corpo.querySelector("#rt-obs").value.trim();
    const codigo = await proximoCodigo("movimentacoes");
    await atualizar("ativos", ativo.id, { ...dadosAtivo, local_anterior: null, local_anterior_texto: null, manutencao_desde: null });
    await criar("movimentacoes", {
      codigo, ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc || null,
      tipo: "RETORNO_MANUTENCAO", status: "EFETIVADA",
      origem_texto: "Manutenção", destino_texto: destinoTexto,
      cliente_destino: destino?.cliente_id || null, unidade_destino: destino?.unidade_id || null,
      setor_destino: destino?.setor_id || null, local_destino: destino?.local_id || null,
      data: serverTimestamp(),
      usuario_id: eu().id || null, usuario_nome: eu().nome || null,
      motivo: obs || "Retorno de manutenção"
    });
    await registrarHistorico(ativo.id, "MANUTENCAO", "Retorno de manutenção",
      `${destinoTexto}${obs ? " · " + obs : ""}`, { movimentacao_codigo: codigo });
    toast("Retorno de manutenção registrado.", "ok", codigo);
    m.fechar();
    aoFim && aoFim();
  }

  corpo.querySelector("#rt-cliente").onclick = async e => {
    e.currentTarget.disabled = true;
    try {
      await gravar(anterior, textoAnterior || descreverLocal(anterior), { ...anterior, status: "EM_USO" });
    } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); e.currentTarget.disabled = false; }
  };
  corpo.querySelector("#rt-estoque").onclick = async e => {
    e.currentTarget.disabled = true;
    try {
      await gravar(null, "Estoque NEWPC", {
        status: "DISPONIVEL",
        cliente_id: null, contrato_cliente_id: null, unidade_id: null, setor_id: null, local_id: null
      });
    } catch (err) { console.error(err); toast(err.message || "Falha ao gravar.", "err"); e.currentTarget.disabled = false; }
  };
}

async function alternarAguardandoPeca(ativo, aoFim) {
  const paraPeca = ativo.status !== "AGUARDANDO_PECA";
  const corpo = document.createElement("div");
  corpo.innerHTML = `<div class="aviso info"><div>${paraPeca
    ? "O equipamento fica marcado como <b>Aguardando Peça</b> — útil para explicar o tempo parado."
    : "O equipamento volta para <b>Em Manutenção</b>."}</div></div>
    <div class="campo" style="margin-top:12px"><label>Observação</label>
      <textarea class="inp" id="ap-obs" placeholder="Peça solicitada, prazo do fornecedor…"></textarea></div>`;
  modal({
    titulo: paraPeca ? "Aguardando peça" : "Voltar para manutenção", tamanho: "p", corpo,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Confirmar", classe: "p", icone: "check", aoClicar: async () => {
        const obs = corpo.querySelector("#ap-obs").value.trim();
        await atualizar("ativos", ativo.id, { status: paraPeca ? "AGUARDANDO_PECA" : "EM_MANUTENCAO" });
        await registrarHistorico(ativo.id, "MANUTENCAO",
          paraPeca ? "Aguardando peça" : "Retomou a manutenção", obs);
        toast("Situação atualizada.", "ok");
        aoFim && aoFim();
      }}
    ]
  });
}

async function encaminharBaixa(ativo, aoFim) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso warn"><div><b>O equipamento sai do inventário operacional</b>
      Ao dar baixa, o vínculo com cliente, contrato comercial, unidade, setor e sala é removido,
      para o equipamento não continuar aparecendo como instalado. O histórico é preservado.</div></div>
    <div class="campo" style="margin-top:12px"><label>Justificativa da baixa <span class="req">*</span></label>
      <textarea class="inp" id="bx-obs" placeholder="Laudo técnico, inviabilidade de reparo, custo…"></textarea></div>`;
  modal({
    titulo: "Encaminhar para baixa", corpo,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Registrar baixa", classe: "d", icone: "trash", aoClicar: async () => {
        const obs = corpo.querySelector("#bx-obs").value.trim();
        if (obs.length < 15) { toast("Descreva a justificativa da baixa.", "warn"); return false; }
        if (!await confirmar("Confirmar baixa?",
          `<b>${esc(ativo.patrimonio_newpc || "")}</b> passará para <b>Baixado</b>.
           A decisão fica registrada em auditoria com o seu nome.`, "Dar baixa", true)) return false;
        const origemTexto = descreverLocal(ativo);
        const codigo = await proximoCodigo("movimentacoes");
        await atualizar("ativos", ativo.id, {
          status: "BAIXADO",
          cliente_id: null, contrato_cliente_id: null, unidade_id: null, setor_id: null, local_id: null,
          local_anterior: null, local_anterior_texto: null, manutencao_desde: null
        });
        await criar("movimentacoes", {
          codigo, ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc || null,
          tipo: "BAIXA", status: "EFETIVADA",
          origem_texto: origemTexto, destino_texto: "Baixa",
          data: serverTimestamp(),
          usuario_id: eu().id || null, usuario_nome: eu().nome || null,
          motivo: obs
        });
        await registrarHistorico(ativo.id, "BAIXA", "Baixa após manutenção",
          `${obs} · alocação em cliente removida (origem: ${origemTexto})`, { movimentacao_codigo: codigo });
        toast("Baixa registrada.", "warn", codigo);
        aoFim && aoFim();
      }}
    ]
  });
}
