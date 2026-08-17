/* NEWPC INVENTÁRIO — Camada de acesso a dados
 * Responsabilidades:
 *  - CRUD com auditoria automática (item 44)
 *  - Geração de códigos legíveis sequenciais INV/MOV/REC/DIV (item 56)
 *  - Registro de histórico do ativo (item 27) — nunca sobrescreve sem rastro
 *  - Validação de duplicidade de patrimônio e serial (item 40)
 *  - Paginação e cache de listas pequenas (item 46)
 * Nenhuma view fala com o Firestore diretamente.
 */
import {
  db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, serverTimestamp, runTransaction,
  writeBatch, getCountFromServer
} from "./firebase.js";
import { sessao } from "./auth.js";
import { SCHEMA } from "./schema.js";
import { PARAMETROS_PADRAO, STATUS_FORA_DE_OPERACAO, STATUS_BLOQUEIA_MOVIMENTACAO } from "./config.js";

/* ---------- cache de coleções pequenas (referências) ---------- */
const CACHE_REF = new Map();
const CACHE_TTL = 120000; // 2 min
const REFERENCIAIS = ["fornecedores","clientes","municipios","unidades","setores","locais",
                      "contratos_fornecedor","contratos_cliente","categorias","usuarios"];

export function limparCache(colecao) {
  if (colecao) CACHE_REF.delete(colecao); else CACHE_REF.clear();
}

/** Carrega uma coleção referencial inteira (são centenas, não milhares). */
export async function listaRef(colecao) {
  const c = CACHE_REF.get(colecao);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.dados;
  const snap = await getDocs(collection(db, colecao));
  const dados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  dados.sort((a, b) => rotulo(colecao, a).localeCompare(rotulo(colecao, b), "pt-BR"));
  CACHE_REF.set(colecao, { ts: Date.now(), dados });
  return dados;
}

export function rotulo(colecao, dado) {
  if (!dado) return "—";
  const f = SCHEMA[colecao]?.rotulo;
  return String((f ? f(dado) : dado.nome) ?? dado.id ?? "—");
}

/** Resolve um id em rótulo legível, usando o cache. Devolve "—" se não achar. */
const MAPA_ROTULO = new Map();
export async function preAquecerReferencias() {
  await Promise.all(REFERENCIAIS.map(async col => {
    const lista = await listaRef(col);
    lista.forEach(d => MAPA_ROTULO.set(`${col}:${d.id}`, rotulo(col, d)));
  }));
}
export function rotuloDeId(colecao, id) {
  if (!id) return "—";
  return MAPA_ROTULO.get(`${colecao}:${id}`) || id;
}
export function registrarRotulo(colecao, id, texto) { MAPA_ROTULO.set(`${colecao}:${id}`, texto); }

/* ---------- leitura ---------- */
export async function obter(colecao, id) {
  if (!id) return null;
  const s = await getDoc(doc(db, colecao, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export async function buscar(colecao, filtros = [], ordem = null, tam = 0, cursor = null) {
  const partes = [collection(db, colecao)];
  filtros.forEach(f => partes.push(where(f[0], f[1], f[2])));
  if (ordem) partes.push(orderBy(ordem[0], ordem[1] || "asc"));
  if (cursor) partes.push(startAfter(cursor));
  if (tam) partes.push(limit(tam));
  const snap = await getDocs(query(...partes));
  return {
    dados: snap.docs.map(d => ({ id: d.id, ...d.data() })),
    ultimo: snap.docs[snap.docs.length - 1] || null,
    fim: tam ? snap.docs.length < tam : true
  };
}

export async function contar(colecao, filtros = []) {
  const partes = [collection(db, colecao)];
  filtros.forEach(f => partes.push(where(f[0], f[1], f[2])));
  const s = await getCountFromServer(query(...partes));
  return s.data().count;
}

/* ---------- códigos legíveis sequenciais (item 56) ---------- */
const PREFIXO = { inventarios: "INV", movimentacoes: "MOV", recolhimentos: "REC",
                  pendencias: "DIV", importacoes: "IMP", entradas_lote: "LOT" };

export async function proximoCodigo(colecao) {
  const ano = new Date().getFullYear();
  const pref = PREFIXO[colecao] || "GEN";
  const ref = doc(db, "contadores", `${pref}-${ano}`);
  const seq = await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const n = (s.exists() ? s.data().valor : 0) + 1;
    tx.set(ref, { valor: n, prefixo: pref, ano }, { merge: true });
    return n;
  });
  return `${pref}-${ano}-${String(seq).padStart(6, "0")}`;
}


/* ---------- sequência de patrimônio NEWPC (entrada em lote) ----------
 * Reservar uma faixa inteira numa única transação é o que impede duas pessoas
 * dando entrada ao mesmo tempo de gerarem o mesmo número. Pedir 300 números
 * custa uma transação, não trezentas.
 */
export async function reservarFaixaPatrimonio(quantidade, inicioForcado = null) {
  const p = await parametros();
  const ref = doc(db, "contadores", "PATRIMONIO");
  return runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const ultimo = s.exists() ? s.data().valor : (p.patrimonioInicial - 1);
    const inicio = inicioForcado != null ? Number(inicioForcado) : ultimo + 1;
    const fim = inicio + quantidade - 1;
    /* O contador nunca retrocede: se o usuário forçou um início mais baixo para
       preencher um buraco antigo, o topo da sequência é preservado. */
    tx.set(ref, { valor: Math.max(fim, ultimo), prefixo: "PATRIMONIO",
                  atualizado_em: serverTimestamp() }, { merge: true });
    return { inicio, fim };
  });
}

