/* MÓDULO DE INVENTÁRIO — o coração do sistema.
 *
 * Princípio de UX (item 2 do briefing): o inventário trabalha POR EXCEÇÃO.
 * Equipamento no lugar certo = escanear, tocar em ENCONTRADO E CORRETO, próximo.
 * Nenhum formulário. Só quando há divergência é que pedimos informação.
 *
 * A sessão de inventário mantém em memória a lista de ativos esperados daquele local,
 * carregada uma única vez. Cada leitura resolve localmente, sem ida ao banco — só a
 * gravação do item vai para o Firestore. Isso é o que torna a conferência rápida em campo.
 */
import {
  obter, buscar, contar, criar, atualizar, listaRef, rotulo, rotuloDeId,
  descreverLocal, proximoCodigo, registrarHistorico, parametros, serverTimestamp
} from "../store.js";
import {
  ico, esc, toast, modal, confirmar, cabecalhoPagina, vazio, carregando, kpi,
  barraProgresso, badge, badgeStatusAtivo, dataBR, pct, num, baixarCSV
} from "../ui.js";
import { sessao, pode } from "../auth.js";
import { irPara } from "../router.js";
import { abrirScanner, acharAtivoPorCodigo, normalizarCodigo } from "./scanner.js";
import { enviarAnexo } from "./ativos.js";
import * as C from "../config.js";

/* Estado da sessão ativa. Vive só enquanto a tela está aberta. */
let S = null;

export async function inventario(alvo, ctx) {
  if (ctx.id === "novo") return telaNovo(alvo, ctx.params || {});
  if (ctx.id) return telaExecucao(alvo, ctx.id);
  return telaLista(alvo);
}

/* ============================================================
   1. LISTA DE INVENTÁRIOS
   ============================================================ */
async function telaLista(alvo) {
  alvo.innerHTML = cabecalhoPagina("Inventário", "Sessões de conferência de equipamentos em campo",
    pode("inventario.executar")
      ? `<button class="btn v lg" id="inv-novo">${ico("scan", 18)}INICIAR INVENTÁRIO</button>` : "")
    + `<div id="inv-corpo">${carregando()}</div>`;

  alvo.querySelector("#inv-novo")?.addEventListener("click", () => irPara("inventario", "novo"));
  const corpo = alvo.querySelector("#inv-corpo");

  const [andamento, finalizados] = await Promise.all([
    buscar("inventarios", [["status", "in", ["EM_ANDAMENTO", "PAUSADO"]]], ["iniciado_em", "desc"], 20),
    buscar("inventarios", [["status", "in", ["FINALIZADO", "EM_REVISAO", "VALIDADO"]]], ["iniciado_em", "desc"], 25)
  ]).catch(async () => {
    // Sem índice composto: cai para consulta simples ordenada
    const t = await buscar("inventarios", [], ["iniciado_em", "desc"], 40);
    const emAnd = t.dados.filter(i => ["EM_ANDAMENTO", "PAUSADO"].includes(i.status));
    const fin = t.dados.filter(i => !["EM_ANDAMENTO", "PAUSADO"].includes(i.status));
    return [{ dados: emAnd }, { dados: fin }];
  });

  const cardInv = i => {
    const p = i.total_esperado ? pct(i.total_encontrado || 0, i.total_esperado) : 0;
    return `<div class="card card-pad" style="cursor:pointer" data-inv="${i.id}">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <span class="mono" style="font-weight:700;color:var(--marinho)">${esc(i.codigo)}</span>
        ${badge(C.STATUS_INVENTARIO, i.status)}
        <span style="margin-left:auto;font-size:12px;color:var(--texto-2)">${dataBR(i.iniciado_em, true)}</span>
      </div>
      <div style="margin-top:7px;font-size:14px;font-weight:600">${esc(rotuloDeId("unidades", i.unidade_id))}</div>
      <div style="font-size:12.5px;color:var(--texto-2)">${esc(rotuloDeId("clientes", i.cliente_id))}
        ${i.setor_id ? " · " + esc(rotuloDeId("setores", i.setor_id)) : ""}
        ${i.local_id ? " · " + esc(rotuloDeId("locais", i.local_id)) : ""}</div>
      <div style="margin-top:10px">${barraProgresso(p)}</div>
      <div style="display:flex;gap:12px;margin-top:7px;font-size:12px;color:var(--texto-2);flex-wrap:wrap">
        <span><b style="color:var(--verde)">${num(i.total_encontrado || 0)}</b> de ${num(i.total_esperado || 0)} conferidos</span>
        ${i.total_divergente ? `<span style="color:var(--laranja)"><b>${i.total_divergente}</b> divergente(s)</span>` : ""}
        ${i.total_nao_localizado ? `<span style="color:var(--vermelho)"><b>${i.total_nao_localizado}</b> não localizado(s)</span>` : ""}
        <span style="margin-left:auto">${esc(rotuloDeId("usuarios", i.responsavel_id))}</span>
      </div></div>`;
  };

  corpo.innerHTML = `
    ${andamento.dados.length ? `
      <h3 style="font-size:14px;color:var(--marinho);margin:4px 0 10px">Em andamento</h3>
      <div class="grade g3" style="margin-bottom:24px">${andamento.dados.map(cardInv).join("")}</div>` : ""}
    <h3 style="font-size:14px;color:var(--marinho);margin:4px 0 10px">Inventários realizados</h3>
    ${finalizados.dados.length
      ? `<div class="grade g3">${finalizados.dados.map(cardInv).join("")}</div>`
      : vazio("Nenhum inventário realizado ainda",
              "Selecione um cliente e uma unidade para iniciar a primeira conferência.")}`;

  corpo.querySelectorAll("[data-inv]").forEach(el =>
    el.onclick = () => irPara("inventario", el.dataset.inv));
}

/* ============================================================
   2. NOVO INVENTÁRIO — seleção do escopo
   ============================================================ */
