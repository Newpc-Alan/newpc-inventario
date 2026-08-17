/* NEWPC INVENTÁRIO — Central de relatórios (item 43)
 * Motor genérico: cada relatório é uma definição declarativa {filtros, colunas, carregar}.
 * Nenhum número é inventado — tudo vem de consulta paginada ao banco.
 */
import { buscar, listaRef, rotulo, rotuloDeId, parametros } from "../store.js";
import {
  ico, esc, toast, cabecalhoPagina, carregando, vazio, barraProgresso,
  baixarCSV, dataBR, num, pct, badge
} from "../ui.js";
import { pode } from "../auth.js";
import * as C from "../config.js";

/* Limite de segurança: nunca varremos a coleção de ativos sem teto. */
const LIMITE = 5000;
const PAGINA = 500;

/* ============================================================
 * Helpers de leitura
 * ============================================================ */

/** Varre uma coleção com filtros de igualdade, paginando até o limite de segurança. */
async function varrer(colecao, filtros = [], limite = LIMITE) {
  const saida = [];
  let cursor = null;
  while (saida.length < limite) {
    const { dados, ultimo, fim } = await buscar(colecao, filtros, null, PAGINA, cursor);
    saida.push(...dados);
    if (fim || !ultimo) return { linhas: saida, truncado: false };
    cursor = ultimo;
  }
  return { linhas: saida.slice(0, limite), truncado: true };
}

/** Aplica filtros que não vão ao banco (período e status múltiplo) em memória. */
function filtrarPeriodo(linhas, campo, de, ate) {
  if (!de && !ate) return linhas;
  const ini = de ? new Date(de + "T00:00:00").getTime() : -Infinity;
  const fim = ate ? new Date(ate + "T23:59:59").getTime() : Infinity;
  return linhas.filter(d => {
    const v = d[campo];
    const dt = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
    if (!dt || isNaN(dt)) return false;
    const t = dt.getTime();
    return t >= ini && t <= fim;
  });
}

/** Monta os filtros de igualdade a partir do que o usuário escolheu. */
function eqDe(valores, campos) {
  return campos.filter(c => valores[c]).map(c => [c, "==", valores[c]]);
}