/** Último patrimônio já reservado. Usado para sugerir o próximo na tela de entrada. */
export async function ultimoPatrimonio() {
  const p = await parametros();
  const d = await obter("contadores", "PATRIMONIO");
  return d?.valor ?? (p.patrimonioInicial - 1);
}

/** Verifica se algum número da faixa já existe como ativo. Uma consulta, não N. */
export async function conflitosNaFaixa(inicio, fim) {
  const { dados } = await buscar("ativos",
    [["patrimonio_newpc", ">=", String(inicio)], ["patrimonio_newpc", "<=", String(fim)]],
    ["patrimonio_newpc", "asc"], 50);
  /* O Firestore compara texto. Reconferimos numericamente para não acusar
     falso positivo com números de tamanhos diferentes. */
  return dados.filter(a => {
    const n = Number(a.patrimonio_newpc);
    return Number.isFinite(n) && n >= inicio && n <= fim;
  });
}

/* ---------- auditoria (item 44) ---------- */
const CAMPOS_AUDITADOS = new Set([
  "patrimonio_newpc","numero_serie","service_tag","origem_ativo","fornecedor_id",
  "contrato_fornecedor_id","cliente_id","contrato_cliente_id","municipio_id",
  "unidade_id","setor_id","local_id","status","condicao","perfil","ativo",
  "valor_mensal","valor_global","razao_social","cnpj"
]);

async function auditar(entidade, registroId, operacao, antes, depois, rotuloReg) {
  const u = sessao.usuario;
  const mudancas = [];
  if (operacao === "UPDATE") {
    for (const k of Object.keys(depois || {})) {
      if (!CAMPOS_AUDITADOS.has(k)) continue;
      const a = antes?.[k] ?? null, d = depois[k] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(d)) mudancas.push({ campo: k, de: a, para: d });
    }
    if (!mudancas.length) return;
  }
  await addDoc(collection(db, "auditoria"), {
    entidade, registro_id: registroId, registro_rotulo: rotuloReg || registroId,
    operacao, mudancas,
    usuario_id: u?.id || null, usuario_nome: u?.nome || "sistema", usuario_perfil: u?.perfil || null,
    criado_em: serverTimestamp()
  });
}

/* ---------- histórico do ativo (item 27) ---------- */
export async function registrarHistorico(ativoId, tipo, titulo, detalhe = "", extra = {}) {
  await addDoc(collection(db, "historico"), {
    ativo_id: ativoId, tipo, titulo, detalhe,
    usuario_id: sessao.usuario?.id || null,
    usuario_nome: sessao.usuario?.nome || "sistema",
    data: serverTimestamp(),
    ...extra
  });
}

export async function historicoDoAtivo(ativoId, tam = 100) {
  const { dados } = await buscar("historico", [["ativo_id", "==", ativoId]], ["data", "desc"], tam);
  return dados;
}

/* ---------- duplicidade (item 40) ---------- */
export async function verificarDuplicidade(colecao, dados, idIgnorar = null) {
  const unicos = SCHEMA[colecao]?.unicos || [];
  const achados = [];
  for (const campo of unicos) {
    const valor = (dados[campo] || "").trim();
    if (!valor) continue;
    const { dados: r } = await buscar(colecao, [[campo, "==", valor]], null, 5);
    r.filter(x => x.id !== idIgnorar).forEach(x => achados.push({ campo, valor, registro: x }));
  }
  return achados;
}

/* ---------- escrita ---------- */
function limpar(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v === "" ? null : v;
  return r;
}