async function telaNovo(alvo, pre) {
  const [clientes, unidades, setores, locais] = await Promise.all(
    ["clientes", "unidades", "setores", "locais"].map(listaRef));

  alvo.innerHTML = cabecalhoPagina("Iniciar inventário", "Escolha onde a conferência será feita") + `
    <div class="card card-pad" style="max-width:620px">
      <div class="form-grade">
        <div class="campo w2"><label>Cliente <span class="req">*</span></label>
          <select class="inp" id="f-cli"><option value="">— selecione —</option>
            ${clientes.filter(c => c.ativo !== false).map(c =>
              `<option value="${c.id}" ${pre.cliente_id === c.id ? "selected" : ""}>${esc(rotulo("clientes", c))}</option>`).join("")}
          </select></div>
        <div class="campo w2"><label>Unidade <span class="req">*</span></label>
          <select class="inp" id="f-uni" disabled><option value="">— selecione o cliente primeiro —</option></select></div>
        <div class="campo"><label>Setor <span class="hint">(opcional)</span></label>
          <select class="inp" id="f-set" disabled><option value="">Toda a unidade</option></select></div>
        <div class="campo"><label>Sala / Local <span class="hint">(opcional)</span></label>
          <select class="inp" id="f-loc" disabled><option value="">Todo o setor</option></select></div>
      </div>
      <div id="f-previa" style="margin-top:14px"></div>
      <button class="btn v lg bloco" id="f-iniciar" style="margin-top:14px" disabled>
        ${ico("scan", 19)}INICIAR INVENTÁRIO</button>
      <p class="hint" style="margin-top:10px">O sistema vai carregar todos os equipamentos cadastrados
        neste local e você confere um a um pelo QR Code.</p>
    </div>`;

  const $ = s => alvo.querySelector(s);
  const cli = $("#f-cli"), uni = $("#f-uni"), set = $("#f-set"), loc = $("#f-loc"),
        previa = $("#f-previa"), btn = $("#f-iniciar");

  const encher = (sel, itens, colecao, textoVazio) => {
    sel.innerHTML = `<option value="">${textoVazio}</option>` +
      itens.map(i => `<option value="${i.id}">${esc(rotulo(colecao, i))}</option>`).join("");
    sel.disabled = !itens.length;
  };

  cli.onchange = () => {
    encher(uni, unidades.filter(u => u.cliente_id === cli.value && u.ativo !== false), "unidades", "— selecione —");
    set.innerHTML = `<option value="">Toda a unidade</option>`; set.disabled = true;
    loc.innerHTML = `<option value="">Todo o setor</option>`; loc.disabled = true;
    atualizarPrevia();
  };
  uni.onchange = () => {
    encher(set, setores.filter(s => s.unidade_id === uni.value), "setores", "Toda a unidade");
    loc.innerHTML = `<option value="">Todo o setor</option>`; loc.disabled = true;
    atualizarPrevia();
  };
  set.onchange = () => {
    encher(loc, locais.filter(l => l.setor_id === set.value), "locais", "Todo o setor");
    atualizarPrevia();
  };
  loc.onchange = atualizarPrevia;

  async function atualizarPrevia() {
    btn.disabled = !(cli.value && uni.value);
    if (!uni.value) { previa.innerHTML = ""; return; }
    previa.innerHTML = `<div class="aviso info"><span class="spin"></span><div>Verificando equipamentos…</div></div>`;
    const f = [["unidade_id", "==", uni.value]];
    if (set.value) f.push(["setor_id", "==", set.value]);
    if (loc.value) f.push(["local_id", "==", loc.value]);
    try {
      const n = await contar("ativos", f);
      previa.innerHTML = n
        ? `<div class="aviso info">${ico("cpu", 18)}<div><b>${num(n)} equipamento(s) esperado(s)</b>
            neste local, conforme o cadastro.</div></div>`
        : `<div class="aviso warn">${ico("alert", 18)}<div><b>Nenhum equipamento cadastrado aqui</b>
            Você ainda pode iniciar: tudo que for escaneado entrará como equipamento extra.</div></div>`;
    } catch (e) {
      previa.innerHTML = `<div class="aviso err"><div>Não foi possível verificar: ${esc(e.message)}</div></div>`;
    }
  }
  if (pre.cliente_id) { cli.dispatchEvent(new Event("change")); if (pre.unidade_id) { uni.value = pre.unidade_id; uni.dispatchEvent(new Event("change")); } }

  btn.onclick = async () => {
    btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      const filtros = [["unidade_id", "==", uni.value]];
      if (set.value) filtros.push(["setor_id", "==", set.value]);
      if (loc.value) filtros.push(["local_id", "==", loc.value]);
      const { dados: esperados } = await buscar("ativos", filtros, null, 3000);

      const codigo = await proximoCodigo("inventarios");
      const uniObj = unidades.find(u => u.id === uni.value);
      const id = await criar("inventarios", {
        codigo, cliente_id: cli.value, municipio_id: uniObj?.municipio_id || null,
        unidade_id: uni.value, setor_id: set.value || null, local_id: loc.value || null,
        responsavel_id: sessao.usuario.id, responsavel_nome: sessao.usuario.nome,
        iniciado_em: serverTimestamp(), finalizado_em: null, status: "EM_ANDAMENTO",
        total_esperado: esperados.length, total_encontrado: 0, total_divergente: 0,
        total_nao_localizado: 0, total_extra: 0, percentual: 0, observacoes: null
      });
      toast(`Inventário ${codigo} iniciado.`, "ok");
      irPara("inventario", id);
    } catch (e) {
      console.error(e); toast(e.message || "Não foi possível iniciar o inventário.", "err");
      btn.disabled = false; btn.innerHTML = `${ico("scan", 19)}INICIAR INVENTÁRIO`;
    }
  };
}

/* ============================================================
   3. EXECUÇÃO DO INVENTÁRIO
   ============================================================ */
async function telaExecucao(alvo, invId) {
  const inv = await obter("inventarios", invId);
  if (!inv) { alvo.innerHTML = vazio("Inventário não encontrado"); return; }

  /* Carrega esperados e já conferidos UMA vez. Daqui em diante tudo resolve em memória. */
  const filtros = [["unidade_id", "==", inv.unidade_id]];
  if (inv.setor_id) filtros.push(["setor_id", "==", inv.setor_id]);
  if (inv.local_id) filtros.push(["local_id", "==", inv.local_id]);

  const [{ dados: esperados }, { dados: itens }] = await Promise.all([
    buscar("ativos", filtros, null, 3000),
    buscar("inventario_itens", [["inventario_id", "==", invId]], null, 3000)
  ]);

  S = {
    inv, invId,
    esperados,                                   // ativos que deveriam estar aqui
    porId: new Map(esperados.map(a => [a.id, a])),
    conferidos: new Map(itens.map(i => [i.ativo_id, i])),
    extras: itens.filter(i => i.resultado === "ENCONTRADO_EXTRA" || i.resultado === "CADASTRO_PENDENTE"),
    finalizado: ["FINALIZADO", "EM_REVISAO", "VALIDADO"].includes(inv.status),
    params: await parametros()
  };

  render(alvo);
}

function metricas() {
  const vals = [...S.conferidos.values()];
  const conta = r => vals.filter(v => v.resultado === r).length;
  const conferidosEsperados = vals.filter(v => S.porId.has(v.ativo_id)).length;
  return {
    esperado: S.esperados.length,
    conferido: conferidosEsperados,
    pendente: S.esperados.length - conferidosEsperados,
    correto: conta("CORRETO"),
    divergente: conta("LOCAL_DIVERGENTE"),
    defeito: conta("DEFEITO"),
    naoLocalizado: conta("NAO_LOCALIZADO"),
    extra: conta("ENCONTRADO_EXTRA") + conta("CADASTRO_PENDENTE"),
    percentual: pct(conferidosEsperados, S.esperados.length)
  };
}