/** Agrupa em memória e devolve linhas com contagem e percentual. */
function agrupar(linhas, chaveFn, rotuloFn) {
  const mapa = new Map();
  linhas.forEach(d => {
    const k = chaveFn(d) || "__vazio__";
    mapa.set(k, (mapa.get(k) || 0) + 1);
  });
  const total = linhas.length;
  return [...mapa.entries()]
    .map(([k, n]) => ({
      grupo: k === "__vazio__" ? "Não informado" : rotuloFn(k),
      quantidade: n,
      percentual: pct(n, total)
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/* Colunas reaproveitadas nas listagens de ativos */
const COLS_ATIVO = [
  { n: "patrimonio_newpc", l: "Patrimônio", mono: true },
  { n: "categoria", l: "Categoria", v: d => rotuloDeId("categorias", d.categoria) },
  { n: "fabricante", l: "Fabricante" },
  { n: "modelo", l: "Modelo" },
  { n: "numero_serie", l: "Nº de série", mono: true },
  { n: "cliente_id", l: "Cliente", v: d => rotuloDeId("clientes", d.cliente_id) },
  { n: "unidade_id", l: "Unidade", v: d => rotuloDeId("unidades", d.unidade_id) },
  { n: "setor_id", l: "Setor", v: d => rotuloDeId("setores", d.setor_id) },
  { n: "local_id", l: "Local", v: d => rotuloDeId("locais", d.local_id) },
  { n: "origem_ativo", l: "Origem", v: d => C.labelDe(C.ORIGEM_ATIVO, d.origem_ativo) },
  { n: "status", l: "Status", v: d => C.labelDe(C.STATUS_ATIVO, d.status), badge: C.STATUS_ATIVO }
];

const COLS_GRUPO = [
  { n: "grupo", l: "Agrupamento" },
  { n: "quantidade", l: "Quantidade", numerico: true },
  { n: "percentual", l: "Participação", barra: true }
];

/* Filtros mais usados */
const F_CLIENTE = { n: "cliente_id", l: "Cliente", t: "ref", ref: "clientes" };
const F_UNIDADE = { n: "unidade_id", l: "Unidade", t: "ref", ref: "unidades" };
const F_MUNICIPIO = { n: "municipio_id", l: "Município", t: "ref", ref: "municipios" };
const F_CATEGORIA = { n: "categoria", l: "Categoria", t: "ref", ref: "categorias" };
const F_FORNECEDOR = { n: "fornecedor_id", l: "Fornecedor", t: "ref", ref: "fornecedores" };
const F_CTR_FORN = { n: "contrato_fornecedor_id", l: "Contrato do fornecedor", t: "ref", ref: "contratos_fornecedor" };
const F_CTR_CLI = { n: "contrato_cliente_id", l: "Contrato do cliente", t: "ref", ref: "contratos_cliente" };
const F_STATUS = { n: "status", l: "Status", t: "select", opcoes: C.STATUS_ATIVO };
const F_ORIGEM = { n: "origem_ativo", l: "Origem", t: "select", opcoes: C.ORIGEM_ATIVO };

/** Consulta padrão de ativos com os filtros escolhidos. */
async function ativosFiltrados(f, campos = ["cliente_id", "unidade_id", "municipio_id", "categoria",
  "status", "origem_ativo", "fornecedor_id", "contrato_fornecedor_id", "contrato_cliente_id", "setor_id"]) {
  return varrer("ativos", eqDe(f, campos));
}

/* ============================================================
 * Definição dos relatórios
 * ============================================================ */

const RELATORIOS = [

  /* ---------- INVENTÁRIO ---------- */
  {
    id: "inventario_geral", secao: "Inventário", icone: "cpu",
    titulo: "Inventário Geral",
    descricao: "Todos os equipamentos com localização, propriedade e situação.",
    filtros: [F_CLIENTE, F_UNIDADE, F_MUNICIPIO, F_CATEGORIA, F_STATUS, F_ORIGEM],
    colunas: COLS_ATIVO,
    carregar: f => ativosFiltrados(f)
  },
  {
    id: "inventario_cliente", secao: "Inventário", icone: "building",
    titulo: "Inventário por Cliente",
    descricao: "Quantos equipamentos existem em cada cliente atendido.",
    filtros: [F_MUNICIPIO, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Cliente" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.cliente_id, id => rotuloDeId("clientes", id)), truncado: r.truncado };
    }
  },
  {
    id: "inventario_municipio", secao: "Inventário", icone: "map",
    titulo: "Inventário por Município",
    descricao: "Distribuição do parque instalado por cidade.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Município" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.municipio_id, id => rotuloDeId("municipios", id)), truncado: r.truncado };
    }
  },
  {
    id: "inventario_unidade", secao: "Inventário", icone: "school",
    titulo: "Inventário por Unidade",
    descricao: "Total de equipamentos em cada escola, secretaria ou prédio.",
    filtros: [F_CLIENTE, F_MUNICIPIO, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Unidade" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.unidade_id, id => rotuloDeId("unidades", id)), truncado: r.truncado };
    }
  },
  {
    id: "inventario_contrato", secao: "Inventário", icone: "file",
    titulo: "Inventário por Contrato",
    descricao: "Equipamentos vinculados a cada contrato comercial com cliente.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Contrato" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.contrato_cliente_id, id => rotuloDeId("contratos_cliente", id)), truncado: r.truncado };
    }
  },

  /* ---------- ATIVOS ---------- */
  {
    id: "ativos_origem", secao: "Ativos", icone: "box",
    titulo: "Ativos por Origem",
    descricao: "Quanto é próprio, locado, comodato ou do cliente.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Origem" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.origem_ativo, v => C.labelDe(C.ORIGEM_ATIVO, v)), truncado: r.truncado };
    }
  },
  {
    id: "ativos_fornecedor", secao: "Ativos", icone: "truck",
    titulo: "Ativos por Fornecedor",
    descricao: "Quantos equipamentos pertencem a cada fornecedor proprietário.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS, F_ORIGEM],
    colunas: [{ ...COLS_GRUPO[0], l: "Fornecedor" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.fornecedor_id, id => rotuloDeId("fornecedores", id)), truncado: r.truncado };
    }
  },
  {
    id: "ativos_contrato_fornecedor", secao: "Ativos", icone: "file2",
    titulo: "Ativos por Contrato de Fornecedor",
    descricao: "Equipamentos de cada operação/lote locado de terceiros.",
    filtros: [F_FORNECEDOR, F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Contrato / operação" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.contrato_fornecedor_id, id => rotuloDeId("contratos_fornecedor", id)), truncado: r.truncado };
    }
  },
  {
    id: "por_categoria", secao: "Ativos", icone: "tag",
    titulo: "Equipamentos por Categoria",
    descricao: "Quantidade de desktops, notebooks, monitores e demais tipos.",
    filtros: [F_CLIENTE, F_UNIDADE, F_STATUS, F_ORIGEM],
    colunas: [{ ...COLS_GRUPO[0], l: "Categoria" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => d.categoria, id => rotuloDeId("categorias", id)), truncado: r.truncado };
    }
  },
  {
    id: "por_marca", secao: "Ativos", icone: "layers",
    titulo: "Equipamentos por Marca",
    descricao: "Participação de cada fabricante no parque instalado.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Fabricante" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return { linhas: agrupar(r.linhas, d => (d.fabricante || "").trim(), v => v), truncado: r.truncado };
    }
  },
  {
    id: "por_modelo", secao: "Ativos", icone: "cpu",
    titulo: "Equipamentos por Modelo",
    descricao: "Modelos mais presentes, úteis para padronizar peças e suporte.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_STATUS],
    colunas: [{ ...COLS_GRUPO[0], l: "Fabricante e modelo" }, COLS_GRUPO[1], COLS_GRUPO[2]],
    async carregar(f) {
      const r = await ativosFiltrados(f);
      return {
        linhas: agrupar(r.linhas, d => [d.fabricante, d.modelo].filter(Boolean).join(" ").trim(), v => v),
        truncado: r.truncado
      };
    }
  },

  /* ---------- OPERAÇÃO ---------- */
  {
    id: "nao_localizados", secao: "Operação", icone: "alert",
    titulo: "Equipamentos Não Localizados",
    descricao: "Itens que o inventário não encontrou e continuam pendentes.",
    filtros: [F_CLIENTE, F_UNIDADE, F_CATEGORIA],
    colunas: COLS_ATIVO,
    carregar: f => varrer("ativos", [...eqDe(f, ["cliente_id", "unidade_id", "categoria"]), ["status", "==", "NAO_LOCALIZADO"]])
  },
  {
    id: "divergentes", secao: "Operação", icone: "arrows",
    titulo: "Equipamentos Divergentes",
    descricao: "Divergências de localização apontadas nos inventários.",
    filtros: [
      { n: "status", l: "Situação da pendência", t: "select", opcoes: C.STATUS_PENDENCIA, def: "ABERTA" },
      { n: "de", l: "Aberta a partir de", t: "date" },
      { n: "ate", l: "Aberta até", t: "date" }
    ],
    colunas: COLS_PENDENCIA(),
    async carregar(f) {
      const r = await varrer("pendencias", [["tipo", "==", "DIVERGENCIA_LOCAL"], ...eqDe(f, ["status"])]);
      return { linhas: filtrarPeriodo(r.linhas, "criado_em", f.de, f.ate), truncado: r.truncado };
    }
  },
  {
    id: "com_defeito", secao: "Operação", icone: "wrench",
    titulo: "Equipamentos com Defeito",
    descricao: "Defeitos registrados em campo e ainda não resolvidos.",
    filtros: [
      { n: "status", l: "Situação da pendência", t: "select", opcoes: C.STATUS_PENDENCIA, def: "ABERTA" },
      { n: "de", l: "Registrado a partir de", t: "date" },
      { n: "ate", l: "Registrado até", t: "date" }
    ],
    colunas: COLS_PENDENCIA(),
    async carregar(f) {
      const r = await varrer("pendencias", [["tipo", "==", "DEFEITO"], ...eqDe(f, ["status"])]);
      return { linhas: filtrarPeriodo(r.linhas, "criado_em", f.de, f.ate), truncado: r.truncado };
    }
  },
  {
    id: "em_manutencao", secao: "Operação", icone: "wrench",
    titulo: "Equipamentos em Manutenção",
    descricao: "Itens em conserto ou parados aguardando peça.",
    filtros: [F_CLIENTE, F_CATEGORIA, F_FORNECEDOR],
    colunas: COLS_ATIVO,
    async carregar(f) {
      const base = eqDe(f, ["cliente_id", "categoria", "fornecedor_id"]);
      const a = await varrer("ativos", [...base, ["status", "==", "EM_MANUTENCAO"]]);
      const b = await varrer("ativos", [...base, ["status", "==", "AGUARDANDO_PECA"]]);
      return { linhas: [...a.linhas, ...b.linhas], truncado: a.truncado || b.truncado };
    }
  },
  {
    id: "aguardando_recolhimento", secao: "Operação", icone: "box",
    titulo: "Equipamentos Aguardando Recolhimento",
    descricao: "Itens já marcados para retirada e ainda no cliente.",
    filtros: [F_CLIENTE, F_UNIDADE, F_CATEGORIA],
    colunas: COLS_ATIVO,
    carregar: f => varrer("ativos", [...eqDe(f, ["cliente_id", "unidade_id", "categoria"]),
      ["status", "==", "AGUARDANDO_RECOLHIMENTO"]])
  },
  {
    id: "sem_inventario", secao: "Operação", icone: "clock",
    titulo: "Equipamentos sem Inventário",
    descricao: "Itens não conferidos há mais tempo do que o prazo definido.",
    filtros: [
      F_CLIENTE, F_UNIDADE, F_CATEGORIA,
      { n: "dias", l: "Sem conferência há mais de (dias)", t: "int" }
    ],
    colunas: [
      ...COLS_ATIVO.slice(0, 7),
      { n: "_ultimo", l: "Último inventário", v: d => d._ultimo ? dataBR(d._ultimo) : "Nunca conferido" },
      { n: "_dias", l: "Dias sem conferência", numerico: true, v: d => d._dias === null ? "—" : d._dias }
    ],
    async carregar(f) {
      const p = await parametros();
      const dias = Number(f.dias) || p.diasInventarioVencido || 90;
      const r = await ativosFiltrados(f, ["cliente_id", "unidade_id", "categoria"]);
      const agora = Date.now();
      const linhas = r.linhas.map(d => {
        const bruto = d.ultimo_inventario_em ?? d.ultimo_inventario ?? d.data_ultimo_inventario ?? null;
        const dt = bruto?.toDate ? bruto.toDate() : (bruto ? new Date(bruto) : null);
        const valido = dt && !isNaN(dt);
        return { ...d, _ultimo: valido ? dt : null, _dias: valido ? Math.floor((agora - dt.getTime()) / 86400000) : null };
      }).filter(d => d._dias === null || d._dias > dias)
        .sort((a, b) => (b._dias ?? 1e9) - (a._dias ?? 1e9));
      return { linhas, truncado: r.truncado, nota: `Considerando o prazo de ${dias} dias.` };
    }
  },
  {
    id: "movimentacoes", secao: "Operação", icone: "arrows",
    titulo: "Histórico de Movimentações",
    descricao: "Implantações, transferências, envios e baixas registradas.",
    filtros: [
      { n: "tipo", l: "Tipo", t: "select", opcoes: C.TIPO_MOVIMENTACAO },
      { n: "status", l: "Situação", t: "select", opcoes: C.STATUS_MOVIMENTACAO },
      F_CLIENTE,
      { n: "de", l: "De", t: "date" }, { n: "ate", l: "Até", t: "date" }
    ],
    colunas: [
      { n: "codigo", l: "Código", mono: true },
      { n: "tipo", l: "Tipo", v: d => C.labelDe(C.TIPO_MOVIMENTACAO, d.tipo) },
      { n: "ativo", l: "Equipamento", v: d => d.ativo_patrimonio || d.patrimonio_newpc || rotuloDeId("ativos", d.ativo_id) },
      { n: "de_para", l: "De → Para", v: d => `${d.origem_texto || rotuloDeId("unidades", d.unidade_origem)}` +
        ` → ${d.destino_texto || rotuloDeId("unidades", d.unidade_destino)}` },
      { n: "status", l: "Situação", v: d => C.labelDe(C.STATUS_MOVIMENTACAO, d.status), badge: C.STATUS_MOVIMENTACAO },
      { n: "data", l: "Data", v: d => dataBR(d.data || d.criado_em, true) },
      { n: "usuario", l: "Responsável", v: d => d.usuario_nome || d.criado_por_nome || "—" }
    ],
    async carregar(f) {
      /* cliente_destino é o campo gravado por movimentacoes.js — não existe "cliente_id" aqui */
      const filtros = eqDe(f, ["tipo", "status"]);
      if (f.cliente_id) filtros.push(["cliente_destino", "==", f.cliente_id]);
      const r = await varrer("movimentacoes", filtros);
      return { linhas: filtrarPeriodo(r.linhas, "data", f.de, f.ate), truncado: r.truncado };
    }
  },
  {
    id: "recolhimentos", secao: "Operação", icone: "truck",
    titulo: "Recolhimentos",
    descricao: "Retiradas de equipamento em andamento e já concluídas.",
    filtros: [
      { n: "etapa", l: "Etapa", t: "select", opcoes: C.FLUXO_RECOLHIMENTO },
      F_CLIENTE, F_UNIDADE,
      { n: "de", l: "De", t: "date" }, { n: "ate", l: "Até", t: "date" }
    ],
    colunas: [
      { n: "codigo", l: "Código", mono: true },
      { n: "cliente_id", l: "Cliente", v: d => rotuloDeId("clientes", d.cliente_id) },
      { n: "unidade_id", l: "Unidade", v: d => rotuloDeId("unidades", d.unidade_id) },
      { n: "motivo", l: "Motivo" },
      { n: "ativo_patrimonio", l: "Equipamento", mono: true, v: d => d.ativo_patrimonio || "—" },
      { n: "etapa", l: "Etapa", v: d => C.labelDe(C.FLUXO_RECOLHIMENTO, d.etapa), badge: C.FLUXO_RECOLHIMENTO },
      { n: "criado_em", l: "Abertura", v: d => dataBR(d.criado_em, true) }
    ],
    async carregar(f) {
      const r = await varrer("recolhimentos", eqDe(f, ["etapa", "cliente_id", "unidade_id"]));
      return { linhas: filtrarPeriodo(r.linhas, "criado_em", f.de, f.ate), truncado: r.truncado };
    }
  },
  {
    id: "estoque", secao: "Operação", icone: "box",
    titulo: "Estoque",
    descricao: "Equipamentos parados na NEWPC, prontos para implantação ou reserva.",
    filtros: [
      { n: "status", l: "Situação no estoque", t: "select",
        opcoes: C.STATUS_ATIVO.filter(s => ["EM_ESTOQUE", "DISPONIVEL", "RESERVA", "RECEBIDO_NEWPC"].includes(s.v)),
        def: "EM_ESTOQUE" },
      F_CATEGORIA, F_ORIGEM, F_FORNECEDOR
    ],
    colunas: [
      COLS_ATIVO[0], COLS_ATIVO[1], COLS_ATIVO[2], COLS_ATIVO[3], COLS_ATIVO[4],
      { n: "condicao", l: "Condição", v: d => C.labelDe(C.CONDICAO_ATIVO, d.condicao), badge: C.CONDICAO_ATIVO },
      COLS_ATIVO[9], COLS_ATIVO[10]
    ],
    carregar: f => varrer("ativos", eqDe({ ...f, status: f.status || "EM_ESTOQUE" },
      ["status", "categoria", "origem_ativo", "fornecedor_id"]))
  },

  /* ---------- CONTRATOS ---------- */
  {
    id: "contratos_fornecedor", secao: "Contratos", icone: "file2",
    titulo: "Contratos de Fornecedor",
    descricao: "Locações de terceiros, prazos e quantidade contratada.",
    filtros: [
      F_FORNECEDOR,
      { n: "status", l: "Situação", t: "select", opcoes: C.STATUS_CONTRATO_FORNECEDOR }
    ],
    colunas: [
      { n: "codigo_interno", l: "Código interno", mono: true },
      { n: "fornecedor_id", l: "Fornecedor", v: d => rotuloDeId("fornecedores", d.fornecedor_id) },
      { n: "numero_contrato", l: "Nº do contrato" },
      { n: "data_inicio", l: "Início", v: d => dataBR(d.data_inicio) },
      { n: "data_fim", l: "Término", v: d => dataBR(d.data_fim) },
      { n: "_dias", l: "Dias para vencer", numerico: true, v: d => d._dias == null ? "—" : d._dias },
      { n: "quantidade_prevista", l: "Qtd. prevista", numerico: true },
      { n: "status", l: "Situação", v: d => C.labelDe(C.STATUS_CONTRATO_FORNECEDOR, d.status), badge: C.STATUS_CONTRATO_FORNECEDOR }
    ],
    async carregar(f) {
      const r = await varrer("contratos_fornecedor", eqDe(f, ["fornecedor_id", "status"]));
      return { linhas: r.linhas.map(comDiasParaVencer), truncado: r.truncado };
    }
  },
  {
    id: "contratos_cliente", secao: "Contratos", icone: "file",
    titulo: "Contratos com Clientes",
    descricao: "Contratos comerciais vigentes, prazos e vencimentos próximos.",
    filtros: [
      F_CLIENTE,
      { n: "status", l: "Situação", t: "select", opcoes: C.STATUS_CONTRATO_CLIENTE }
    ],
    colunas: [
      { n: "numero_contrato", l: "Nº do contrato", mono: true },
      { n: "cliente_id", l: "Cliente", v: d => rotuloDeId("clientes", d.cliente_id) },
      { n: "modalidade", l: "Modalidade" },
      { n: "data_inicio", l: "Início", v: d => dataBR(d.data_inicio) },
      { n: "data_fim", l: "Término", v: d => dataBR(d.data_fim) },
      { n: "_dias", l: "Dias para vencer", numerico: true, v: d => d._dias == null ? "—" : d._dias },
      { n: "quantidade_prevista", l: "Qtd. prevista", numerico: true },
      { n: "status", l: "Situação", v: d => C.labelDe(C.STATUS_CONTRATO_CLIENTE, d.status), badge: C.STATUS_CONTRATO_CLIENTE }
    ],
    async carregar(f) {
      const r = await varrer("contratos_cliente", eqDe(f, ["cliente_id", "status"]));
      return { linhas: r.linhas.map(comDiasParaVencer), truncado: r.truncado };
    }
  }
];