export async function criar(colecao, dados, opcoes = {}) {
  const dup = opcoes.ignorarDuplicidade ? [] : await verificarDuplicidade(colecao, dados);
  if (dup.length) { const e = new Error("DUPLICIDADE"); e.duplicados = dup; throw e; }
  const u = sessao.usuario;
  const payload = limpar({
    ...dados,
    criado_em: serverTimestamp(), atualizado_em: serverTimestamp(),
    criado_por: u?.id || null, criado_por_nome: u?.nome || null,
    atualizado_por: u?.id || null
  });
  const ref = opcoes.id ? doc(db, colecao, opcoes.id) : doc(collection(db, colecao));
  await setDoc(ref, payload);
  limparCache(colecao);
  const rot = rotulo(colecao, dados);
  registrarRotulo(colecao, ref.id, rot);
  await auditar(colecao, ref.id, "CREATE", null, payload, rot);
  if (colecao === "ativos") {
    await registrarHistorico(ref.id, "CADASTRO", "Ativo cadastrado",
      `Patrimônio ${dados.patrimonio_newpc} · ${dados.fabricante || ""} ${dados.modelo || ""}`.trim());
  }
  return ref.id;
}


/* ---------- guardas de regra de negócio (aplicadas a TODOS os caminhos de escrita) ----------
 * Ficam aqui, e não nas telas, porque cada tela é uma porta diferente para o mesmo dado:
 * editor de ativo, importação de planilha, inventário, movimentação e recolhimento.
 * Regra aplicada em um só lugar é regra que não tem como ser esquecida.
 */

/** Campos que descrevem a alocação do equipamento em um cliente. */
const CAMPOS_ALOCACAO = ["cliente_id", "contrato_cliente_id", "unidade_id", "setor_id", "local_id"];

/**
 * Regra 5 — um ativo devolvido ao fornecedor, baixado ou inativo não pode continuar
 * aparecendo como instalado em cliente. Em vez de bloquear a operação e irritar o usuário,
 * limpamos a alocação junto com a mudança de status e registramos isso no histórico.
 */
function aplicarRegraForaDeOperacao(antes, dados) {
  const novoStatus = "status" in dados ? dados.status : antes.status;
  if (!STATUS_FORA_DE_OPERACAO.includes(novoStatus)) return null;
  const tinhaAlocacao = CAMPOS_ALOCACAO.some(k => (k in dados ? dados[k] : antes[k]));
  if (!tinhaAlocacao) return null;
  const local = descreverLocal(antes);
  CAMPOS_ALOCACAO.forEach(k => { dados[k] = null; });
  return local;
}

/**
 * Regra 6 — um ativo baixado não pode ser movimentado sem reativação autorizada.
 * A reativação é um ato explícito: quem chama passa { reativacao: true }, e só o
 * administrador tem essa opção na interface. As rules do Firestore fazem o resto.
 */
function aplicarRegraAtivoBaixado(antes, dados, opcoes) {
  if (!STATUS_BLOQUEIA_MOVIMENTACAO.includes(antes.status)) return;
  if (opcoes.reativacao) return;
  const mexeuEmAlgoRelevante = [...CAMPOS_ALOCACAO, "status", "condicao"]
    .some(k => k in dados && dados[k] !== antes[k]);
  if (!mexeuEmAlgoRelevante) return;
  const e = new Error(
    "Este equipamento está baixado e não pode ser movimentado. " +
    "Um administrador precisa reativá-lo antes, pela ficha do ativo.");
  e.codigo = "ATIVO_BAIXADO";
  throw e;
}

export async function atualizar(colecao, id, dados, opcoes = {}) {
  const antes = await obter(colecao, id);
  if (!antes) throw new Error("Registro não encontrado.");
  const dup = opcoes.ignorarDuplicidade ? [] : await verificarDuplicidade(colecao, dados, id);
  if (dup.length) { const e = new Error("DUPLICIDADE"); e.duplicados = dup; throw e; }

  let alocacaoLimpa = null;
  if (colecao === "ativos") {
    aplicarRegraAtivoBaixado(antes, dados, opcoes);
    alocacaoLimpa = aplicarRegraForaDeOperacao(antes, dados);
  }

  const payload = limpar({ ...dados, atualizado_em: serverTimestamp(), atualizado_por: sessao.usuario?.id || null });
  await updateDoc(doc(db, colecao, id), payload);
  limparCache(colecao);
  const rot = rotulo(colecao, { ...antes, ...dados });
  registrarRotulo(colecao, id, rot);
  await auditar(colecao, id, "UPDATE", antes, payload, rot);

  if (colecao === "ativos") {
    const mudouLocal = ["cliente_id","unidade_id","setor_id","local_id","municipio_id"]
      .some(k => k in dados && dados[k] !== antes[k]);
    if (mudouLocal && !opcoes.semHistorico) {
      await registrarHistorico(id, "LOCALIZACAO", "Localização alterada",
        `${descreverLocal(antes)} → ${descreverLocal({ ...antes, ...dados })}`);
    }
    if ("status" in dados && dados.status !== antes.status) {
      await registrarHistorico(id, "STATUS", "Status alterado", `${antes.status} → ${dados.status}`);
    }
    if ("origem_ativo" in dados && dados.origem_ativo !== antes.origem_ativo) {
      await registrarHistorico(id, "PROPRIEDADE", "Propriedade alterada", `${antes.origem_ativo} → ${dados.origem_ativo}`);
    }
    if (alocacaoLimpa) {
      await registrarHistorico(id, "STATUS", "Alocação encerrada automaticamente",
        `Equipamento saiu de operação (${dados.status}). Estava em: ${alocacaoLimpa}.`);
    }
    if (opcoes.reativacao) {
      await registrarHistorico(id, "STATUS", "Ativo reativado",
        opcoes.motivoReativacao || "Reativação autorizada pelo administrador.");
    }
  }
  return id;
}