function render(alvo) {
  const m = metricas();
  const i = S.inv;
  const podeExecutar = pode("inventario.executar") && !S.finalizado;

  alvo.innerHTML = `
    <div class="pg-topo">
      <div>
        <h2>${esc(i.codigo)}</h2>
        <p>${esc(rotuloDeId("clientes", i.cliente_id))} · ${esc(rotuloDeId("unidades", i.unidade_id))}
          ${i.setor_id ? " · " + esc(rotuloDeId("setores", i.setor_id)) : ""}
          ${i.local_id ? " · " + esc(rotuloDeId("locais", i.local_id)) : ""}</p>
      </div>
      <div class="pg-acoes">
        ${badge(C.STATUS_INVENTARIO, i.status)}
        ${podeExecutar ? `<button class="btn" id="iv-pausar">${ico("clock", 15)}Pausar</button>
          <button class="btn m" id="iv-finalizar">${ico("check", 15)}Finalizar</button>` : ""}
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <b style="font-size:15px;color:var(--marinho)">${m.conferido} de ${m.esperado} conferidos</b>
        <span style="font-size:22px;font-weight:800;color:${m.percentual === 100 ? "var(--verde)" : "var(--petroleo)"}">${m.percentual}%</span>
      </div>
      ${barraProgresso(m.percentual, true)}
    </div>

    <div class="grade g5" style="margin-bottom:16px">
      ${kpi("Esperados", m.esperado)}
      ${kpi("Conferidos", m.conferido, { cor: "verde" })}
      ${kpi("Pendentes", m.pendente, { cor: m.pendente ? "amarelo" : "" })}
      ${kpi("Divergentes", m.divergente, { cor: m.divergente ? "laranja" : "" })}
      ${kpi("Com defeito", m.defeito, { cor: m.defeito ? "vermelho" : "" })}
      ${kpi("Extras encontrados", m.extra, { cor: m.extra ? "azul" : "" })}
    </div>

    ${podeExecutar ? `
      <button class="btn v bloco" id="iv-scan"
        style="height:66px;font-size:18px;margin-bottom:16px;gap:11px">
        ${ico("scan", 26)}ESCANEAR QR CODE</button>` : ""}

    <div class="abas" id="iv-abas">
      <div class="aba on" data-t="pendentes">Pendentes <b>(${m.pendente})</b></div>
      <div class="aba" data-t="conferidos">Conferidos <b>(${m.conferido})</b></div>
      <div class="aba" data-t="ocorrencias">Ocorrências <b>(${m.divergente + m.defeito})</b></div>
      <div class="aba" data-t="extras">Extras <b>(${m.extra})</b></div>
    </div>
    <div id="iv-painel"></div>`;

  alvo.querySelector("#iv-scan")?.addEventListener("click", () => abrirLeitura(alvo));
  alvo.querySelector("#iv-pausar")?.addEventListener("click", async () => {
    const novo = S.inv.status === "PAUSADO" ? "EM_ANDAMENTO" : "PAUSADO";
    await atualizar("inventarios", S.invId, { status: novo });
    S.inv.status = novo;
    toast(novo === "PAUSADO" ? "Inventário pausado." : "Inventário retomado.", "ok");
    render(alvo);
  });
  alvo.querySelector("#iv-finalizar")?.addEventListener("click", () => finalizar(alvo));

  alvo.querySelectorAll("#iv-abas .aba").forEach(t => t.onclick = () => {
    alvo.querySelectorAll("#iv-abas .aba").forEach(x => x.classList.toggle("on", x === t));
    painel(alvo, t.dataset.t);
  });
  painel(alvo, "pendentes");
}

function painel(alvo, aba) {
  const box = alvo.querySelector("#iv-painel");
  const linha = (a, extra = "") => `
    <div class="item-card" data-ativo="${a.id}">
      <div class="l1"><b class="mono">${esc(a.patrimonio_newpc)}</b>${extra}</div>
      <div class="l2">${esc([a.fabricante, a.modelo].filter(Boolean).join(" "))}</div>
      <div class="l3">${esc(rotuloDeId("categorias", a.categoria))}
        ${a.numero_serie ? ` · <span class="mono">${esc(a.numero_serie)}</span>` : ""}
        ${a.local_id ? ` · ${esc(rotuloDeId("locais", a.local_id))}` : ""}</div>
    </div>`;

  if (aba === "pendentes") {
    const pend = S.esperados.filter(a => !S.conferidos.has(a.id));
    box.innerHTML = pend.length
      ? `<div class="grade g3">${pend.map(a => linha(a, `<span class="st st-amarelo">Pendente</span>`)).join("")}</div>`
      : `<div class="aviso ok">${ico("check", 18)}<div><b>Todos os equipamentos esperados foram conferidos.</b>
          Você já pode finalizar o inventário.</div></div>`;
  }

  else if (aba === "conferidos") {
    const lista = [...S.conferidos.values()].filter(i => S.porId.has(i.ativo_id));
    box.innerHTML = lista.length ? `<div class="tab-wrap"><table class="tab"><thead><tr>
        <th>Patrimônio</th><th>Equipamento</th><th>Resultado</th><th>Hora</th><th>Técnico</th></tr></thead><tbody>
        ${lista.sort((a, b) => (b.data_hora?.seconds || 0) - (a.data_hora?.seconds || 0)).map(i => {
          const a = S.porId.get(i.ativo_id) || {};
          return `<tr class="click" data-ativo="${i.ativo_id}">
            <td><span class="mono">${esc(i.ativo_patrimonio || a.patrimonio_newpc)}</span></td>
            <td>${esc([a.fabricante, a.modelo].filter(Boolean).join(" "))}</td>
            <td>${badge(C.RESULTADO_ITEM, i.resultado)}</td>
            <td>${dataBR(i.data_hora, true)}</td>
            <td>${esc(i.tecnico_nome || "—")}</td></tr>`;
        }).join("")}</tbody></table></div>`
      : vazio("Nenhum equipamento conferido ainda", "Toque em ESCANEAR QR CODE para começar.");
  }

  else if (aba === "ocorrencias") {
    const oc = [...S.conferidos.values()].filter(i => ["LOCAL_DIVERGENTE", "DEFEITO"].includes(i.resultado));
    box.innerHTML = oc.length ? `<div class="grade g2">${oc.map(i => `
      <div class="card card-pad">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b class="mono">${esc(i.ativo_patrimonio)}</b>${badge(C.RESULTADO_ITEM, i.resultado)}
          ${i.criticidade ? badge(C.CRITICIDADE, i.criticidade) : ""}</div>
        ${i.resultado === "LOCAL_DIVERGENTE" ? `
          <div class="dado"><div class="r">Local cadastrado</div><div class="v">${esc(i.local_esperado_texto || "—")}</div></div>
          <div class="dado"><div class="r">Local encontrado</div><div class="v">${esc(i.local_encontrado_texto || "—")}</div></div>` : ""}
        ${i.tipo_defeito ? `<div class="dado"><div class="r">Defeito</div><div class="v">${esc(i.tipo_defeito)}</div></div>` : ""}
        ${i.observacao ? `<div class="dado"><div class="r">Observação</div><div class="v">${esc(i.observacao)}</div></div>` : ""}
        ${i.foto_url ? `<img src="${esc(i.foto_url)}" style="width:100%;max-height:170px;object-fit:cover;border-radius:8px;margin-top:9px">` : ""}
        <div style="font-size:11.5px;color:var(--texto-2);margin-top:8px">
          ${dataBR(i.data_hora, true)} · ${esc(i.tecnico_nome || "")}</div>
      </div>`).join("")}</div>`
      : `<div class="aviso ok"><div>Nenhuma ocorrência registrada neste inventário.</div></div>`;
  }

  else {
    const ex = [...S.conferidos.values()].filter(i => ["ENCONTRADO_EXTRA", "CADASTRO_PENDENTE"].includes(i.resultado));
    box.innerHTML = ex.length ? `<div class="grade g3">${ex.map(i => `
      <div class="card card-pad" ${i.ativo_id ? `data-ativo="${i.ativo_id}" style="cursor:pointer"` : ""}>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b class="mono">${esc(i.ativo_patrimonio || "sem patrimônio")}</b>
          ${badge(C.RESULTADO_ITEM, i.resultado)}</div>
        <div style="font-size:13px;margin-top:5px">${esc([i.fabricante, i.modelo].filter(Boolean).join(" ") || "—")}</div>
        <div style="font-size:12px;color:var(--texto-2)">${esc(i.observacao || "")}</div>
        ${i.resultado === "CADASTRO_PENDENTE"
          ? `<div class="aviso warn" style="margin-top:8px;padding:7px 10px;font-size:12px">
              <div>Aguardando validação de um analista.</div></div>` : ""}
      </div>`).join("")}</div>`
      : `<div class="aviso info"><div>Nenhum equipamento extra encontrado neste local.</div></div>`;
  }

  box.querySelectorAll("[data-ativo]").forEach(el =>
    el.onclick = () => irPara("ativos", el.dataset.ativo));
}

/* ============================================================
   4. LEITURA E CONFERÊNCIA — o fluxo rápido
   ============================================================ */