function comDiasParaVencer(d) {
  const fim = d.data_fim ? new Date(String(d.data_fim).slice(0, 10) + "T12:00:00") : null;
  const dias = fim && !isNaN(fim) ? Math.ceil((fim.getTime() - Date.now()) / 86400000) : null;
  return { ...d, _dias: dias };
}

/* Colunas comuns dos relatórios baseados em pendências. */
function COLS_PENDENCIA() {
  return [
    { n: "codigo", l: "Código", mono: true },
    { n: "ativo", l: "Equipamento", mono: true,
      v: d => d.ativo_patrimonio || d.patrimonio_newpc || rotuloDeId("ativos", d.ativo_id) },
    { n: "cliente_id", l: "Cliente", v: d => rotuloDeId("clientes", d.cliente_id) },
    { n: "unidade_id", l: "Unidade", v: d => rotuloDeId("unidades", d.unidade_id) },
    { n: "descricao", l: "Descrição", v: d => d.descricao || d.detalhe || d.titulo || "—" },
    { n: "criticidade", l: "Criticidade", v: d => C.labelDe(C.CRITICIDADE, d.criticidade), badge: C.CRITICIDADE },
    { n: "status", l: "Situação", v: d => C.labelDe(C.STATUS_PENDENCIA, d.status), badge: C.STATUS_PENDENCIA },
    { n: "criado_em", l: "Aberta em", v: d => dataBR(d.criado_em, true) }
  ];
}