export function descreverLocal(a) {
  const p = [rotuloDeId("clientes", a.cliente_id), rotuloDeId("unidades", a.unidade_id)];
  if (a.setor_id) p.push(rotuloDeId("setores", a.setor_id));
  if (a.local_id) p.push(rotuloDeId("locais", a.local_id));
  return p.filter(x => x && x !== "—").join(" / ") || "Sem localização";
}

/* Exclusão lógica preferencial (item 45) */
export async function inativar(colecao, id) {
  return atualizar(colecao, id, { ativo: false });
}

export async function excluir(colecao, id) {
  const temHistorico = await colecaoTemVinculo(colecao, id);
  if (temHistorico) {
    const e = new Error("VINCULADO");
    e.detalhe = temHistorico;
    throw e;
  }
  const antes = await obter(colecao, id);
  await auditar(colecao, id, "DELETE", antes, null, rotulo(colecao, antes));
  await deleteDoc(doc(db, colecao, id));
  limparCache(colecao);
}

/** Bloqueia exclusão física quando há registros dependentes (item 45). */
async function colecaoTemVinculo(colecao, id) {
  const mapa = {
    fornecedores: [["contratos_fornecedor","fornecedor_id"], ["ativos","fornecedor_id"]],
    contratos_fornecedor: [["ativos","contrato_fornecedor_id"]],
    clientes: [["unidades","cliente_id"], ["ativos","cliente_id"], ["contratos_cliente","cliente_id"]],
    contratos_cliente: [["ativos","contrato_cliente_id"]],
    unidades: [["setores","unidade_id"], ["ativos","unidade_id"], ["inventarios","unidade_id"]],
    setores: [["locais","setor_id"], ["ativos","setor_id"]],
    locais: [["ativos","local_id"]],
    municipios: [["clientes","municipio_id"], ["unidades","municipio_id"], ["ativos","municipio_id"]],
    categorias: [["ativos","categoria"]],
    ativos: [["inventario_itens","ativo_id"], ["movimentacoes","ativo_id"]]
  };
  for (const [col, campo] of (mapa[colecao] || [])) {
    const n = await contar(col, [[campo, "==", id]]);
    if (n > 0) return `${n} registro(s) em ${col}`;
  }
  return null;
}

/* ---------- parâmetros do sistema ---------- */
let _params = null;
export async function parametros() {
  if (_params) return _params;
  const d = await obter("parametros", "geral");
  _params = { ...PARAMETROS_PADRAO, ...(d || {}) };
  return _params;
}
export async function salvarParametros(p) {
  await setDoc(doc(db, "parametros", "geral"), { ...p, atualizado_em: serverTimestamp() }, { merge: true });
  _params = null;
  await auditar("parametros", "geral", "UPDATE", null, p, "Parâmetros do sistema");
}

/* ---------- gravação em lote (importação) ---------- */
export async function lote(operacoes) {
  const CHUNK = 400;
  for (let i = 0; i < operacoes.length; i += CHUNK) {
    const b = writeBatch(db);
    operacoes.slice(i, i + CHUNK).forEach(op => {
      const ref = op.id ? doc(db, op.colecao, op.id) : doc(collection(db, op.colecao));
      if (op.tipo === "update") b.update(ref, limpar(op.dados));
      else b.set(ref, limpar(op.dados), { merge: true });
    });
    await b.commit();
  }
  limparCache();
}

export { serverTimestamp, collection, doc, db, addDoc, where, orderBy, limit };