function abrirLeitura(alvo) {
  abrirScanner({
    titulo: "Conferir equipamento",
    textoAjuda: "Aponte para o QR Code. A leitura é contínua: confirme e escaneie o próximo.",
    aoLer: async (codigo) => {
      const ativo = await acharAtivoPorCodigo(codigo);
      if (!ativo) { await telaNaoCadastrado(codigo, alvo); return false; }
      if (S.conferidos.has(ativo.id)) {
        const ja = S.conferidos.get(ativo.id);
        toast(`${ativo.patrimonio_newpc} já foi conferido neste inventário (${C.labelDe(C.RESULTADO_ITEM, ja.resultado)}).`, "warn");
        return false;
      }
      await cardConferencia(ativo, alvo);
      return false;   // mantém o scanner aberto para o próximo
    }
  });
}

/** Card grande com os dados do equipamento e os 6 botões de ação (item 20). */
function cardConferencia(ativo, alvo) {
  return new Promise(resolve => {
    const esperado = S.porId.has(ativo.id);
    const localEsperado = descreverLocal(ativo);
    const localSessao = descreverLocal({
      cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
      setor_id: S.inv.setor_id, local_id: S.inv.local_id
    });

    const corpo = document.createElement("div");
    corpo.innerHTML = `
      ${!esperado ? `<div class="aviso warn" style="margin-bottom:12px">${ico("alert", 18)}
        <div><b>Equipamento fora da lista deste local</b>
        O cadastro aponta para: ${esc(localEsperado)}</div></div>` : ""}

      <div style="text-align:center;padding:6px 0 14px;border-bottom:1px solid var(--borda);margin-bottom:14px">
        <div class="mono" style="font-size:27px;font-weight:800;color:var(--marinho)">${esc(ativo.patrimonio_newpc)}</div>
        <div style="font-size:15px;margin-top:3px">${esc([ativo.fabricante, ativo.modelo].filter(Boolean).join(" "))}</div>
        <div style="font-size:13px;color:var(--texto-2);margin-top:2px">${esc(rotuloDeId("categorias", ativo.categoria))}</div>
        <div style="margin-top:8px">${badgeStatusAtivo(ativo.status)}</div>
      </div>

      <div style="font-size:13px;line-height:1.9;margin-bottom:15px">
        ${ativo.numero_serie ? `<div><span style="color:var(--texto-2)">Série:</span>
          <span class="mono">${esc(ativo.numero_serie)}</span></div>` : ""}
        <div><span style="color:var(--texto-2)">Local esperado:</span> <b>${esc(localEsperado)}</b></div>
        <div><span style="color:var(--texto-2)">Origem:</span>
          ${esc(C.labelDe(C.ORIGEM_ATIVO, ativo.origem_ativo))}</div>
        ${ativo.fornecedor_id ? `<div><span style="color:var(--texto-2)">Proprietário:</span>
          ${esc(rotuloDeId("fornecedores", ativo.fornecedor_id))}</div>` : ""}
        ${ativo.contrato_fornecedor_id ? `<div><span style="color:var(--texto-2)">Contrato de origem:</span>
          ${esc(rotuloDeId("contratos_fornecedor", ativo.contrato_fornecedor_id))}</div>` : ""}
      </div>

      <div class="grade-campo">
        <button class="btn-campo verde full" data-a="CORRETO">${ico("check", 26)}ENCONTRADO E CORRETO</button>
        <button class="btn-campo laranja" data-a="LOCAL">${ico("pin", 21)}LOCAL DIFERENTE</button>
        <button class="btn-campo vermelho" data-a="DEFEITO">${ico("alert", 21)}COM DEFEITO</button>
        <button class="btn-campo azul" data-a="TRANSFERIDO">${ico("arrows", 21)}TRANSFERIDO</button>
        <button class="btn-campo cinza" data-a="SEM_USO">${ico("box", 21)}SEM USO</button>
        <button class="btn-campo amarelo full" data-a="RECOLHER">${ico("box", 21)}RECOLHER</button>
      </div>`;

    const m = modal({ titulo: "Equipamento localizado", corpo, aoFechar: () => resolve() });

    corpo.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      const acao = b.dataset.a;
      /* Regra 6 - ativo baixado nao se movimenta. O store bloqueia, mas avisamos antes
         para o tecnico nao perder tempo preenchendo um formulario que sera recusado. */
      if (C.STATUS_BLOQUEIA_MOVIMENTACAO.includes(ativo.status)) {
        toast("Equipamento baixado. Um administrador precisa reativá-lo antes de qualquer registro.", "err");
        return;
      }
      corpo.querySelectorAll("[data-a]").forEach(x => x.disabled = true);
      try {
        if (acao === "CORRETO")            { await registrarCorreto(ativo, esperado); m.fechar(); }
        else if (acao === "LOCAL")         { m.fechar(); await fluxoLocalDiferente(ativo, localEsperado, localSessao); }
        else if (acao === "DEFEITO")       { m.fechar(); await fluxoDefeito(ativo); }
        else if (acao === "TRANSFERIDO")   { m.fechar(); await fluxoTransferido(ativo, localEsperado); }
        else if (acao === "SEM_USO")       { m.fechar(); await fluxoSemUso(ativo); }
        else if (acao === "RECOLHER")      { m.fechar(); await fluxoRecolher(ativo); }
        atualizarTela(alvo);
      } catch (e) {
        console.error(e); toast(e.message || "Não foi possível registrar.", "err");
        corpo.querySelectorAll("[data-a]").forEach(x => x.disabled = false);
      }
      resolve();
    });
  });
}

/* --- gravação de um item do inventário --- */
async function gravarItem(ativo, resultado, extra = {}) {
  const item = {
    inventario_id: S.invId, inventario_codigo: S.inv.codigo,
    ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc,
    situacao_esperada: ativo.status,
    local_esperado: ativo.local_id || ativo.setor_id || ativo.unidade_id || null,
    local_esperado_texto: descreverLocal(ativo),
    resultado, data_hora: serverTimestamp(),
    tecnico_id: sessao.usuario.id, tecnico_nome: sessao.usuario.nome,
    cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
    setor_id: S.inv.setor_id || null, local_id: S.inv.local_id || null,
    requer_validacao: resultado !== "CORRETO",
    ...extra
  };
  if (S.params.exigirGPS || navigator.geolocation) {
    const pos = await posicao().catch(() => null);
    if (pos) { item.latitude = pos.coords.latitude; item.longitude = pos.coords.longitude; }
  }
  const id = await criar("inventario_itens", item);
  S.conferidos.set(ativo.id, { id, ...item, data_hora: new Date() });
  return id;
}

function posicao() {
  return new Promise((ok, err) => {
    if (!navigator.geolocation) return err();
    navigator.geolocation.getCurrentPosition(ok, err, { timeout: 4000, maximumAge: 120000 });
  });
}

/** Cria pendência para o analista revisar (item 21, 22, 24). */
async function criarPendencia(tipo, ativo, descricao, extra = {}) {
  const codigo = await proximoCodigo("pendencias");
  await criar("pendencias", {
    codigo, tipo, status: "ABERTA",
    ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc,
    inventario_id: S.invId, inventario_codigo: S.inv.codigo,
    cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
    /* municipio_id desnormalizado: sem ele o dashboard por município não consegue
       contar divergências sem varrer todos os ativos. */
    municipio_id: S.inv.municipio_id || null,
    descricao, criado_em: serverTimestamp(),
    criado_por: sessao.usuario.id, criado_por_nome: sessao.usuario.nome,
    ...extra
  });
  window.NEWPC_atualizarAlertas?.();
  return codigo;
}