const SECOES = ["Inventário", "Ativos", "Operação", "Contratos"];

/* ============================================================
 * View
 * ============================================================ */

export async function relatorios(alvo, ctx) {
  if (!pode("relatorio.ver") && !pode("*")) {
    alvo.innerHTML = cabecalhoPagina("Relatórios") +
      `<div class="aviso warn"><div><b>Você não tem acesso aos relatórios.</b>
      Fale com um administrador se precisar dessas informações.</div></div>`;
    return;
  }

  alvo.innerHTML = cabecalhoPagina(
    "Central de relatórios",
    "Escolha um relatório, ajuste os filtros e gere. Todos os números vêm direto do banco.",
  ) + `<div id="rel-cards"></div><div id="rel-painel" style="margin-top:18px"></div>`;

  const elCards = alvo.querySelector("#rel-cards");
  const elPainel = alvo.querySelector("#rel-painel");

  elCards.innerHTML = SECOES.map(secao => {
    const itens = RELATORIOS.filter(r => r.secao === secao);
    if (!itens.length) return "";
    return `<div style="margin-bottom:18px">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;
        color:var(--texto-2);margin-bottom:9px">${esc(secao)}</div>
      <div class="grade g-auto">
        ${itens.map(r => `<button class="card card-pad" data-rel="${r.id}"
          style="text-align:left;cursor:pointer;border:1px solid var(--borda);display:block;width:100%">
          <div style="display:flex;align-items:center;gap:9px;color:var(--petroleo)">
            ${ico(r.icone, 19)}
            <b style="font-size:14px;color:var(--marinho)">${esc(r.titulo)}</b></div>
          <div style="font-size:12.5px;color:var(--texto-2);margin-top:6px;line-height:1.4">
            ${esc(r.descricao)}</div>
        </button>`).join("")}
      </div></div>`;
  }).join("");

  elCards.querySelectorAll("[data-rel]").forEach(b => b.onclick = () => abrir(b.dataset.rel));

  /* Permite abrir direto por #/relatorios/<id> */
  if (ctx?.id && RELATORIOS.some(r => r.id === ctx.id)) abrir(ctx.id);

  async function abrir(id) {
    const rel = RELATORIOS.find(r => r.id === id);
    const valores = {};
    rel.filtros.forEach(f => { if (f.def) valores[f.n] = f.def; });

    elPainel.innerHTML = `<div class="card">
      <div class="card-tit">${ico(rel.icone, 18)}<h3>${esc(rel.titulo)}</h3>
        <div class="dir"><button class="btn sm" id="rel-fechar">${ico("x", 14)}Fechar</button></div></div>
      <div class="card-pad">
        <p style="font-size:13px;color:var(--texto-2);margin-bottom:12px">${esc(rel.descricao)}</p>
        <div class="filtros" style="margin-bottom:0"><div class="linha" id="rel-filtros"></div>
          <div class="pe">
            <button class="btn p" id="rel-gerar">${ico("chart", 15)}Gerar</button>
            <button class="btn" id="rel-csv" disabled>${ico("down", 15)}Exportar CSV</button>
            <button class="btn" id="rel-print" disabled>${ico("print", 15)}Imprimir</button>
          </div></div>
      </div>
      <div id="rel-saida"></div>
    </div>`;
    elPainel.scrollIntoView({ behavior: "smooth", block: "start" });
    elPainel.querySelector("#rel-fechar").onclick = () => { elPainel.innerHTML = ""; };

    /* filtros */
    const box = elPainel.querySelector("#rel-filtros");
    for (const f of rel.filtros) {
      if (f.t === "ref") {
        const lista = await listaRef(f.ref);
        box.insertAdjacentHTML("beforeend",
          `<select class="inp" data-f="${f.n}"><option value="">${esc(f.l)}: todos</option>
            ${lista.map(x => `<option value="${esc(x.id)}">${esc(rotulo(f.ref, x))}</option>`).join("")}</select>`);
      } else if (f.t === "select") {
        box.insertAdjacentHTML("beforeend",
          `<select class="inp" data-f="${f.n}"><option value="">${esc(f.l)}: todos</option>
            ${f.opcoes.map(o => `<option value="${esc(o.v ?? o)}" ${(o.v ?? o) === f.def ? "selected" : ""}
              >${esc(o.label ?? o)}</option>`).join("")}</select>`);
      } else if (f.t === "date") {
        box.insertAdjacentHTML("beforeend",
          `<div class="campo"><label>${esc(f.l)}</label><input class="inp" type="date" data-f="${f.n}"></div>`);
      } else {
        box.insertAdjacentHTML("beforeend",
          `<div class="campo"><label>${esc(f.l)}</label>
            <input class="inp" type="number" step="1" data-f="${f.n}" placeholder="${esc(f.def ?? "")}"></div>`);
      }
    }
    box.querySelectorAll("[data-f]").forEach(el =>
      el.onchange = () => { valores[el.dataset.f] = el.value || undefined; });

    const saida = elPainel.querySelector("#rel-saida");
    const btnCsv = elPainel.querySelector("#rel-csv");
    const btnPrint = elPainel.querySelector("#rel-print");
    let ultimo = null;

    elPainel.querySelector("#rel-gerar").onclick = gerar;
    btnCsv.onclick = () => {
      if (!ultimo?.linhas.length) return;
      baixarCSV(rel.id, rel.colunas.map(c => c.l),
        ultimo.linhas.map(l => rel.colunas.map(c => {
          const v = c.v ? c.v(l) : l[c.n];
          return c.barra ? `${v}%` : (v ?? "");
        })));
      toast(`${ultimo.linhas.length} linha(s) exportada(s).`, "ok");
    };
    btnPrint.onclick = () => window.print();

    async function gerar() {
      saida.innerHTML = `<div style="padding:6px 0">${carregando("Consultando o banco de dados…")}</div>`;
      btnCsv.disabled = btnPrint.disabled = true;
      let r;
      try { r = await rel.carregar(valores); }
      catch (e) {
        console.error(e);
        saida.innerHTML = `<div style="padding:14px"><div class="aviso err"><div><b>Não foi possível gerar</b>
          ${/index/i.test(e.message)
            ? "Esta combinação de filtros precisa de um índice no banco. Abra o console do navegador e clique no link que o Firebase gerou para criá-lo."
            : esc(e.message)}</div></div></div>`;
        return;
      }
      ultimo = r;
      const ehGrupo = rel.colunas.some(c => c.barra);

      if (!r.linhas.length) {
        saida.innerHTML = `<div style="padding:6px 0">${vazio("Nenhum registro encontrado",
          "Nada se encaixa nos filtros escolhidos. Tente ampliar o período ou remover algum filtro.")}</div>`;
        return;
      }
      btnCsv.disabled = btnPrint.disabled = false;

      const totalQtd = ehGrupo ? r.linhas.reduce((s, l) => s + (l.quantidade || 0), 0) : r.linhas.length;

      saida.innerHTML = `
        ${r.truncado ? `<div style="padding:0 16px 12px"><div class="aviso warn"><div>
          <b>Resultado truncado em ${num(LIMITE)} registros</b>
          Para não sobrecarregar o sistema paramos a leitura aqui. Aplique um filtro de cliente, unidade
          ou categoria para ver o número exato.</div></div></div>` : ""}
        ${r.nota ? `<div style="padding:0 16px 10px;font-size:12.5px;color:var(--texto-2)">${esc(r.nota)}</div>` : ""}
        <div style="padding:0 16px 10px;font-size:13px;color:var(--texto-2)">
          <b style="color:var(--marinho)">${num(r.linhas.length)}</b> linha(s)
          ${ehGrupo ? ` · <b style="color:var(--marinho)">${num(totalQtd)}</b> equipamento(s) somados` : ""}
          · gerado em ${dataBR(new Date(), true)}
        </div>
        <div class="tab-wrap" style="border-radius:0;border-left:0;border-right:0;border-bottom:0;box-shadow:none">
          <table class="tab"><thead><tr>
            ${rel.colunas.map(c => `<th class="${c.numerico ? "num" : ""}">${esc(c.l)}</th>`).join("")}
          </tr></thead><tbody>
            ${r.linhas.map(l => `<tr>${rel.colunas.map(c => {
              const v = c.v ? c.v(l) : l[c.n];
              if (c.barra) return `<td style="min-width:150px">
                <div style="display:flex;align-items:center;gap:8px">
                  ${barraProgresso(Number(v) || 0)}
                  <span style="font-size:12px;color:var(--texto-2);min-width:38px;text-align:right">${Number(v) || 0}%</span>
                </div></td>`;
              if (c.badge) return `<td>${badge(c.badge, l[c.n] ?? l.status)}</td>`;
              if (c.numerico) return `<td class="num">${typeof v === "number" ? num(v) : esc(v ?? "—")}</td>`;
              if (c.mono) return `<td><span class="mono">${esc(v ?? "—")}</span></td>`;
              return `<td>${esc(v ?? "—")}</td>`;
            }).join("")}</tr>`).join("")}
          </tbody></table>
        </div>`;
    }
  }
}
