/* NEWPC INVENTÁRIO — Módulo de Ativos
 * Três telas em uma rota:
 *   #/ativos                → listagem paginada (CRUD genérico de lista.js)
 *   #/ativos/qr:CODIGO      → resolução de leitura de QR / digitação
 *   #/ativos/<id>           → ficha completa do equipamento
 *
 * Conceito que rege este arquivo (item 53 do briefing):
 *   PROPRIETÁRIO (fornecedor/origem) ≠ CLIENTE onde o equipamento está instalado.
 *   As duas informações nunca aparecem no mesmo bloco visual.
 */
import { SCHEMA } from "../schema.js";
import {
  obter, buscar, criar, atualizar, listaRef, rotulo, rotuloDeId, descreverLocal,
  proximoCodigo, historicoDoAtivo, parametros, serverTimestamp
} from "../store.js";
import {
  ico, esc, toast, modal, dataBR, diasDesde, moeda, badge, badgeStatusAtivo,
  cabecalhoPagina, carregando, vazio
} from "../ui.js";
import { pode, sessao, ehAdmin } from "../auth.js";
import { irPara } from "../router.js";
import { abrirEditor, paginaLista } from "./lista.js";
import { abrirScanner, acharAtivoPorCodigo, qrSVG } from "./scanner.js";
import { storage, storageRef, uploadBytes, getDownloadURL } from "../firebase.js";
import * as C from "../config.js";

/* =========================================================================
   ENTRADA DA ROTA
   ========================================================================= */
export async function ativos(alvo, ctx) {
  if (!ctx.id) return listaDeAtivos(alvo, ctx);
  if (ctx.id.startsWith("qr:")) return telaCodigoLido(alvo, ctx.id.slice(3));
  return fichaDoAtivo(alvo, ctx);
}

/* =========================================================================
   HELPERS DE APRESENTAÇÃO
   ========================================================================= */

/* Campo vazio aparece como "—" acinzentado: o operador precisa enxergar o que falta preencher. */
function dado(rotuloTxt, valorTexto) {
  const v = (valorTexto === 0 || valorTexto) ? String(valorTexto).trim() : "";
  return `<div class="dado"><div class="r">${esc(rotuloTxt)}</div>
    <div class="v${v ? "" : " vazio-v"}">${v ? esc(v) : "—"}</div></div>`;
}
/* Mesma coisa, mas o valor já vem como HTML pronto (badge, link, mono…). */
function dadoHTML(rotuloTxt, html) {
  return `<div class="dado"><div class="r">${esc(rotuloTxt)}</div>
    <div class="v">${html || `<span class="vazio-v">—</span>`}</div></div>`;
}
const mono = v => v ? `<span class="mono">${esc(v)}</span>` : "";