/* --- 1. ENCONTRADO E CORRETO: zero atrito (item 20) --- */
async function registrarCorreto(ativo, esperado) {
  const localSessao = descreverLocal({
    cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
    setor_id: S.inv.setor_id, local_id: S.inv.local_id });
  const localCadastrado = descreverLocal(ativo);

  await gravarItem(ativo, esperado ? "CORRETO" : "ENCONTRADO_EXTRA",
    esperado ? {} : { local_encontrado_texto: localSessao,
                      observacao: "Encontrado neste local, mas cadastrado em outro." });

  const prox = new Date(Date.now() + S.params.diasInventarioVencido * 86400000);
  await atualizar("ativos", ativo.id, {
    /* Timestamp (nao texto ISO): as consultas de faixa do dashboard e dos relatorios
       comparam com Date/Timestamp. Misturar tipos faz o Firestore devolver contagem errada. */
    ultimo_inventario: serverTimestamp(),
    proximo_inventario: prox,
    ...(esperado ? {} : {
      /* Encontrado fora do local previsto mas dentro do escopo do inventario:
         atualizamos a localizacao para onde ele realmente esta. */
      cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
      setor_id: S.inv.setor_id || null, local_id: S.inv.local_id || null
    })
  });

  /* Regra 7 - equipamento encontrado em local diferente do cadastrado SEMPRE gera divergencia,
     mesmo quando o tecnico usa o botao rapido. A localizacao e corrigida na hora (o equipamento
     esta fisicamente aqui, nao adianta manter o cadastro errado), mas o analista precisa saber
     que ele se moveu sem movimentacao registrada - e assim que se descobre remanejamento informal. */
  if (!esperado) {
    await criarPendencia("DIVERGENCIA_LOCAL", ativo,
      `Equipamento encontrado fora do local cadastrado durante o inventário ${S.inv.codigo}.`,
      { status: "RESOLVIDA",
        local_esperado_texto: localCadastrado, local_encontrado_texto: localSessao,
        cliente_encontrado: S.inv.cliente_id, unidade_encontrada: S.inv.unidade_id,
        setor_encontrado: S.inv.setor_id || null, local_encontrado: S.inv.local_id || null,
        resolvido_por: sessao.usuario.id, resolvido_por_nome: sessao.usuario.nome,
        resolucao_texto: "Localização corrigida automaticamente pelo inventário." });
  }

  await registrarHistorico(ativo.id, "INVENTARIO",
    esperado ? "Inventariado" : "Inventariado em local diferente",
    esperado ? `${S.inv.codigo} · ${localSessao}`
             : `${S.inv.codigo} · ${localCadastrado} → ${localSessao}`);

  toast(esperado ? `${ativo.patrimonio_newpc} confirmado.`
                 : `${ativo.patrimonio_newpc} confirmado aqui. Divergência de local registrada.`,
    "ok", "Equipamento conferido");
}

/* --- 2. LOCAL DIFERENTE (item 21) --- */
async function fluxoLocalDiferente(ativo, localEsperado, localSessao) {
  const [unidades, setores, locais] = await Promise.all(["unidades", "setores", "locais"].map(listaRef));
  const podeAtualizar = pode("inventario.validar") || !S.params.exigirAprovacaoDivergencia;

  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="grade g2" style="margin-bottom:14px">
      <div class="card card-pad" style="border-color:var(--cinza-3)">
        <div class="r" style="font-size:11px;color:var(--texto-2);font-weight:700;text-transform:uppercase">Local cadastrado</div>
        <div style="font-size:14px;margin-top:4px">${esc(localEsperado)}</div></div>
      <div class="card card-pad" style="border-color:var(--laranja)">
        <div class="r" style="font-size:11px;color:var(--laranja);font-weight:700;text-transform:uppercase">Local encontrado</div>
        <div style="font-size:14px;margin-top:4px">${esc(localSessao)}</div></div>
    </div>
    <p class="hint" style="margin-bottom:12px">Por padrão registramos o local desta sessão de inventário.
      Se o equipamento está em outro ponto da unidade, ajuste abaixo.</p>
    <div class="form-grade">
      <div class="campo"><label>Setor onde foi encontrado</label>
        <select class="inp" id="d-set"><option value="">${esc(rotuloDeId("unidades", S.inv.unidade_id))} (sem setor)</option>
          ${setores.filter(s => s.unidade_id === S.inv.unidade_id).map(s =>
            `<option value="${s.id}" ${s.id === S.inv.setor_id ? "selected" : ""}>${esc(s.nome)}</option>`).join("")}
        </select></div>
      <div class="campo"><label>Sala / Local</label><select class="inp" id="d-loc"><option value="">—</option></select></div>
      <div class="campo w2"><label>Justificativa <span class="req">*</span></label>
        <textarea class="inp" id="d-just" placeholder="Ex.: equipamento remanejado pela direção da escola"></textarea></div>
      <div class="campo w2"><label>Foto (opcional)</label>
        <input class="inp" type="file" id="d-foto" accept="image/*" capture="environment"></div>
    </div>`;

  const set = corpo.querySelector("#d-set"), loc = corpo.querySelector("#d-loc");
  const encherLocais = () => {
    const l = locais.filter(x => x.setor_id === set.value);
    loc.innerHTML = `<option value="">—</option>` + l.map(x =>
      `<option value="${x.id}" ${x.id === S.inv.local_id ? "selected" : ""}>${esc(x.nome)}</option>`).join("");
    loc.disabled = !l.length;
  };
  set.onchange = encherLocais; encherLocais();

  const acoes = [{ texto: "Cancelar" }];
  if (podeAtualizar) acoes.push({ texto: "Atualizar localização", classe: "p", icone: "check",
    aoClicar: () => salvar(true) });
  acoes.push({ texto: podeAtualizar ? "Só registrar divergência" : "Registrar divergência",
    classe: podeAtualizar ? "" : "p", aoClicar: () => salvar(false) });

  const m = modal({ titulo: "Equipamento em local diferente", corpo, acoes, tamanho: "g" });

  async function salvar(atualizarLocal) {
    const just = corpo.querySelector("#d-just").value.trim();
    if (!just) { toast("Informe a justificativa.", "warn"); return false; }
    const setorId = set.value || null, localId = loc.value || null;
    const encontradoTexto = descreverLocal({
      cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id, setor_id: setorId, local_id: localId });

    let fotoUrl = null;
    const f = corpo.querySelector("#d-foto").files[0];
    if (f) { try { fotoUrl = await enviarAnexo(ativo.id, f, "Localização", "FOTO"); } catch { toast("A foto não pôde ser enviada, mas a divergência foi registrada.", "warn"); } }

    await gravarItem(ativo, "LOCAL_DIVERGENTE", {
      local_encontrado: localId || setorId || S.inv.unidade_id,
      local_encontrado_texto: encontradoTexto,
      observacao: just, foto_url: fotoUrl,
      cliente_encontrado: S.inv.cliente_id, unidade_encontrada: S.inv.unidade_id,
      setor_encontrado: setorId, local_encontrado_id: localId
    });

    if (atualizarLocal) {
      await atualizar("ativos", ativo.id, {
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        setor_id: setorId, local_id: localId,
        ultimo_inventario: serverTimestamp()
      });
      await criarPendencia("DIVERGENCIA_LOCAL", ativo,
        `Localização regularizada durante o inventário. ${just}`,
        { status: "RESOLVIDA", local_esperado_texto: localEsperado, local_encontrado_texto: encontradoTexto,
          resolvido_por: sessao.usuario.id, resolvido_por_nome: sessao.usuario.nome,
          resolucao_texto: "Localização atualizada pelo próprio inventário." });
      toast("Localização atualizada e divergência registrada.", "ok");
    } else {
      await criarPendencia("DIVERGENCIA_LOCAL", ativo, just, {
        local_esperado_texto: localEsperado, local_encontrado_texto: encontradoTexto,
        cliente_encontrado: S.inv.cliente_id, unidade_encontrada: S.inv.unidade_id,
        setor_encontrado: setorId, local_encontrado: localId, foto_url: fotoUrl
      });
      toast("Divergência enviada para análise.", "ok");
    }
    await registrarHistorico(ativo.id, "INVENTARIO", "Divergência de localização",
      `${localEsperado} → ${encontradoTexto}`);
  }
}

/* --- 3. COM DEFEITO (item 22) --- */
async function fluxoDefeito(ativo) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="campo" style="margin-bottom:12px"><label>Tipo de defeito <span class="req">*</span></label>
      <div class="grade" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:7px">
        ${C.TIPOS_DEFEITO.map(t => `<button type="button" class="btn sm" data-def="${esc(t)}"
          style="justify-content:flex-start">${esc(t)}</button>`).join("")}
      </div></div>
    <div class="form-grade">
      <div class="campo"><label>Criticidade <span class="req">*</span></label>
        <select class="inp" id="df-crit">${C.CRITICIDADE.map(c =>
          `<option value="${c.v}" ${c.v === "MEDIA" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
      <div class="campo"><label>Foto do problema</label>
        <input class="inp" type="file" id="df-foto" accept="image/*" capture="environment"></div>
      <div class="campo w2"><label>Descrição <span class="req">*</span></label>
        <textarea class="inp" id="df-desc" placeholder="O que exatamente está acontecendo?"></textarea></div>
      <div class="campo w2"><label class="check"><input type="checkbox" id="df-manut">
        <span>Encaminhar para manutenção agora (equipamento sai de uso)</span></label></div>
    </div>`;

  let tipo = null;
  corpo.querySelectorAll("[data-def]").forEach(b => b.onclick = () => {
    tipo = b.dataset.def;
    corpo.querySelectorAll("[data-def]").forEach(x => { x.classList.remove("p"); });
    b.classList.add("p");
  });

  modal({ titulo: "Equipamento com defeito", corpo, tamanho: "g", acoes: [
    { texto: "Cancelar" },
    { texto: "Registrar defeito", classe: "d", icone: "alert", aoClicar: async () => {
      const desc = corpo.querySelector("#df-desc").value.trim();
      if (!tipo) { toast("Selecione o tipo de defeito.", "warn"); return false; }
      if (!desc) { toast("Descreva o problema.", "warn"); return false; }
      const crit = corpo.querySelector("#df-crit").value;
      const paraManutencao = corpo.querySelector("#df-manut").checked;

      let fotoUrl = null;
      const f = corpo.querySelector("#df-foto").files[0];
      if (f) { try { fotoUrl = await enviarAnexo(ativo.id, f, "Dano", "FOTO"); } catch {} }

      await gravarItem(ativo, "DEFEITO", { tipo_defeito: tipo, criticidade: crit, observacao: desc, foto_url: fotoUrl });

      /* Ocorrência técnica: estrutura preparada para o futuro módulo de chamados. */
      await criar("ocorrencias", {
        ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc, tipo: "DEFEITO",
        tipo_defeito: tipo, criticidade: crit, descricao: desc, foto_url: fotoUrl,
        origem: "INVENTARIO", inventario_id: S.invId, inventario_codigo: S.inv.codigo,
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        status: "ABERTA", data: serverTimestamp(),
        registrado_por: sessao.usuario.id, registrado_por_nome: sessao.usuario.nome
      });

      await criarPendencia("DEFEITO", ativo, `${tipo} — ${desc}`,
        { tipo_defeito: tipo, criticidade: crit, foto_url: fotoUrl });

      const mudanca = { ultimo_inventario: serverTimestamp() };
      if (paraManutencao) {
        mudanca.status = "EM_MANUTENCAO";
        /* local_anterior é um objeto em todo o sistema (o retorno de manutenção o reaplica no ativo).
           Gravar texto aqui quebraria o retorno — ver pendencias.js/retornarDeManutencao. */
        mudanca.local_anterior = {
          cliente_id: ativo.cliente_id || null, unidade_id: ativo.unidade_id || null,
          setor_id: ativo.setor_id || null, local_id: ativo.local_id || null,
          municipio_id: ativo.municipio_id || null
        };
      }
      await atualizar("ativos", ativo.id, mudanca);
      await registrarHistorico(ativo.id, "DEFEITO", `Defeito registrado: ${tipo}`, desc);
      toast(paraManutencao ? "Defeito registrado. Equipamento marcado para manutenção."
                           : "Defeito registrado e enviado para análise.", "ok");
    }}
  ]});
}

/* --- 4. TRANSFERIDO (o técnico sabe para onde foi) --- */
async function fluxoTransferido(ativo, localEsperado) {
  const [clientes, unidades] = await Promise.all(["clientes", "unidades"].map(listaRef));
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso info" style="margin-bottom:13px"><div>
      Use esta opção quando o equipamento não está mais aqui e você sabe para onde foi.
      A movimentação ficará registrada no histórico.</div></div>
    <div class="form-grade">
      <div class="campo"><label>Cliente de destino <span class="req">*</span></label>
        <select class="inp" id="t-cli"><option value="">—</option>
          ${clientes.map(c => `<option value="${c.id}" ${c.id === S.inv.cliente_id ? "selected" : ""}>${esc(rotulo("clientes", c))}</option>`).join("")}
        </select></div>
      <div class="campo"><label>Unidade de destino <span class="req">*</span></label>
        <select class="inp" id="t-uni"><option value="">—</option></select></div>
      <div class="campo w2"><label>Motivo <span class="req">*</span></label>
        <textarea class="inp" id="t-mot" placeholder="Quem informou e por quê"></textarea></div>
    </div>`;
  const cli = corpo.querySelector("#t-cli"), uni = corpo.querySelector("#t-uni");
  const encher = () => {
    const l = unidades.filter(u => u.cliente_id === cli.value);
    uni.innerHTML = `<option value="">—</option>` + l.map(u => `<option value="${u.id}">${esc(u.nome)}</option>`).join("");
  };
  cli.onchange = encher; encher();

  modal({ titulo: "Equipamento transferido", corpo, acoes: [
    { texto: "Cancelar" },
    { texto: "Registrar transferência", classe: "p", aoClicar: async () => {
      const motivo = corpo.querySelector("#t-mot").value.trim();
      if (!uni.value || !motivo) { toast("Informe a unidade de destino e o motivo.", "warn"); return false; }
      const uniObj = unidades.find(u => u.id === uni.value);
      const destinoTexto = descreverLocal({ cliente_id: cli.value, unidade_id: uni.value });
      const podeEfetivar = pode("movimentacao.aprovar");

      await gravarItem(ativo, "LOCAL_DIVERGENTE", {
        local_encontrado_texto: destinoTexto, observacao: `Transferido: ${motivo}`,
        cliente_encontrado: cli.value, unidade_encontrada: uni.value
      });
      const codigoMov = await proximoCodigo("movimentacoes");
      const movId = await criar("movimentacoes", {
        codigo: codigoMov,
        ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc, tipo: "TRANSFERENCIA",
        origem_texto: localEsperado, destino_texto: destinoTexto,
        cliente_origem: ativo.cliente_id, cliente_destino: cli.value,
        unidade_origem: ativo.unidade_id, unidade_destino: uni.value,
        municipio_destino: uniObj?.municipio_id || null,
        data: serverTimestamp(), usuario_id: sessao.usuario.id, usuario_nome: sessao.usuario.nome,
        motivo: `Constatado em inventário ${S.inv.codigo}. ${motivo}`,
        inventario_id: S.invId, status: podeEfetivar ? "EFETIVADA" : "PENDENTE"
      });

      if (podeEfetivar) {
        await atualizar("ativos", ativo.id, {
          cliente_id: cli.value, unidade_id: uni.value, setor_id: null, local_id: null,
          municipio_id: uniObj?.municipio_id || null
        });
        toast("Transferência registrada e localização atualizada.", "ok");
      } else {
        await criarPendencia("MOVIMENTACAO", ativo,
          `Transferência para ${destinoTexto} aguardando aprovação. ${motivo}`,
          { local_esperado_texto: localEsperado, local_encontrado_texto: destinoTexto,
            movimentacao_id: movId, movimentacao_codigo: codigoMov });
        toast("Transferência enviada para aprovação do analista.", "ok");
      }
    }}
  ]});
}

/* --- 5. SEM USO --- */
async function fluxoSemUso(ativo) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <p style="font-size:14px;margin-bottom:12px">O equipamento está no local mas não está sendo utilizado.</p>
    <div class="campo"><label>Situação <span class="req">*</span></label>
      <select class="inp" id="su-st">
        <option value="DISPONIVEL">Disponível para uso</option>
        <option value="RESERVA">Equipamento reserva</option>
        <option value="EM_ESTOQUE">Guardado em estoque</option>
      </select></div>
    <div class="campo" style="margin-top:11px"><label>Observação</label>
      <textarea class="inp" id="su-obs" placeholder="Ex.: guardado no depósito, sem previsão de uso"></textarea></div>`;

  modal({ titulo: "Equipamento sem uso", corpo, acoes: [
    { texto: "Cancelar" },
    { texto: "Registrar", classe: "p", aoClicar: async () => {
      const st = corpo.querySelector("#su-st").value;
      const obs = corpo.querySelector("#su-obs").value.trim();
      await gravarItem(ativo, "CORRETO", { observacao: `Sem uso: ${obs || C.labelDe(C.STATUS_ATIVO, st)}` });
      await atualizar("ativos", ativo.id, {
        status: st, ultimo_inventario: serverTimestamp(),
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        setor_id: S.inv.setor_id || null, local_id: S.inv.local_id || null
      });
      await registrarHistorico(ativo.id, "INVENTARIO", "Registrado como sem uso", obs);
      toast("Situação registrada.", "ok");
    }}
  ]});
}

/* --- 6. RECOLHER --- */
async function fluxoRecolher(ativo) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="campo"><label>Motivo do recolhimento <span class="req">*</span></label>
      <select class="inp" id="rc-mot"><option value="">—</option>
        ${C.MOTIVO_RECOLHIMENTO.map(m => `<option>${esc(m)}</option>`).join("")}</select></div>
    <div class="campo" style="margin-top:11px"><label>Observação</label>
      <textarea class="inp" id="rc-obs"></textarea></div>
    <div class="aviso info" style="margin-top:12px"><div>
      O equipamento entrará na fila de recolhimento e mudará para
      <b>Aguardando Recolhimento</b>. A retirada física é registrada depois, no módulo Recolhimentos.</div></div>`;

  modal({ titulo: "Programar recolhimento", corpo, acoes: [
    { texto: "Cancelar" },
    { texto: "Programar recolhimento", classe: "p", aoClicar: async () => {
      const motivo = corpo.querySelector("#rc-mot").value;
      if (!motivo) { toast("Selecione o motivo.", "warn"); return false; }
      const obs = corpo.querySelector("#rc-obs").value.trim();
      const codigo = await proximoCodigo("recolhimentos");
      await gravarItem(ativo, "RECOLHIMENTO", { observacao: `${motivo}. ${obs}`.trim() });
      const recId = await criar("recolhimentos", {
        codigo, ativo_id: ativo.id, ativo_patrimonio: ativo.patrimonio_newpc,
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        motivo, observacao: obs, etapa: "AGUARDANDO",
        origem: "INVENTARIO", inventario_id: S.invId, inventario_codigo: S.inv.codigo,
        solicitado_por: sessao.usuario.id, solicitado_por_nome: sessao.usuario.nome,
        criado_em: serverTimestamp()
      });
      await atualizar("ativos", ativo.id, {
        status: "AGUARDANDO_RECOLHIMENTO", ultimo_inventario: serverTimestamp()
      });
      await criarPendencia("RECOLHIMENTO", ativo, `${motivo}. ${obs}`.trim(),
        { recolhimento_id: recId, recolhimento_codigo: codigo });
      await registrarHistorico(ativo.id, "RECOLHIMENTO", "Recolhimento programado", `${codigo} · ${motivo}`);
      toast(`Recolhimento ${codigo} programado.`, "ok");
    }}
  ]});
}