function tamanhoArquivo(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/* Consultas de aba podem exigir índice composto no Firestore. Em vez de derrubar a ficha
   inteira, devolvemos o erro para a aba mostrar uma instrução compreensível. */
async function buscarSeguro(colecao, filtros, ordem, tam) {
  try {
    const r = await buscar(colecao, filtros, ordem, tam);
    return { dados: r.dados, erro: null };
  } catch (e) {
    console.error(`[ativos] consulta ${colecao}`, e);
    return { dados: [], erro: e };
  }
}
function avisoConsulta(erro) {
  const falta = /index/i.test(erro?.message || "");
  return `<div class="aviso err"><div><b>Não foi possível carregar estes dados</b>
    ${falta ? "O banco precisa de um índice para esta consulta. Abra o console do navegador e clique no link gerado pelo Firebase para criá-lo."
            : esc(erro?.message || "Tente novamente em instantes.")}</div></div>`;
}

/* Quantos dias faltam para uma data (negativo = já venceu). */
function diasPara(data) {
  const d = diasDesde(data);
  return d === null ? null : -d;
}
function textoVencimento(dataFim) {
  if (!dataFim) return "";
  const n = diasPara(dataFim);
  if (n === null) return "";
  if (n < 0) return `<span class="st st-vermelho">Vencido há ${Math.abs(n)} dia(s)</span>`;
  if (n === 0) return `<span class="st st-laranja">Vence hoje</span>`;
  return `<span class="st ${n <= 60 ? "st-laranja" : "st-verde"}">Faltam ${n} dia(s)</span>`;
}

const ehFinanceiroVisivel = () => ["ADMINISTRADOR", "DIRETORIA"].includes(sessao.usuario?.perfil);

/* =========================================================================
   1) LISTA DE ATIVOS
   ========================================================================= */

/* Campos que aceitamos pré-filtrar pela URL (#/ativos?status=NAO_LOCALIZADO&...). */
const FILTROS_URL = ["status", "condicao", "origem_ativo", "cliente_id", "categoria", "fornecedor_id",
  "contrato_fornecedor_id", "contrato_cliente_id", "unidade_id", "setor_id", "local_id", "municipio_id"];

function valorLegivel(campoNome, valor) {
  const campo = SCHEMA.ativos.campos.find(c => c.n === campoNome);
  if (!campo) return valor;
  if (campo.t === "select") return C.labelDe(campo.opcoes, valor);
  if (campo.t === "ref") return rotuloDeId(campo.ref, valor);
  return valor;
}

async function listaDeAtivos(alvo, ctx) {
  const params = ctx.params || {};
  const fixos = FILTROS_URL.filter(c => params[c]).map(c => [c, "==", params[c]]);

  await paginaLista(alvo, "ativos", {
    subtitulo: "Todo o parque de equipamentos. Toque em um item para abrir a ficha completa.",
    filtrosFixos: fixos,
    filtrosUI: ["status", "origem_ativo", "cliente_id", "categoria", "fornecedor_id",
                "contrato_fornecedor_id", "unidade_id"],
    ordem: ["patrimonio_newpc", "asc"],
    acoesTopoHTML: `<button class="btn" id="atv-escanear">${ico("scan", 15)}Escanear</button>`,
    aoClicarLinha: d => irPara("ativos", d.id),
    cardMobile: d => ({
      titulo: `<span class="mono" style="font-weight:800">${esc(d.patrimonio_newpc || "sem patrimônio")}</span>`,
      badge: badgeStatusAtivo(d.status),
      linha2: esc([d.fabricante, d.modelo].filter(Boolean).join(" ") || "Sem fabricante/modelo informado"),
      linha3: `${ico("building", 13)} ${esc(rotuloDeId("clientes", d.cliente_id))}
               · ${ico("school", 13)} ${esc(rotuloDeId("unidades", d.unidade_id))}`
    })
  });

  /* Chips dos filtros vindos da URL: o usuário precisa saber por que a lista está reduzida. */
  if (fixos.length) {
    const chips = fixos.map(([campo, , valor]) => `
      <span class="tag-filtro">${esc(SCHEMA.ativos.campos.find(c => c.n === campo)?.l || campo)}:
        ${esc(valorLegivel(campo, valor))}
        <button data-tirar="${esc(campo)}" title="Remover este filtro">✕</button></span>`).join(" ");
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;align-items:center";
    box.innerHTML = `<span style="font-size:12.5px;color:var(--texto-2);font-weight:600">Filtro aplicado:</span>${chips}`;
    alvo.querySelector("#lst-filtros")?.before(box);
    box.querySelectorAll("[data-tirar]").forEach(b => b.onclick = () => {
      const restantes = { ...params };
      delete restantes[b.dataset.tirar];
      irPara("ativos", "", restantes);
    });
  }

  alvo.querySelector("#atv-escanear")?.addEventListener("click", () => abrirScanner({
    titulo: "Escanear equipamento",
    aoLer: async (codigo, fechar) => {
      const a = await acharAtivoPorCodigo(codigo);
      if (!a) { irPara("ativos", "qr:" + codigo); fechar(); return; }
      irPara("ativos", a.id);
    }
  }));
}

/* =========================================================================
   2) CÓDIGO LIDO (QR ou digitação) — pode não existir no cadastro
   ========================================================================= */
async function telaCodigoLido(alvo, codigo) {
  alvo.innerHTML = carregando("Procurando o equipamento…");
  const encontrado = await acharAtivoPorCodigo(codigo);
  if (encontrado) return irPara("ativos", encontrado.id);

  alvo.innerHTML = `
    ${cabecalhoPagina("Equipamento não cadastrado", "O código lido não corresponde a nenhum equipamento do sistema.")}
    <div class="card card-pad" style="max-width:620px">
      <div class="aviso warn"><div><b>Nada encontrado para este código</b>
        Procuramos por patrimônio NEWPC, número de série, service tag e patrimônio do fornecedor.</div></div>
      <div class="dado" style="margin-top:12px">
        <div class="r">Código lido</div>
        <div class="v mono" style="font-size:17px;font-weight:700">${esc(codigo)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:15px">
        ${pode("ativo.criar") ? `<button class="btn p" id="qr-cadastrar">${ico("plus", 15)}Cadastrar este equipamento</button>` : ""}
        <button class="btn" id="qr-outro">${ico("scan", 15)}Ler outro código</button>
        <button class="btn" id="qr-lista">${ico("cpu", 15)}Ver todos os ativos</button>
      </div>
      ${pode("ativo.criar") ? "" : `<p class="hint" style="margin-top:11px">
        Seu perfil não cadastra equipamentos. Avise o analista responsável informando este código.</p>`}
    </div>`;

  alvo.querySelector("#qr-cadastrar")?.addEventListener("click", () =>
    abrirEditor("ativos", null, {
      valoresIniciais: { patrimonio_newpc: codigo },
      aoSalvar: novoId => irPara("ativos", novoId)
    }));
  alvo.querySelector("#qr-outro").onclick = () => abrirScanner({
    titulo: "Escanear equipamento",
    aoLer: async (cod, fechar) => { fechar(); irPara("ativos", "qr:" + cod); }
  });
  alvo.querySelector("#qr-lista").onclick = () => irPara("ativos");
}

/* =========================================================================
   3) FICHA DO ATIVO
   ========================================================================= */
async function fichaDoAtivo(alvo, ctx) {
  const id = ctx.id;
  let ativo = await obter("ativos", id);
  if (!ativo) {
    alvo.innerHTML = vazio("Equipamento não encontrado",
      "O registro pode ter sido excluído ou o endereço está incorreto.");
    return;
  }
  const p = await parametros();

  /* Cache por ficha: evita reler a mesma coleção ao alternar entre abas. */
  const cache = {};
  const umaVez = (chave, fn) => (cache[chave] ??= fn());

  const ABAS = [
    { k: "geral",         t: "Visão geral",   r: painelGeral },
    { k: "local",         t: "Localização",   r: painelLocalizacao },
    { k: "propriedade",   t: "Propriedade",   r: painelPropriedade },
    { k: "contratos",     t: "Contratos",     r: painelContratos },
    { k: "inventarios",   t: "Inventários",   r: painelInventarios },
    { k: "movimentacoes", t: "Movimentações", r: painelMovimentacoes },
    { k: "manutencoes",   t: "Manutenções",   r: painelManutencoes },
    { k: "fotos",         t: "Fotos",         r: painelFotos },
    { k: "documentos",    t: "Documentos",    r: painelDocumentos },
    { k: "historico",     t: "Histórico",     r: painelHistorico }
  ];
  if (pode("auditoria.ver")) ABAS.push({ k: "auditoria", t: "Auditoria", r: painelAuditoria });

  let abaAtual = ABAS.some(a => a.k === ctx.sub) ? ctx.sub : "geral";

  function desenharTopo() {
    const desc = [ativo.fabricante, ativo.modelo].filter(Boolean).join(" ");
    const cat = rotuloDeId("categorias", ativo.categoria);
    return `
    <div class="ficha-topo">
      <div style="min-width:190px;flex:1 1 260px">
        <div class="pat">${esc(ativo.patrimonio_newpc || "Sem patrimônio")}</div>
        <div class="desc">${esc(desc || "Fabricante e modelo não informados")}${cat && cat !== "—" ? " · " + esc(cat) : ""}</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
          ${badgeStatusAtivo(ativo.status)}
          ${ativo.condicao ? badge(C.CONDICAO_ATIVO, ativo.condicao) : ""}
        </div>
      </div>
      <div class="dir">
        ${ativo.patrimonio_newpc ? `<div class="qr" title="Aponte o leitor para este código">${qrSVG(ativo.patrimonio_newpc, 92)}</div>` : ""}
        <div style="display:flex;flex-direction:column;gap:7px">
          ${pode("ativo.editar") ? `<button class="btn sm" id="fa-editar">${ico("edit", 14)}Editar</button>` : ""}
          ${pode("movimentacao.criar") ? `<button class="btn sm" id="fa-transferir">${ico("arrows", 14)}Transferir</button>` : ""}
          ${pode("recolhimento.criar") ? `<button class="btn sm" id="fa-recolher">${ico("box", 14)}Recolher</button>` : ""}
          <button class="btn sm" id="fa-etiqueta">${ico("print", 14)}Imprimir etiqueta</button>
          ${ehAdmin() && ativo.status === "BAIXADO"
            ? `<button class="btn d sm" id="fa-reativar">${ico("shield", 14)}Reativar</button>` : ""}
        </div>
      </div>
    </div>`;
  }

  function desenharAbas() {
    return `<div class="abas">${ABAS.map(a =>
      `<div class="aba ${a.k === abaAtual ? "on" : ""}" data-aba="${a.k}">${esc(a.t)}</div>`).join("")}</div>`;
  }

  async function desenharPainel() {
    const painel = alvo.querySelector("#fa-painel");
    painel.innerHTML = carregando();
    const aba = ABAS.find(a => a.k === abaAtual);
    const saida = await aba.r({ ativo, id, p, umaVez, recarregar });
    if (typeof saida === "string") { painel.innerHTML = saida; return; }
    painel.innerHTML = saida.html;
    saida.montar && saida.montar(painel);
  }

  /* Após transferência/recolhimento os dados do ativo mudaram: relê e redesenha. */
  async function recarregar(limparCacheDe) {
    if (limparCacheDe) delete cache[limparCacheDe];
    ativo = await obter("ativos", id) || ativo;
    alvo.querySelector("#fa-topo").innerHTML = desenharTopo();
    ligarTopo();
    await desenharPainel();
  }

  function ligarTopo() {
    alvo.querySelector("#fa-editar")?.addEventListener("click", () =>
      abrirEditor("ativos", id, { aoSalvar: () => recarregar() }));
    alvo.querySelector("#fa-transferir")?.addEventListener("click", () =>
      abrirTransferencia(ativo, () => recarregar("movimentacoes")));
    alvo.querySelector("#fa-recolher")?.addEventListener("click", () =>
      abrirRecolhimento(ativo, () => recarregar()));
    alvo.querySelector("#fa-etiqueta")?.addEventListener("click", () => abrirEtiqueta(ativo));
  }

  alvo.innerHTML = `<div id="fa-topo">${desenharTopo()}</div>${desenharAbas()}<div id="fa-painel"></div>`;
  alvo.querySelector("#fa-reativar")?.addEventListener("click",
    () => reativarAtivo(ativo, () => ativos(alvo, ctx)));
  ligarTopo();

  /* Troca de aba é só re-render do painel — não recarrega a página nem a ficha. */
  alvo.querySelectorAll("[data-aba]").forEach(el => el.onclick = () => {
    if (el.dataset.aba === abaAtual) return;
    abaAtual = el.dataset.aba;
    alvo.querySelectorAll("[data-aba]").forEach(x => x.classList.toggle("on", x.dataset.aba === abaAtual));
    desenharPainel();
  });

  await desenharPainel();
}

/* ---------------------- ABA: VISÃO GERAL ---------------------- */
function painelGeral({ ativo }) {
  return `<div class="grade g2">
    <div class="card">
      <div class="card-tit">${ico("tag", 16)}<h3>Identificação</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${dadoHTML("Patrimônio NEWPC", mono(ativo.patrimonio_newpc))}
        ${dado("Categoria", rotuloDeId("categorias", ativo.categoria) === "—" ? "" : rotuloDeId("categorias", ativo.categoria))}
        ${dado("Subcategoria", ativo.subcategoria)}
        ${dado("Fabricante", ativo.fabricante)}
        ${dado("Modelo", ativo.modelo)}
        ${dadoHTML("Número de série", mono(ativo.numero_serie))}
        ${dadoHTML("Service tag", mono(ativo.service_tag))}
        ${dadoHTML("Patrimônio do fornecedor", mono(ativo.patrimonio_fornecedor))}
        ${dadoHTML("Patrimônio do cliente", mono(ativo.patrimonio_cliente))}
        ${dado("Descrição", ativo.descricao)}
      </div>
    </div>
    <div class="card">
      <div class="card-tit">${ico("cpu", 16)}<h3>Configuração</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${dado("Processador", ativo.processador)}
        ${dado("Memória RAM", ativo.memoria_ram)}
        ${dado("Armazenamento", ativo.armazenamento)}
        ${dado("Sistema operacional", ativo.sistema_operacional)}
        ${dado("Tamanho da tela", ativo.tamanho_tela)}
        ${dado("Especificações adicionais", ativo.especificacoes_adicionais)}
        ${dadoHTML("Condição", ativo.condicao ? badge(C.CONDICAO_ATIVO, ativo.condicao) : "")}
        ${dado("Data de implantação", ativo.data_implantacao ? dataBR(ativo.data_implantacao) : "")}
        ${dado("Observações", ativo.observacoes)}
      </div>
    </div>
  </div>`;
}

/* ---------------------- ABA: LOCALIZAÇÃO ---------------------- */
async function painelLocalizacao({ ativo, id, p, umaVez }) {
  const { dados, erro } = await umaVez("inv", () =>
    buscarSeguro("inventario_itens", [["ativo_id", "==", id]], ["data_hora", "desc"], 50));
  const ultimo = dados[0];
  const dias = ultimo ? diasDesde(ultimo.data_hora) : null;
  const vencido = dias === null || dias > p.diasInventarioVencido;

  return `<div class="grade g2">
    <div class="card">
      <div class="card-tit">${ico("pin", 16)}<h3>Onde o equipamento está</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${dado("Município", rotuloDeId("municipios", ativo.municipio_id) === "—" ? "" : rotuloDeId("municipios", ativo.municipio_id))}
        ${dado("Cliente", rotuloDeId("clientes", ativo.cliente_id) === "—" ? "" : rotuloDeId("clientes", ativo.cliente_id))}
        ${dado("Unidade", rotuloDeId("unidades", ativo.unidade_id) === "—" ? "" : rotuloDeId("unidades", ativo.unidade_id))}
        ${dado("Setor", rotuloDeId("setores", ativo.setor_id) === "—" ? "" : rotuloDeId("setores", ativo.setor_id))}
        ${dado("Local / Sala", rotuloDeId("locais", ativo.local_id) === "—" ? "" : rotuloDeId("locais", ativo.local_id))}
      </div>
    </div>
    <div class="card">
      <div class="card-tit">${ico("clock", 16)}<h3>Última conferência</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${erro ? avisoConsulta(erro) : ""}
        ${dado("Data do último inventário", ultimo ? dataBR(ultimo.data_hora, true) : "")}
        ${dado("Há quantos dias", dias === null ? "" : `${dias} dia(s)`)}
        ${ultimo ? dadoHTML("Resultado registrado", badge(C.RESULTADO_ITEM, ultimo.resultado)) : ""}
        ${ultimo ? dado("Conferido por", ultimo.tecnico_nome) : ""}
        <div style="margin-top:12px">
          ${vencido
            ? `<div class="aviso warn"><div><b>Conferência vencida</b>
                ${ultimo
                  ? `Este equipamento não é conferido há ${dias} dias. O prazo definido é de ${p.diasInventarioVencido} dias.`
                  : `Este equipamento nunca passou por um inventário. O prazo definido é de ${p.diasInventarioVencido} dias.`}
                </div></div>`
            : `<div class="aviso ok"><div><b>Conferência em dia</b>
                Inventariado há ${dias} dia(s), dentro do prazo de ${p.diasInventarioVencido} dias.</div></div>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------------- ABA: PROPRIEDADE (item 53) ---------------------- */
function painelPropriedade({ ativo }) {
  const origem = ativo.origem_ativo;
  const exigeTerceiro = ["LOCADO", "COMODATO"].includes(origem);
  /* Proprietário: se o equipamento é próprio, o dono é a própria NEWPC — não há fornecedor. */
  const proprietario = origem === "PROPRIO"
    ? "NEWPC Tecnologia"
    : (ativo.fornecedor_id ? rotuloDeId("fornecedores", ativo.fornecedor_id) : "");
  const contratoOrigem = ativo.contrato_fornecedor_id
    ? rotuloDeId("contratos_fornecedor", ativo.contrato_fornecedor_id) : "";
  const faltaVinculo = exigeTerceiro && (!ativo.fornecedor_id || !ativo.contrato_fornecedor_id);

  return `<div class="card" style="max-width:760px">
    <div class="card-tit">${ico("shield", 16)}<h3>Propriedade e alocação</h3></div>
    <div class="card-pad">
      <div class="aviso info"><div>
        <b>Duas informações diferentes</b>
        Proprietário é quem detém a posse legal do equipamento. Cliente é onde ele está instalado.
      </div></div>

      ${faltaVinculo ? `<div class="aviso err" style="margin-top:11px"><div>
        <b>Equipamento de terceiro sem fornecedor/contrato vinculado — corrija o cadastro</b>
        Equipamentos com origem ${esc(C.labelDe(C.ORIGEM_ATIVO, origem))} precisam ter o proprietário e o
        contrato de origem preenchidos. Sem isso não é possível prestar contas na devolução.
      </div></div>` : ""}

      <div style="margin-top:14px">
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--texto-2)">
          De quem é o equipamento</div>
        ${dado("Origem", origem ? C.labelDe(C.ORIGEM_ATIVO, origem) : "")}
        ${dado("Proprietário", proprietario)}
        ${dado("Contrato de origem", contratoOrigem)}
      </div>

      <div style="height:1px;background:var(--borda);margin:20px 0 6px"></div>

      <div>
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--texto-2)">
          Onde o equipamento está atendendo</div>
        ${dado("Cliente atual", rotuloDeId("clientes", ativo.cliente_id) === "—" ? "" : rotuloDeId("clientes", ativo.cliente_id))}
        ${dado("Contrato comercial", rotuloDeId("contratos_cliente", ativo.contrato_cliente_id) === "—" ? "" : rotuloDeId("contratos_cliente", ativo.contrato_cliente_id))}
        ${dado("Unidade", rotuloDeId("unidades", ativo.unidade_id) === "—" ? "" : rotuloDeId("unidades", ativo.unidade_id))}
      </div>
    </div>
  </div>`;
}

/* ---------------------- ABA: CONTRATOS ---------------------- */
async function painelContratos({ ativo, umaVez }) {
  const [cf, cc] = await umaVez("contratos", async () => Promise.all([
    ativo.contrato_fornecedor_id ? obter("contratos_fornecedor", ativo.contrato_fornecedor_id) : null,
    ativo.contrato_cliente_id ? obter("contratos_cliente", ativo.contrato_cliente_id) : null
  ]));
  const verValores = ehFinanceiroVisivel();

  const cardFornecedor = cf ? `
    <div class="card">
      <div class="card-tit">${ico("truck", 16)}<h3>Contrato de origem (fornecedor)</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${dado("Código interno", cf.codigo_interno)}
        ${dado("Fornecedor", rotuloDeId("fornecedores", cf.fornecedor_id) === "—" ? "" : rotuloDeId("fornecedores", cf.fornecedor_id))}
        ${dado("Número do contrato", cf.numero_contrato)}
        ${dado("Vigência", cf.data_inicio ? `${dataBR(cf.data_inicio)} até ${cf.data_fim ? dataBR(cf.data_fim) : "sem data final"}` : "")}
        ${dadoHTML("Situação", `${badge(C.STATUS_CONTRATO_FORNECEDOR, cf.status)} ${textoVencimento(cf.data_fim)}`)}
        ${dado("Qtd. prevista de equipamentos", cf.quantidade_prevista)}
        ${verValores ? dado("Valor mensal do contrato", cf.valor_mensal == null ? "" : moeda(cf.valor_mensal)) : ""}
        ${dado("Descrição", cf.descricao)}
      </div>
    </div>` : `
    <div class="card card-pad">
      <div class="aviso ${["LOCADO", "COMODATO"].includes(ativo.origem_ativo) ? "err" : "info"}"><div>
        <b>Sem contrato de origem vinculado</b>
        ${["LOCADO", "COMODATO"].includes(ativo.origem_ativo)
          ? "Este equipamento é de terceiro e precisa estar amarrado a um contrato de fornecedor."
          : "Equipamentos próprios da NEWPC não têm contrato de origem."}</div></div>
    </div>`;

  const cardCliente = cc ? `
    <div class="card">
      <div class="card-tit">${ico("file", 16)}<h3>Contrato comercial (cliente)</h3></div>
      <div class="card-pad" style="padding-top:2px">
        ${dado("Número do contrato", cc.numero_contrato)}
        ${dado("Cliente", rotuloDeId("clientes", cc.cliente_id) === "—" ? "" : rotuloDeId("clientes", cc.cliente_id))}
        ${dado("Modalidade", cc.modalidade)}
        ${dado("Vigência", cc.data_inicio ? `${dataBR(cc.data_inicio)} até ${cc.data_fim ? dataBR(cc.data_fim) : "sem data final"}` : "")}
        ${dadoHTML("Situação", `${badge(C.STATUS_CONTRATO_CLIENTE, cc.status)} ${textoVencimento(cc.data_fim)}`)}
        ${dado("Qtd. prevista", cc.quantidade_prevista)}
        ${dado("Gestor do contrato", cc.gestor_contrato)}
        ${dado("Fiscal do contrato", cc.fiscal_contrato)}
        ${verValores ? dado("Valor global", cc.valor_global == null ? "" : moeda(cc.valor_global)) : ""}
        ${verValores ? dado("Valor mensal", cc.valor_mensal == null ? "" : moeda(cc.valor_mensal)) : ""}
        ${dado("Objeto", cc.objeto)}
      </div>
    </div>` : `
    <div class="card card-pad">
      <div class="aviso info"><div><b>Sem contrato comercial vinculado</b>
        Informe em qual contrato do cliente este equipamento é faturado.</div></div>
    </div>`;

  return `<div class="grade g2">${cardFornecedor}${cardCliente}</div>
    ${verValores ? "" : `<p class="hint" style="margin-top:12px">
      Valores financeiros ficam disponíveis apenas para os perfis Administrador e Diretoria.</p>`}`;
}

/* ---------------------- ABA: INVENTÁRIOS ---------------------- */
async function painelInventarios({ id, umaVez }) {
  const { dados, erro } = await umaVez("inv", () =>
    buscarSeguro("inventario_itens", [["ativo_id", "==", id]], ["data_hora", "desc"], 50));
  if (erro) return avisoConsulta(erro);
  if (!dados.length) return vazio("Nenhuma conferência registrada",
    "Este equipamento ainda não apareceu em nenhum inventário.");

  return `<div class="tab-wrap"><table class="tab"><thead><tr>
      <th>Data/hora</th><th>Inventário</th><th>Técnico</th><th>Resultado</th>
      <th>Local encontrado</th><th>Observação</th></tr></thead><tbody>
    ${dados.map(i => `<tr>
      <td>${dataBR(i.data_hora, true)}</td>
      <td>${mono(i.inventario_codigo) || "—"}</td>
      <td>${esc(i.tecnico_nome || "—")}</td>
      <td>${badge(C.RESULTADO_ITEM, i.resultado)}</td>
      <td>${esc(i.local_encontrado_texto || i.local_esperado_texto || "—")}</td>
      <td>${esc(i.observacao || "—")}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

/* ---------------------- ABA: MOVIMENTAÇÕES ---------------------- */
async function painelMovimentacoes({ id, umaVez }) {
  const { dados, erro } = await umaVez("movimentacoes", () =>
    buscarSeguro("movimentacoes", [["ativo_id", "==", id]], ["data", "desc"], 50));
  if (erro) return avisoConsulta(erro);
  if (!dados.length) return vazio("Nenhuma movimentação",
    "Quando o equipamento for transferido, implantado ou recolhido, o registro aparece aqui.");

  return `<div class="tab-wrap"><table class="tab"><thead><tr>
      <th>Código</th><th>Tipo</th><th>De → Para</th><th>Data</th><th>Usuário</th><th>Situação</th>
    </tr></thead><tbody>
    ${dados.map(m => `<tr>
      <td>${mono(m.codigo) || "—"}</td>
      <td>${esc(C.labelDe(C.TIPO_MOVIMENTACAO, m.tipo))}</td>
      <td>${esc(m.origem_texto || "—")} <span style="color:var(--texto-2)">→</span> ${esc(m.destino_texto || "—")}</td>
      <td>${dataBR(m.data, true)}</td>
      <td>${esc(m.usuario_nome || "—")}</td>
      <td>${badge(C.STATUS_MOVIMENTACAO, m.status)}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

/* ---------------------- ABA: MANUTENÇÕES ---------------------- */
async function painelManutencoes({ id, umaVez }) {
  const { dados, erro } = await umaVez("ocorrencias", () =>
    buscarSeguro("ocorrencias", [["ativo_id", "==", id], ["tipo", "==", "DEFEITO"]], ["data", "desc"], 50));
  if (erro) return avisoConsulta(erro);
  if (!dados.length) return vazio("Nenhum defeito registrado",
    "Este equipamento não possui ocorrências de manutenção.");

  return `<div class="grade g2">
    ${dados.map(o => `<div class="card card-pad">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        <b style="color:var(--marinho);font-size:14.5px">${esc(o.tipo_defeito || "Defeito não classificado")}</b>
        ${o.criticidade ? badge(C.CRITICIDADE, o.criticidade) : ""}
        ${o.status ? `<span class="st st-cinza">${esc(o.status)}</span>` : ""}
      </div>
      <p style="font-size:13.2px;margin-top:8px;line-height:1.5">${esc(o.descricao || "Sem descrição informada.")}</p>
      <div style="font-size:11.8px;color:var(--texto-2);margin-top:9px">
        ${ico("clock", 13)} ${dataBR(o.data, true)} · registrado por ${esc(o.usuario_nome || o.tecnico_nome || "—")}
      </div>
      ${o.solucao ? `<div class="aviso ok" style="margin-top:9px"><div><b>Solução</b>${esc(o.solucao)}</div></div>` : ""}
    </div>`).join("")}
  </div>`;
}

/* ---------------------- ABA: FOTOS ---------------------- */
async function painelFotos({ id, umaVez, recarregar }) {
  const { dados, erro } = await umaVez("fotos", () =>
    buscarSeguro("anexos", [["ativo_id", "==", id], ["tipo", "==", "FOTO"]], ["criado_em", "desc"], 100));
  if (erro) return avisoConsulta(erro);

  const podeEnviar = pode("ativo.editar") || pode("inventario.executar");
  const seletorCategoria = `<select class="inp" id="fot-cat" style="height:30px;font-size:12.5px;width:auto">
    ${C.CATEGORIA_FOTO.map(c => `<option>${esc(c)}</option>`).join("")}</select>`;

  const html = `<div class="card">
    <div class="card-tit">${ico("camera", 16)}<h3>Fotos do equipamento</h3>
      ${podeEnviar ? `<div class="dir">${seletorCategoria}
        <button class="btn sm p" id="fot-add">${ico("upload", 14)}Adicionar foto</button></div>` : ""}
    </div>
    <div class="card-pad">
      <input type="file" accept="image/*" capture="environment" multiple id="fot-input" class="oculto">
      ${dados.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:11px">
        ${dados.map((f, i) => `<div data-foto="${i}" style="cursor:zoom-in">
          <img src="${esc(f.url)}" alt="${esc(f.categoria || "Foto")}" loading="lazy"
               style="width:100%;height:130px;object-fit:cover;border-radius:8px;border:1px solid var(--borda)">
          <div style="font-size:11.5px;color:var(--texto-2);margin-top:4px">${esc(f.categoria || "Sem categoria")}</div>
        </div>`).join("")}
      </div>` : vazio("Nenhuma foto enviada",
        "Fotos ajudam a comprovar estado, etiqueta e localização do equipamento.",
        podeEnviar ? { texto: "Enviar foto", attr: 'id="fot-vazio"' } : null)}
    </div>
  </div>`;

  return {
    html,
    montar(painel) {
      const input = painel.querySelector("#fot-input");
      const disparar = () => input.click();
      painel.querySelector("#fot-add")?.addEventListener("click", disparar);
      painel.querySelector("#fot-vazio")?.addEventListener("click", disparar);

      input.addEventListener("change", async () => {
        const arquivos = [...input.files];
        if (!arquivos.length) return;
        const categoria = painel.querySelector("#fot-cat")?.value || "Outros";
        toast(`Enviando ${arquivos.length} foto(s)…`, "info");
        try {
          for (const f of arquivos) await enviarAnexo(id, f, categoria, "FOTO");
          toast("Foto(s) enviada(s).", "ok");
          await recarregar("fotos");
        } catch (e) {
          console.error(e);
          toast("Não foi possível enviar a foto. Verifique a conexão e tente de novo.", "err");
        }
      });

      painel.querySelectorAll("[data-foto]").forEach(el => el.onclick = () => {
        const f = dados[Number(el.dataset.foto)];
        modal({
          titulo: f.categoria || "Foto do equipamento", tamanho: "g",
          corpo: `<img src="${esc(f.url)}" alt="${esc(f.categoria || "Foto")}"
                    style="width:100%;border-radius:9px;display:block">
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:11px;font-size:12.5px;color:var(--texto-2)">
              <span>${ico("tag", 13)} ${esc(f.categoria || "Sem categoria")}</span>
              <span>${ico("clock", 13)} ${dataBR(f.criado_em, true)}</span>
              <span>${ico("users", 13)} ${esc(f.usuario_nome || "—")}</span>
              <span>${tamanhoArquivo(f.tamanho)}</span>
            </div>`,
          acoes: [{ texto: "Abrir em nova aba", aoClicar: () => { window.open(f.url, "_blank", "noopener"); return false; } },
                  { texto: "Fechar" }]
        });
      });
    }
  };
}

/* ---------------------- ABA: DOCUMENTOS ---------------------- */
async function painelDocumentos({ id, umaVez, recarregar }) {
  const { dados, erro } = await umaVez("docs", () =>
    buscarSeguro("anexos", [["ativo_id", "==", id], ["tipo", "==", "DOCUMENTO"]], ["criado_em", "desc"], 100));
  if (erro) return avisoConsulta(erro);
  const podeEnviar = pode("ativo.editar");

  const html = `<div class="card">
    <div class="card-tit">${ico("file2", 16)}<h3>Documentos anexados</h3>
      ${podeEnviar ? `<div class="dir">
        <button class="btn sm p" id="doc-add">${ico("upload", 14)}Anexar documento</button></div>` : ""}
    </div>
    <div class="card-pad">
      <input type="file" id="doc-input" class="oculto" multiple>
      ${dados.length ? dados.map(d => `
        <div style="display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--borda)">
          <span style="color:var(--petroleo)">${ico("file2", 20)}</span>
          <div style="min-width:0;flex:1">
            <div style="font-size:13.6px;font-weight:600;word-break:break-word">${esc(d.nome_arquivo || "Documento")}</div>
            <div style="font-size:11.5px;color:var(--texto-2)">
              ${esc(d.categoria || "Sem categoria")} · ${tamanhoArquivo(d.tamanho)} ·
              ${dataBR(d.criado_em, true)} · ${esc(d.usuario_nome || "—")}</div>
          </div>
          <a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">${ico("eye", 14)}Abrir</a>
        </div>`).join("")
      : vazio("Nenhum documento anexado",
          "Guarde aqui termos de entrega, notas fiscais e laudos do equipamento.",
          podeEnviar ? { texto: "Anexar documento", attr: 'id="doc-vazio"' } : null)}
    </div>
  </div>`;

  return {
    html,
    montar(painel) {
      const input = painel.querySelector("#doc-input");
      const disparar = () => input.click();
      painel.querySelector("#doc-add")?.addEventListener("click", disparar);
      painel.querySelector("#doc-vazio")?.addEventListener("click", disparar);
      input.addEventListener("change", async () => {
        const arquivos = [...input.files];
        if (!arquivos.length) return;
        toast(`Enviando ${arquivos.length} arquivo(s)…`, "info");
        try {
          for (const f of arquivos) await enviarAnexo(id, f, "Documento", "DOCUMENTO");
          toast("Documento(s) anexado(s).", "ok");
          await recarregar("docs");
        } catch (e) {
          console.error(e);
          toast("Não foi possível anexar o arquivo. Verifique a conexão e tente de novo.", "err");
        }
      });
    }
  };
}

/* ---------------------- ABA: HISTÓRICO ---------------------- */
const COR_HISTORICO = { LOCALIZACAO: "laranja", STATUS: "verde", INVENTARIO: "verde", PROPRIEDADE: "vermelho" };

async function painelHistorico({ id, umaVez }) {
  const eventos = await umaVez("historico", () => historicoDoAtivo(id, 100).catch(e => {
    console.error("[ativos] histórico", e); return null;
  }));
  if (eventos === null) return `<div class="aviso err"><div><b>Não foi possível carregar o histórico</b>
    Tente novamente em instantes.</div></div>`;
  if (!eventos.length) return vazio("Sem histórico", "Nada foi registrado para este equipamento ainda.");

  return `<div class="card card-pad"><div class="timeline">
    ${eventos.map(h => `<div class="tl-item ${COR_HISTORICO[h.tipo] || ""}">
      <div class="data">${dataBR(h.data, true)}</div>
      <b>${esc(h.titulo || h.tipo || "Registro")}</b>
      ${h.detalhe ? `<p>${esc(h.detalhe)}</p>` : ""}
      <p style="opacity:.85">por ${esc(h.usuario_nome || "sistema")}</p>
    </div>`).join("")}
  </div></div>`;
}

/* ---------------------- ABA: AUDITORIA ---------------------- */
async function painelAuditoria({ id, umaVez }) {
  const { dados, erro } = await umaVez("auditoria", () =>
    buscarSeguro("auditoria", [["entidade", "==", "ativos"], ["registro_id", "==", id]], ["criado_em", "desc"], 100));
  if (erro) return avisoConsulta(erro);
  if (!dados.length) return vazio("Sem registros de auditoria",
    "Nenhuma alteração auditável foi feita neste equipamento.");

  const nomeCampo = c => SCHEMA.ativos.campos.find(x => x.n === c)?.l || c.replace(/_/g, " ");
  const valorAuditado = (campo, v) => {
    if (v === null || v === undefined || v === "") return "vazio";
    return valorLegivel(campo, v);
  };

  return `<div class="tab-wrap"><table class="tab"><thead><tr>
      <th>Data/hora</th><th>Usuário</th><th>Operação</th><th>O que mudou</th>
    </tr></thead><tbody>
    ${dados.map(a => `<tr>
      <td>${dataBR(a.criado_em, true)}</td>
      <td>${esc(a.usuario_nome || "—")}<br><small style="color:var(--texto-2)">${esc(C.PERFIL_LABEL[a.usuario_perfil] || "")}</small></td>
      <td><span class="st ${a.operacao === "DELETE" ? "st-vermelho" : a.operacao === "CREATE" ? "st-verde" : "st-azul"}">${esc(a.operacao)}</span></td>
      <td>${(a.mudancas || []).length
        ? (a.mudancas || []).map(m => `<div style="font-size:12.5px">
            <b>${esc(nomeCampo(m.campo))}</b>: ${esc(valorAuditado(m.campo, m.de))}
            <span style="color:var(--texto-2)">→</span> ${esc(valorAuditado(m.campo, m.para))}</div>`).join("")
        : `<span style="color:var(--texto-2)">—</span>`}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

/* =========================================================================
   AÇÃO: IMPRIMIR ETIQUETA
   ========================================================================= */
function abrirEtiqueta(ativo) {
  const codigo = ativo.patrimonio_newpc;
  if (!codigo) return toast("Cadastre o patrimônio NEWPC antes de imprimir a etiqueta.", "warn");

  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="campo" style="max-width:220px">
      <label>Quantas etiquetas iguais imprimir?</label>
      <select class="inp" id="et-qtd">
        ${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}
      </select>
      <span class="hint">Elas saem lado a lado na mesma folha.</span>
    </div>
    <div id="et-previa" style="margin-top:14px;display:flex;flex-wrap:wrap"></div>`;

  const etiqueta = () => `<div class="qr-etiqueta">${qrSVG(codigo, 110)}
    <div class="cod">${esc(codigo)}</div><div class="mrc">NEWPC TECNOLOGIA</div></div>`;

  const previa = corpo.querySelector("#et-previa");
  const qtdSel = corpo.querySelector("#et-qtd");
  const redesenhar = () => { previa.innerHTML = etiqueta().repeat(Number(qtdSel.value)); };
  qtdSel.onchange = redesenhar;
  redesenhar();

  modal({
    titulo: "Etiqueta do equipamento", corpo, tamanho: "g",
    acoes: [
      { texto: "Fechar" },
      { texto: "Imprimir", classe: "p", icone: "print", aoClicar: () => {
        imprimirEtiquetas(previa.innerHTML);
        return false; /* mantém aberto: normalmente se imprime mais de uma vez */
      }}
    ]
  });
}

/* Imprime só as etiquetas: isolamos o conteúdo para não sair a tela inteira na folha. */
function imprimirEtiquetas(html) {
  const area = document.createElement("div");
  area.id = "area-impressao-etiquetas";
  area.innerHTML = html;
  const estilo = document.createElement("style");
  estilo.textContent = `#area-impressao-etiquetas{display:none}
    @media print{
      body > *{display:none!important}
      #area-impressao-etiquetas{display:block!important;position:static}
    }`;
  document.body.append(estilo, area);
  const limpar = () => { area.remove(); estilo.remove(); window.removeEventListener("afterprint", limpar); };
  window.addEventListener("afterprint", limpar);
  window.print();
  setTimeout(limpar, 60000); /* rede de segurança para navegadores sem afterprint */
}

/* =========================================================================
   AÇÃO: TRANSFERIR
   ========================================================================= */
async function abrirTransferencia(ativo, aoConcluir) {
  if (C.STATUS_BLOQUEIA_MOVIMENTACAO.includes(ativo.status))
    return toast(`Equipamento ${C.labelDe(C.STATUS_ATIVO, ativo.status).toLowerCase()} não pode ser movimentado.`, "warn");

  const [clientes, unidades, setores, locais] = await Promise.all(
    ["clientes", "unidades", "setores", "locais"].map(c => listaRef(c)));

  const corpo = document.createElement("div");
  const opcoes = (lista, colecao) => lista.map(x =>
    `<option value="${esc(x.id)}">${esc(rotulo(colecao, x))}</option>`).join("");

  corpo.innerHTML = `
    <div class="aviso info"><div><b>Para onde este equipamento está indo?</b>
      A localização atual é: ${esc(descreverLocal(ativo))}</div></div>
    <div class="form-grade" style="margin-top:14px">
      <div class="campo"><label>Cliente de destino <span class="req">*</span></label>
        <select class="inp" id="tr-cliente"><option value="">— selecione —</option>
          ${opcoes(clientes.filter(x => x.ativo !== false), "clientes")}</select></div>
      <div class="campo"><label>Unidade <span class="req">*</span></label>
        <select class="inp" id="tr-unidade" disabled><option value="">— selecione o cliente —</option></select></div>
      <div class="campo"><label>Setor</label>
        <select class="inp" id="tr-setor" disabled><option value="">— selecione a unidade —</option></select></div>
      <div class="campo"><label>Local / Sala</label>
        <select class="inp" id="tr-local" disabled><option value="">— selecione o setor —</option></select></div>
      <div class="campo w2"><label>Motivo da transferência <span class="req">*</span></label>
        <textarea class="inp" id="tr-motivo" placeholder="Explique por que o equipamento está sendo movido."></textarea>
        <span class="hint">Este texto fica registrado no histórico do equipamento.</span></div>
    </div>
    ${pode("movimentacao.aprovar") ? "" : `<div class="aviso warn" style="margin-top:12px"><div>
      Seu perfil registra a solicitação, mas quem libera a mudança é um analista.
      A transferência ficará pendente de aprovação.</div></div>`}`;

  const selCliente = corpo.querySelector("#tr-cliente");
  const selUnidade = corpo.querySelector("#tr-unidade");
  const selSetor = corpo.querySelector("#tr-setor");
  const selLocal = corpo.querySelector("#tr-local");

  const encher = (sel, lista, colecao, textoVazio) => {
    sel.innerHTML = `<option value="">${textoVazio}</option>` + opcoes(lista, colecao);
    sel.disabled = !lista.length;
  };
  selCliente.onchange = () => {
    encher(selUnidade, unidades.filter(u => u.cliente_id === selCliente.value && u.ativo !== false),
      "unidades", selCliente.value ? "— selecione —" : "— selecione o cliente —");
    encher(selSetor, [], "setores", "— selecione a unidade —");
    encher(selLocal, [], "locais", "— selecione o setor —");
  };
  selUnidade.onchange = () => {
    encher(selSetor, setores.filter(s => s.unidade_id === selUnidade.value), "setores",
      selUnidade.value ? "— opcional —" : "— selecione a unidade —");
    encher(selLocal, [], "locais", "— selecione o setor —");
  };
  selSetor.onchange = () => {
    encher(selLocal, locais.filter(l => l.setor_id === selSetor.value), "locais",
      selSetor.value ? "— opcional —" : "— selecione o setor —");
  };
  /* Pré-seleciona o cliente atual para poupar cliques em transferência interna. */
  if (ativo.cliente_id) { selCliente.value = ativo.cliente_id; selCliente.onchange(); }

  modal({
    titulo: "Transferir equipamento", corpo, tamanho: "g",
    acoes: [
      { texto: "Cancelar" },
      { texto: "Confirmar transferência", classe: "p", icone: "arrows", aoClicar: async () => {
        const motivo = corpo.querySelector("#tr-motivo").value.trim();
        if (!selCliente.value || !selUnidade.value) { toast("Escolha o cliente e a unidade de destino.", "warn"); return false; }
        if (!motivo) { toast("Descreva o motivo da transferência.", "warn"); return false; }

        const unidadeDestino = unidades.find(u => u.id === selUnidade.value);
        const depois = {
          cliente_id: selCliente.value,
          unidade_id: selUnidade.value,
          setor_id: selSetor.value || null,
          local_id: selLocal.value || null,
          /* o município vem da unidade escolhida — nunca é digitado à mão */
          municipio_id: unidadeDestino?.municipio_id || ativo.municipio_id || null
        };

        /* Quem não aprova movimentação apenas solicita: a mudança fica pendente (regra 3). */
        const efetivada = pode("movimentacao.aprovar");
        const codigo = await proximoCodigo("movimentacoes");
        const movId = await criar("movimentacoes", {
          codigo,
          ativo_id: ativo.id,
          ativo_patrimonio: ativo.patrimonio_newpc || null,
          tipo: "TRANSFERENCIA",
          origem_texto: descreverLocal(ativo),
          destino_texto: descreverLocal({ ...ativo, ...depois }),
          cliente_origem: ativo.cliente_id || null,
          cliente_destino: depois.cliente_id,
          unidade_origem: ativo.unidade_id || null,
          unidade_destino: depois.unidade_id,
          data: serverTimestamp(),
          usuario_id: sessao.usuario?.id || null,
          usuario_nome: sessao.usuario?.nome || null,
          motivo,
          status: efetivada ? "EFETIVADA" : "PENDENTE"
        });

        if (efetivada) {
          /* atualizar() já grava histórico de localização e de status — não duplicar aqui. */
          await atualizar("ativos", ativo.id, { ...depois, status: "EM_USO" });
          toast(`Equipamento transferido para ${descreverLocal({ ...ativo, ...depois })}.`, "ok", "Transferência concluída");
        } else {
          await criar("pendencias", {
            codigo: await proximoCodigo("pendencias"),
            tipo: "MOVIMENTACAO",
            status: "ABERTA",
            ativo_id: ativo.id,
            ativo_patrimonio: ativo.patrimonio_newpc || null,
            cliente_id: ativo.cliente_id || null,
            unidade_id: ativo.unidade_id || null,
            /* sem o id a central de pendências não consegue abrir/aprovar a movimentação */
            movimentacao_id: movId,
            movimentacao_codigo: codigo,
            descricao: `Transferência solicitada: ${descreverLocal(ativo)} → ${descreverLocal({ ...ativo, ...depois })}. Motivo: ${motivo}`,
            criado_em: serverTimestamp()
          });
          toast("Sua solicitação foi registrada e aguarda a liberação de um analista.", "info", "Transferência pendente");
        }
        window.NEWPC_atualizarAlertas?.();
        aoConcluir && await aoConcluir();
      }}
    ]
  });
}

/* =========================================================================
   AÇÃO: RECOLHER
   ========================================================================= */
function abrirRecolhimento(ativo, aoConcluir) {
  if (C.STATUS_BLOQUEIA_MOVIMENTACAO.includes(ativo.status))
    return toast(`Equipamento ${C.labelDe(C.STATUS_ATIVO, ativo.status).toLowerCase()} não pode ser recolhido.`, "warn");

  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso info"><div><b>Retirar o equipamento do cliente</b>
      Local atual: ${esc(descreverLocal(ativo))}</div></div>
    <div class="form-grade" style="margin-top:14px">
      <div class="campo w2"><label>Motivo do recolhimento <span class="req">*</span></label>
        <select class="inp" id="rc-motivo"><option value="">— selecione —</option>
          ${C.MOTIVO_RECOLHIMENTO.map(m => `<option>${esc(m)}</option>`).join("")}</select></div>
      <div class="campo w2"><label>Observação</label>
        <textarea class="inp" id="rc-obs" placeholder="Detalhes que ajudem quem vai buscar o equipamento."></textarea></div>
    </div>
    <p class="hint" style="margin-top:10px">O equipamento passa para <b>Aguardando Recolhimento</b> e
    aparece na fila de recolhimentos até ser conferido na NEWPC.</p>`;

  modal({
    titulo: "Solicitar recolhimento", corpo,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Solicitar recolhimento", classe: "p", icone: "box", aoClicar: async () => {
        const motivo = corpo.querySelector("#rc-motivo").value;
        if (!motivo) { toast("Escolha o motivo do recolhimento.", "warn"); return false; }
        await criar("recolhimentos", {
          codigo: await proximoCodigo("recolhimentos"),
          ativo_id: ativo.id,
          ativo_patrimonio: ativo.patrimonio_newpc || null,
          motivo,
          observacao: corpo.querySelector("#rc-obs").value.trim() || null,
          etapa: "AGUARDANDO",
          cliente_id: ativo.cliente_id || null,
          unidade_id: ativo.unidade_id || null,
          solicitado_por: sessao.usuario?.id || null,
          solicitado_por_nome: sessao.usuario?.nome || null,
          criado_em: serverTimestamp()
        });
        /* atualizar() carimba o histórico de status automaticamente. */
        await atualizar("ativos", ativo.id, { status: "AGUARDANDO_RECOLHIMENTO" });
        toast("Recolhimento solicitado. O equipamento entrou na fila de retirada.", "ok");
        aoConcluir && await aoConcluir();
      }}
    ]
  });
}

/* =========================================================================
   ANEXOS (fotos e documentos) — exportado para reuso pelo inventário
   ========================================================================= */

/* Comprime a imagem no navegador antes de subir: foto de celular tem 4–8 MB e
   o técnico costuma estar em rede móvel ruim dentro da escola. */
function comprimirImagem(file, larguraMax, qualidade) {
  return new Promise(resolve => {
    if (!/^image\//.test(file.type) || /svg/.test(file.type)) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, (larguraMax || 1600) / (img.naturalWidth || larguraMax || 1600));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * escala));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * escala));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        b => resolve(b ? new File([b], (file.name || "foto").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file),
        "image/jpeg", qualidade || 0.72);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/**
 * Envia um anexo ao Storage e registra o documento em "anexos".
 * @param {string} ativoId  id do ativo dono do anexo
 * @param {File}   file     arquivo escolhido pelo usuário
 * @param {string} categoria  categoria de foto (ver CATEGORIA_FOTO) ou rótulo livre
 * @param {"FOTO"|"DOCUMENTO"} tipo
 */

/* Regra 6 — reativação de ativo baixado.
   É o único caminho para tirar um equipamento de BAIXADO. Exclusivo do administrador,
   exige justificativa e fica registrado no histórico e na auditoria. */
async function reativarAtivo(ativo, aoConcluir) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="aviso warn" style="margin-bottom:13px">${ico("alert", 18)}<div>
      <b>Este equipamento está baixado.</b>
      Reativar significa devolvê-lo ao parque. A operação fica registrada em auditoria
      com o seu nome, a data e a justificativa.</div></div>
    <div class="campo"><label>Situação após a reativação <span class="req">*</span></label>
      <select class="inp" id="rt-status">
        <option value="EM_ESTOQUE">Em Estoque</option>
        <option value="DISPONIVEL">Disponível</option>
        <option value="EM_MANUTENCAO">Em Manutenção</option>
        <option value="RESERVA">Equipamento Reserva</option>
      </select></div>
    <div class="campo" style="margin-top:11px"><label>Justificativa <span class="req">*</span></label>
      <textarea class="inp" id="rt-motivo"
        placeholder="Por que este equipamento está voltando ao parque?"></textarea></div>`;

  modal({ titulo: "Reativar equipamento", corpo, acoes: [
    { texto: "Cancelar" },
    { texto: "Reativar", classe: "d", icone: "check", aoClicar: async () => {
      const motivo = corpo.querySelector("#rt-motivo").value.trim();
      if (motivo.length < 10) { toast("Descreva o motivo da reativação.", "warn"); return false; }
      await atualizar("ativos", ativo.id,
        { status: corpo.querySelector("#rt-status").value, condicao: ativo.condicao || "REGULAR" },
        { reativacao: true, motivoReativacao: motivo });
      toast("Equipamento reativado.", "ok");
      aoConcluir && aoConcluir();
    }}
  ]});
}

export async function enviarAnexo(ativoId, file, categoria = "Outros", tipo = "FOTO", extra = {}) {
  if (!ativoId || !file) throw new Error("Informe o equipamento e o arquivo.");
  const p = await parametros();
  const arquivo = tipo === "FOTO" ? await comprimirImagem(file, p.larguraMaxFoto, p.qualidadeFoto) : file;

  const nomeSeguro = String(arquivo.name || file.name || "arquivo").replace(/[^\w.\-]+/g, "_");
  const caminho = `ativos/${ativoId}/${tipo.toLowerCase()}/${Date.now()}_${nomeSeguro}`;
  const ref = storageRef(storage, caminho);
  await uploadBytes(ref, arquivo, { contentType: arquivo.type || "application/octet-stream" });
  const url = await getDownloadURL(ref);

  await criar("anexos", {
    ativo_id: ativoId,
    tipo,
    categoria,
    url,
    caminho,
    nome_arquivo: file.name || nomeSeguro,
    tamanho: arquivo.size || null,
    criado_em: serverTimestamp(),
    usuario_id: sessao.usuario?.id || null,
    usuario_nome: sessao.usuario?.nome || null,
    ...extra
  });
  return url;
}