/* --- EQUIPAMENTO NÃO CADASTRADO (item 23) --- */
async function telaNaoCadastrado(codigo, alvo) {
  const categorias = await listaRef("categorias");
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso warn" style="margin-bottom:13px">${ico("alert", 18)}<div>
      <b>Equipamento não encontrado no cadastro</b>
      O código <span class="mono">${esc(codigo)}</span> não corresponde a nenhum ativo.
      Registre o mínimo agora — um analista completa depois.</div></div>
    <div class="form-grade">
      <div class="campo"><label>Categoria <span class="req">*</span></label>
        <select class="inp" id="nc-cat"><option value="">—</option>
          ${categorias.filter(c => c.ativo !== false).map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")}
        </select></div>
      <div class="campo"><label>Patrimônio visível</label>
        <input class="inp mono" id="nc-pat" value="${esc(codigo)}"></div>
      <div class="campo"><label>Fabricante <span class="req">*</span></label>
        <input class="inp" id="nc-fab" placeholder="Ex.: Dell, HP, Positivo"></div>
      <div class="campo"><label>Modelo <span class="req">*</span></label>
        <input class="inp" id="nc-mod"></div>
      <div class="campo w2"><label>Número de série</label>
        <input class="inp mono" id="nc-ser" autocapitalize="characters"></div>
      <div class="campo w2"><label>Foto da etiqueta <span class="hint">(ajuda muito na validação)</span></label>
        <input class="inp" type="file" id="nc-foto" accept="image/*" capture="environment"></div>
    </div>`;

  modal({ titulo: "Equipamento não cadastrado", corpo, tamanho: "g", acoes: [
    { texto: "Cancelar" },
    { texto: "Registrar para validação", classe: "p", icone: "plus", aoClicar: async () => {
      const cat = corpo.querySelector("#nc-cat").value;
      const fab = corpo.querySelector("#nc-fab").value.trim();
      const mod = corpo.querySelector("#nc-mod").value.trim();
      if (!cat || !fab || !mod) { toast("Preencha categoria, fabricante e modelo.", "warn"); return false; }

      const dados = {
        categoria: cat, fabricante: fab, modelo: mod,
        patrimonio_visivel: corpo.querySelector("#nc-pat").value.trim() || codigo,
        numero_serie: corpo.querySelector("#nc-ser").value.trim().toUpperCase() || null,
        codigo_lido: codigo
      };

      /* Item do inventário sem ativo_id: é um achado, não um ativo ainda. */
      const item = {
        inventario_id: S.invId, inventario_codigo: S.inv.codigo,
        ativo_id: null, ativo_patrimonio: dados.patrimonio_visivel,
        resultado: "CADASTRO_PENDENTE", data_hora: serverTimestamp(),
        tecnico_id: sessao.usuario.id, tecnico_nome: sessao.usuario.nome,
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        setor_id: S.inv.setor_id || null, local_id: S.inv.local_id || null,
        local_encontrado_texto: descreverLocal({ cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
          setor_id: S.inv.setor_id, local_id: S.inv.local_id }),
        requer_validacao: true, ...dados
      };
      const itemId = await criar("inventario_itens", item);

      let fotoUrl = null;
      const f = corpo.querySelector("#nc-foto").files[0];
      /* Grava sob o id do ITEM de inventario, nao de um ativo: o ativo ainda nao existe.
         O anexo recebe tambem inventario_item_id para o analista recuperar a foto na validacao. */
      if (f) { try { fotoUrl = await enviarAnexo(itemId, f, "Etiqueta", "FOTO",
                        { inventario_item_id: itemId, pendente_validacao: true }); } catch {} }

      const cod = await proximoCodigo("pendencias");
      await criar("pendencias", {
        codigo: cod, tipo: "CADASTRO_PENDENTE", status: "ABERTA",
        ativo_id: null, ativo_patrimonio: dados.patrimonio_visivel,
        inventario_id: S.invId, inventario_codigo: S.inv.codigo, inventario_item_id: itemId,
        cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
        municipio_id: S.inv.municipio_id || null,
        descricao: `${fab} ${mod} encontrado sem cadastro`,
        dados_coletados: { ...dados, foto_url: fotoUrl },
        foto_url: fotoUrl, local_encontrado_texto: item.local_encontrado_texto,
        criado_em: serverTimestamp(),
        criado_por: sessao.usuario.id, criado_por_nome: sessao.usuario.nome
      });

      S.conferidos.set("pend:" + itemId, { id: itemId, ...item, data_hora: new Date(), foto_url: fotoUrl });
      window.NEWPC_atualizarAlertas?.();
      toast("Registrado. Um analista vai validar o cadastro.", "ok");
      atualizarTela(alvo);
    }}
  ]});
}

/* Recalcula os totais na tela e no documento do inventário, sem recarregar a rota. */
let salvandoTotais = null;
function atualizarTela(alvo) {
  render(alvo);
  const alvoId = S.invId;
  clearTimeout(salvandoTotais);
  salvandoTotais = setTimeout(async () => {
    if (!S || S.invId !== alvoId) return;
    const m = metricas();
    /* Guarda contra o estado vazar entre navegacoes: se o usuario saiu da tela
       antes do timer disparar, S ja aponta para outra sessao (ou e nulo). */
    if (!S || S.invId !== alvoId) return;
    try {
      await atualizar("inventarios", alvoId, {
        total_encontrado: m.conferido, total_divergente: m.divergente + m.defeito,
        total_extra: m.extra, percentual: m.percentual
      });
      S.inv.total_encontrado = m.conferido;
    } catch (e) { console.warn("[inventario] totais não gravados", e); }
  }, 1500);
}

/* ============================================================
   5. FINALIZAÇÃO (item 24)
   ============================================================ */
async function finalizar(alvo) {
  const m = metricas();
  const pendentes = S.esperados.filter(a => !S.conferidos.has(a.id));

  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="grade g3" style="margin-bottom:15px">
      ${kpi("Conferidos", m.correto, { cor: "verde" })}
      ${kpi("Divergentes", m.divergente, { cor: m.divergente ? "laranja" : "" })}
      ${kpi("Com defeito", m.defeito, { cor: m.defeito ? "vermelho" : "" })}
      ${kpi("Extras", m.extra, { cor: m.extra ? "azul" : "" })}
      ${kpi("Não conferidos", pendentes.length, { cor: pendentes.length ? "vermelho" : "verde" })}
      ${kpi("Percentual", m.percentual + "%")}
    </div>

    ${pendentes.length ? `
      <div class="aviso warn" style="margin-bottom:12px">${ico("alert", 18)}<div>
        <b>${pendentes.length} equipamento(s) não foram localizados nesta vistoria.</b>
        Eles não serão marcados como perdidos — apenas registrados como
        <b>não localizados neste inventário</b>, para análise posterior.</div></div>

      <div style="max-height:270px;overflow:auto;border:1px solid var(--borda);border-radius:9px;margin-bottom:12px">
        <table class="tab"><thead><tr><th></th><th>Patrimônio</th><th>Equipamento</th><th>Local previsto</th></tr></thead>
        <tbody>${pendentes.map(a => `<tr>
          <td><input type="checkbox" class="nl-chk" data-id="${a.id}" checked style="width:17px;height:17px;accent-color:var(--vermelho)"></td>
          <td><span class="mono">${esc(a.patrimonio_newpc)}</span></td>
          <td>${esc([a.fabricante, a.modelo].filter(Boolean).join(" "))}</td>
          <td style="font-size:12px;color:var(--texto-2)">${esc(rotuloDeId("locais", a.local_id))}</td>
        </tr>`).join("")}</tbody></table>
      </div>
      <p class="hint" style="margin-bottom:12px">Desmarque os que você ainda pretende procurar —
        eles ficarão pendentes e o inventário continuará em andamento.</p>
    ` : `<div class="aviso ok" style="margin-bottom:12px">${ico("check", 18)}<div>
      <b>Todos os equipamentos esperados foram conferidos.</b></div></div>`}

    <div class="campo"><label>Observações da sessão</label>
      <textarea class="inp" id="fn-obs" placeholder="Anotações sobre a visita, contatos, restrições de acesso…"></textarea></div>`;

  modal({ titulo: "Finalizar inventário", corpo, tamanho: "g", acoes: [
    { texto: "Revisar antes" },
    { texto: "Confirmar e finalizar", classe: "m", icone: "check", aoClicar: async () => {
      const marcados = [...corpo.querySelectorAll(".nl-chk:checked")].map(c => c.dataset.id);
      const obs = corpo.querySelector("#fn-obs").value.trim();

      /* Não localizados: registra o item, muda o status do ativo e abre pendência.
         Uma vistoria sem achar NÃO significa perda (regra 8). */
      for (const id of marcados) {
        const a = S.porId.get(id);
        if (!a) continue;
        await criar("inventario_itens", {
          inventario_id: S.invId, inventario_codigo: S.inv.codigo,
          ativo_id: a.id, ativo_patrimonio: a.patrimonio_newpc,
          situacao_esperada: a.status, local_esperado_texto: descreverLocal(a),
          resultado: "NAO_LOCALIZADO", data_hora: serverTimestamp(),
          tecnico_id: sessao.usuario.id, tecnico_nome: sessao.usuario.nome,
          cliente_id: S.inv.cliente_id, unidade_id: S.inv.unidade_id,
          requer_validacao: true,
          observacao: "Não localizado durante a vistoria."
        });
        await atualizar("ativos", a.id, { status: "NAO_LOCALIZADO" });
        await criarPendencia("NAO_LOCALIZADO", a,
          `Não localizado no inventário ${S.inv.codigo} em ${descreverLocal(a)}.`);
        await registrarHistorico(a.id, "INVENTARIO", "Não localizado",
          `${S.inv.codigo} · ${descreverLocal(a)}`);
      }

      const restantes = S.esperados.filter(a => !S.conferidos.has(a.id) && !marcados.includes(a.id));
      const mf = metricas();
      await atualizar("inventarios", S.invId, {
        status: restantes.length ? "EM_ANDAMENTO" : (mf.divergente + mf.defeito + marcados.length ? "EM_REVISAO" : "FINALIZADO"),
        finalizado_em: restantes.length ? null : serverTimestamp(),
        total_encontrado: mf.conferido, total_divergente: mf.divergente + mf.defeito,
        total_nao_localizado: marcados.length, total_extra: mf.extra,
        percentual: pct(mf.conferido + marcados.length, mf.esperado),
        observacoes: obs || null
      });

      window.NEWPC_atualizarAlertas?.();
      if (restantes.length) {
        toast(`${restantes.length} equipamento(s) continuam pendentes. Inventário segue em andamento.`, "warn");
      } else {
        toast(`Inventário ${S.inv.codigo} finalizado.`, "ok", "Conferência concluída");
      }
      irPara("inventario");
    }}
  ]});
}
