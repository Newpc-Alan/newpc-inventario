/* NEWPC INVENTÁRIO — Importação de planilhas (item 39)
 * Assistente em 4 passos: envio do arquivo → mapeamento de colunas → validação → gravação.
 * Nada é gravado antes da tela de validação. Linha com erro nunca entra silenciosamente.
 */
import { SCHEMA } from "../schema.js";
import {
  buscar, criar, lote, listaRef, rotuloDeId, proximoCodigo,
  limparCache, serverTimestamp, collection, doc, db
} from "../store.js";
import {
  ico, esc, toast, confirmar, cabecalhoPagina, carregando, vazio,
  kpi, barraProgresso, baixarCSV, dataBR, num
} from "../ui.js";
import { sessao, pode } from "../auth.js";
import * as C from "../config.js";

/* ============================================================
 * 1. Utilidades de texto
 * ============================================================ */

/** Normaliza um texto para comparação: minúsculo, sem acento, sem pontuação. */
function norm(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* Sinônimos de cabeçalho encontrados nas planilhas dos clientes e fornecedores. */
const SINONIMOS = {
  "patrimonio": "patrimonio_newpc", "patrimonio newpc": "patrimonio_newpc",
  "patrimonio interno": "patrimonio_newpc", "tombo": "patrimonio_newpc",
  "plaqueta": "patrimonio_newpc", "n patrimonio": "patrimonio_newpc",
  "numero de patrimonio": "patrimonio_newpc", "cod patrimonio": "patrimonio_newpc",

  "serial": "numero_serie", "nserie": "numero_serie", "n serie": "numero_serie",
  "numero de serie": "numero_serie", "num serie": "numero_serie", "serie": "numero_serie",
  "sn": "numero_serie", "s n": "numero_serie", "serial number": "numero_serie",

  "service tag": "service_tag", "servicetag": "service_tag", "st": "service_tag",
  "etiqueta de servico": "service_tag",

  "marca": "fabricante", "fabricante": "fabricante", "brand": "fabricante",
  "modelo": "modelo", "model": "modelo",

  "categoria": "categoria", "tipo": "categoria", "tipo de equipamento": "categoria",
  "equipamento": "categoria", "tipo equipamento": "categoria",

  "cliente": "cliente_id", "orgao": "cliente_id", "orgao cliente": "cliente_id",
  "prefeitura": "cliente_id", "contratante": "cliente_id",

  "unidade": "unidade_id", "escola": "unidade_id", "local de instalacao": "unidade_id",
  "unidade escolar": "unidade_id", "estabelecimento": "unidade_id",

  "setor": "setor_id", "departamento": "setor_id", "secretaria interna": "setor_id",

  "sala": "local_id", "ambiente": "local_id", "local": "local_id", "local sala": "local_id",

  "fornecedor": "fornecedor_id", "proprietario": "fornecedor_id", "locador": "fornecedor_id",
  "dono": "fornecedor_id",

  "contrato": "contrato_fornecedor_id", "operacao": "contrato_fornecedor_id",
  "lote": "contrato_fornecedor_id", "contrato fornecedor": "contrato_fornecedor_id",
  "contrato do cliente": "contrato_cliente_id", "contrato cliente": "contrato_cliente_id",

  "municipio": "municipio_id", "cidade": "municipio_id", "municipio cidade": "municipio_id",

  "status": "status", "situacao": "status", "situacao do equipamento": "status",
  "origem": "origem_ativo", "propriedade": "origem_ativo", "origem ativo": "origem_ativo",
  "condicao": "condicao", "estado": "condicao", "estado de conservacao": "condicao",

  "processador": "processador", "cpu": "processador",
  "memoria": "memoria_ram", "ram": "memoria_ram", "memoria ram": "memoria_ram",
  "hd": "armazenamento", "ssd": "armazenamento", "armazenamento": "armazenamento",
  "disco": "armazenamento", "hd ssd": "armazenamento",
  "so": "sistema_operacional", "sistema operacional": "sistema_operacional",
  "sistema": "sistema_operacional", "os": "sistema_operacional",
  "tela": "tamanho_tela", "tamanho da tela": "tamanho_tela", "polegadas": "tamanho_tela",

  "observacao": "observacoes", "observacoes": "observacoes", "obs": "observacoes",
  "descricao": "descricao",
  "patrimonio do fornecedor": "patrimonio_fornecedor",
  "patrimonio do cliente": "patrimonio_cliente",
  "data de implantacao": "data_implantacao", "data implantacao": "data_implantacao",
  "subcategoria": "subcategoria"
};

/* Campos de relacionamento: nunca gravamos texto livre neles (regra do briefing). */
const REF_DO_CAMPO = {
  categoria: "categorias", cliente_id: "clientes", unidade_id: "unidades",
  setor_id: "setores", local_id: "locais", fornecedor_id: "fornecedores",
  contrato_fornecedor_id: "contratos_fornecedor", contrato_cliente_id: "contratos_cliente",
  municipio_id: "municipios"
};

/* Coleções que o usuário pode autorizar a criação automática. */
const CRIAVEIS = ["categorias", "clientes", "unidades", "setores", "locais"];

/* Ordem de resolução: o pai precisa ser resolvido antes do filho. */
const ORDEM_CAMPOS = [
  "categoria", "municipio_id", "cliente_id", "unidade_id", "setor_id", "local_id",
  "fornecedor_id", "contrato_fornecedor_id", "contrato_cliente_id"
];

const OBRIGATORIOS = ["patrimonio_newpc", "categoria", "fabricante", "modelo"];
const MARCA_NOVO = "§NOVO§";

/* Nomes possíveis do rótulo de cada coleção referencial, para casar por nome. */
const NOMES_DE_BUSCA = {
  categorias: ["nome"],
  clientes: ["nome_fantasia", "razao_social"],
  unidades: ["nome"],
  setores: ["nome"],
  locais: ["nome"],
  municipios: ["nome"],
  fornecedores: ["nome_fantasia", "razao_social"],
  contratos_fornecedor: ["codigo_interno", "numero_contrato"],
  contratos_cliente: ["numero_contrato"]
};

/* Campo que liga o filho ao pai, para desambiguar nomes repetidos. */
const PAI_DA_COLECAO = {
  unidades: ["cliente_id", "cliente_id"],
  setores: ["unidade_id", "unidade_id"],
  locais: ["setor_id", "setor_id"],
  contratos_fornecedor: ["fornecedor_id", "fornecedor_id"],
  contratos_cliente: ["cliente_id", "cliente_id"]
};

/* ============================================================
 * 2. Leitura de arquivos
 * ============================================================ */

let promessaSheetJS = null;

/** Carrega a biblioteca de leitura de planilhas sob demanda. */
export function carregarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (promessaSheetJS) return promessaSheetJS;
  promessaSheetJS = new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.async = true;
    s.onload = () => window.XLSX
      ? ok(window.XLSX)
      : falha(new Error("O leitor de planilhas foi baixado, mas não pôde ser iniciado. Recarregue a página e tente de novo."));
    s.onerror = () => {
      promessaSheetJS = null;
      s.remove();
      falha(new Error("Não conseguimos baixar o leitor de planilhas. Verifique sua conexão com a internet e tente novamente — ou salve o arquivo como CSV, que é lido sem internet."));
    };
    document.head.appendChild(s);
  });
  return promessaSheetJS;
}

/** Descobre o separador do CSV olhando a primeira linha com conteúdo. */
function detectarSeparador(texto) {
  const linha = texto.split(/\r?\n/).find(l => l.trim() && !l.trim().startsWith("#")) || "";
  const pv = (linha.match(/;/g) || []).length;
  const vg = (linha.match(/,/g) || []).length;
  const tb = (linha.match(/\t/g) || []).length;
  if (tb > pv && tb > vg) return "\t";
  return vg > pv ? "," : ";";
}

/** Lê o arquivo como texto tentando UTF-8 e, se vier corrompido, windows-1252. */
function decodificar(buffer) {
  let txt = new TextDecoder("utf-8").decode(buffer);
  let encoding = "UTF-8";
  if (txt.includes("\uFFFD")) {
    try {
      txt = new TextDecoder("windows-1252").decode(buffer);
      encoding = "Windows-1252 (Excel brasileiro)";
    } catch { /* navegador sem suporte: mantém UTF-8 */ }
  }
  return { texto: txt.replace(/^\uFEFF/, ""), encoding };
}

/** Divide o CSV respeitando aspas. */
function separarCSV(texto, sep) {
  const linhas = [];
  let linha = [], campo = "", aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

/** Remove linhas totalmente vazias e as linhas de comentário (#) do modelo. */
function limparMatriz(matriz) {
  return matriz.filter(l => l.some(c => String(c ?? "").trim() !== "") &&
    !String(l[0] ?? "").trim().startsWith("#"));
}

/* ============================================================
 * 3. Conversão de valores
 * ============================================================ */

function paraNumero(v) {
  const t = String(v).trim().replace(/[R$\s]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return isNaN(n) ? null : n;
}

function paraData(v) {
  const t = String(v).trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    const ano = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(t);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function paraBooleano(v) {
  const t = norm(v);
  if (["sim", "s", "true", "1", "verdadeiro", "x", "ativo"].includes(t)) return true;
  if (["nao", "n", "false", "0", "falso", "inativo"].includes(t)) return false;
  return null;
}

/** Casa o texto com uma lista de domínio, aceitando o código ou o rótulo. */
function casarDominio(lista, valor) {
  const t = norm(valor);
  if (!t) return null;
  const achado = lista.find(o => norm(o.v ?? o) === t || norm(o.label ?? o) === t);
  return achado ? (achado.v ?? achado) : undefined; // undefined = valor inválido
}

/* ============================================================
 * 4. View principal
 * ============================================================ */

export async function importacao(alvo, ctx) {
  if (!pode("importacao.executar") && !pode("*")) {
    alvo.innerHTML = cabecalhoPagina("Importação de planilhas") +
      `<div class="aviso warn"><div><b>Você não tem permissão para importar planilhas.</b>
      Peça a um administrador ou analista para executar a importação.</div></div>`;
    return;
  }

  const est = {
    passo: 1,
    arquivo: null,
    origem: "",          // descrição do que foi lido (aba, encoding, separador)
    abas: [],            // nomes das abas quando for Excel
    abaEscolhida: "",
    cabecalhos: [],
    linhas: [],          // matriz de dados (sem cabeçalho)
    mapa: {},            // índice da coluna -> nome do campo do schema
    criarFaltantes: false,
    resultado: null,
    referencias: {}      // cache local das coleções referenciais
  };

  alvo.innerHTML = cabecalhoPagina(
    "Importação de planilhas",
    "Traga o inventário de uma planilha Excel ou CSV para dentro do sistema, com conferência antes de gravar.",
    `<button class="btn" id="imp-modelo">${ico("down", 15)}Baixar planilha modelo</button>`
  ) + `<div id="imp-passos"></div><div id="imp-corpo"></div><div id="imp-hist" style="margin-top:26px"></div>`;

  alvo.querySelector("#imp-modelo").onclick = () => baixarModeloPlanilha();

  const elPassos = alvo.querySelector("#imp-passos");
  const elCorpo = alvo.querySelector("#imp-corpo");

  function desenharPassos() {
    const nomes = ["Enviar arquivo", "Mapear colunas", "Conferir", "Importar"];
    elPassos.innerHTML = `<div class="card card-pad" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${nomes.map((n, i) => {
          const p = i + 1, feito = p < est.passo, atual = p === est.passo;
          const cor = feito ? "var(--verde)" : atual ? "var(--petroleo)" : "var(--cinza-3)";
          return `<div style="flex:1 1 150px;display:flex;align-items:center;gap:9px;min-width:140px">
            <span style="width:26px;height:26px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;
              background:${cor};color:#fff;font-weight:800;font-size:12.5px">${feito ? "&#10003;" : p}</span>
            <span style="font-size:13px;font-weight:${atual ? 700 : 600};color:${atual ? "var(--marinho)" : "var(--texto-2)"}">
              ${esc(n)}</span></div>`;
        }).join("")}
      </div></div>`;
  }

  function ir(p) { est.passo = p; desenharPassos(); render(); }

  function render() {
    desenharPassos();
    if (est.passo === 1) passo1();
    else if (est.passo === 2) passo2();
    else if (est.passo === 3) passo3();
    else passo4();
  }

  /* ---------------------------------------------------------
   * PASSO 1 — envio do arquivo
   * --------------------------------------------------------- */
  function passo1() {
    elCorpo.innerHTML = `
      <div class="card card-pad">
        <div id="imp-solta" style="border:2px dashed var(--cinza-3);border-radius:var(--r);padding:34px 18px;
          text-align:center;background:var(--cinza-2);transition:.15s">
          ${ico("upload", 40)}
          <div style="font-size:15.5px;font-weight:700;color:var(--marinho);margin-top:10px">
            Arraste a planilha para cá</div>
          <p style="font-size:13px;color:var(--texto-2);margin:5px 0 14px">
            Aceitamos Excel (.xlsx, .xls) e CSV. Nada é gravado agora — você confere tudo antes.</p>
          <button class="btn p" id="imp-escolher">${ico("file", 15)}Escolher arquivo</button>
          <input type="file" id="imp-file" accept=".xlsx,.xls,.csv,text/csv" class="oculto">
        </div>
        <div id="imp-leitura" style="margin-top:14px"></div>
      </div>`;

    const zona = elCorpo.querySelector("#imp-solta");
    const input = elCorpo.querySelector("#imp-file");
    elCorpo.querySelector("#imp-escolher").onclick = () => input.click();
    input.onchange = () => input.files[0] && lerArquivo(input.files[0]);

    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault(); zona.style.borderColor = "var(--petroleo)"; zona.style.background = "#EAF5FA";
    }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => {
      e.preventDefault(); zona.style.borderColor = "var(--cinza-3)"; zona.style.background = "var(--cinza-2)";
    }));
    zona.addEventListener("drop", e => {
      const f = e.dataTransfer?.files?.[0];
      if (f) lerArquivo(f);
    });

    if (est.cabecalhos.length) mostrarResumoLeitura();
  }

  function mostrarResumoLeitura() {
    const box = elCorpo.querySelector("#imp-leitura");
    if (!box) return;
    box.innerHTML = `
      <div class="aviso ok"><div><b>${esc(est.arquivo?.name || "Arquivo")} lido com sucesso</b>
        ${num(est.linhas.length)} linha(s) de dados e ${est.cabecalhos.length} coluna(s). ${esc(est.origem)}</div></div>
      ${est.abas.length > 1 ? `<div class="campo" style="margin-top:12px;max-width:340px">
        <label>A planilha tem mais de uma aba. Qual devemos importar?</label>
        <select class="inp" id="imp-aba">${est.abas.map(a =>
          `<option ${a === est.abaEscolhida ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>` : ""}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn p" id="imp-ir2">Continuar para o mapeamento${ico("arrows", 15)}</button>
        <button class="btn" id="imp-outro">Escolher outro arquivo</button>
      </div>`;
    box.querySelector("#imp-aba")?.addEventListener("change", async e => {
      est.abaEscolhida = e.target.value;
      await trocarAba();
      mostrarResumoLeitura();
    });
    box.querySelector("#imp-ir2").onclick = () => { sugerirMapa(); ir(2); };
    box.querySelector("#imp-outro").onclick = () => {
      est.cabecalhos = []; est.linhas = []; est.abas = []; est.arquivo = null; passo1();
    };
  }

  async function trocarAba() {
    const XLSX = await carregarSheetJS();
    const aba = est._pasta.Sheets[est.abaEscolhida];
    const matriz = limparMatriz(XLSX.utils.sheet_to_json(aba, { header: 1, raw: false, defval: "" }));
    aplicarMatriz(matriz, `Aba “${est.abaEscolhida}”.`);
  }

  function aplicarMatriz(matriz, descricao) {
    if (!matriz.length) throw new Error("A planilha está vazia. Confira se você enviou o arquivo certo.");
    est.cabecalhos = matriz[0].map((c, i) => String(c ?? "").trim() || `Coluna ${i + 1}`);
    est.linhas = matriz.slice(1).map(l => {
      const a = [];
      for (let i = 0; i < est.cabecalhos.length; i++) a[i] = String(l[i] ?? "").trim();
      return a;
    });
    est.origem = descricao;
    est.mapa = {};
    est.resultado = null;
  }

  async function lerArquivo(arquivo) {
    const box = elCorpo.querySelector("#imp-leitura");
    box.innerHTML = carregando("Lendo o arquivo…");
    est.arquivo = arquivo;
    est.abas = [];
    try {
      const buffer = await arquivo.arrayBuffer();
      if (/\.csv$/i.test(arquivo.name) || arquivo.type === "text/csv") {
        const { texto, encoding } = decodificar(buffer);
        const sep = detectarSeparador(texto);
        const matriz = limparMatriz(separarCSV(texto, sep));
        aplicarMatriz(matriz, `Texto lido em ${encoding}, separado por “${sep === "\t" ? "tabulação" : sep}”.`);
      } else {
        const XLSX = await carregarSheetJS();
        const pasta = XLSX.read(buffer, { type: "array", cellDates: false });
        est._pasta = pasta;
        est.abas = pasta.SheetNames || [];
        if (!est.abas.length) throw new Error("Não encontramos nenhuma aba nesta planilha.");
        est.abaEscolhida = est.abas[0];
        const matriz = limparMatriz(XLSX.utils.sheet_to_json(pasta.Sheets[est.abaEscolhida], { header: 1, raw: false, defval: "" }));
        aplicarMatriz(matriz, est.abas.length > 1
          ? `Arquivo Excel com ${est.abas.length} abas. Lendo a aba “${est.abaEscolhida}”.`
          : `Aba “${est.abaEscolhida}”.`);
      }
      mostrarResumoLeitura();
    } catch (e) {
      console.error(e);
      box.innerHTML = `<div class="aviso err"><div><b>Não foi possível ler o arquivo</b>${esc(e.message)}</div></div>`;
    }
  }

  /* ---------------------------------------------------------
   * PASSO 2 — mapeamento de colunas
   * --------------------------------------------------------- */
  const CAMPOS = SCHEMA.ativos.campos;

  function sugerirMapa() {
    const usados = new Set();
    est.cabecalhos.forEach((h, i) => {
      const t = norm(h);
      if (!t) return;
      let alvoCampo = CAMPOS.find(c => norm(c.n) === t)?.n
        || CAMPOS.find(c => norm(c.l) === t)?.n
        || SINONIMOS[t];
      if (!alvoCampo) {
        // tentativa mais frouxa: cabeçalho contém o rótulo do campo
        const c = CAMPOS.find(c => t.length > 3 && norm(c.l).includes(t));
        alvoCampo = c?.n;
      }
      if (alvoCampo && !usados.has(alvoCampo)) { est.mapa[i] = alvoCampo; usados.add(alvoCampo); }
    });
  }

  function passo2() {
    const grupos = SCHEMA.ativos.grupos;
    const opcoesCampos = grupos.map(g => `<optgroup label="${esc(g.titulo)}">${
      g.campos.map(n => {
        const c = CAMPOS.find(x => x.n === n);
        return c ? `<option value="${c.n}">${esc(c.l)}</option>` : "";
      }).join("")}</optgroup>`).join("");

    const detectados = Object.keys(est.mapa).length;

    elCorpo.innerHTML = `
      <div class="aviso info"><div><b>Confira para onde vai cada coluna da planilha</b>
        Já sugerimos o destino de ${detectados} de ${est.cabecalhos.length} coluna(s) pelo nome do cabeçalho.
        Ajuste o que estiver errado. Colunas marcadas como ignoradas simplesmente não são lidas.</div></div>

      <div class="card" style="margin-top:14px">
        <div class="card-tit"><h3>Mapeamento de colunas</h3>
          <div class="dir"><button class="btn sm" id="imp-limpar-mapa">Limpar tudo</button></div></div>
        <div class="tab-wrap"><table class="tab"><thead><tr>
          <th style="width:46%">Coluna da planilha</th><th>Campo do sistema</th></tr></thead><tbody>
          ${est.cabecalhos.map((h, i) => {
            const exemplos = est.linhas.slice(0, 3).map(l => l[i]).filter(v => v !== "");
            return `<tr>
              <td>
                <b style="color:var(--marinho)">${esc(h)}</b>
                <div style="font-size:11.8px;color:var(--texto-2);margin-top:3px">
                  ${exemplos.length
                    ? "Exemplos: " + exemplos.map(v => `<span class="mono">${esc(v.slice(0, 34))}</span>`).join(" · ")
                    : "Sem valores nas primeiras linhas"}</div>
              </td>
              <td>
                <select class="inp" data-col="${i}">
                  <option value="">— ignorar esta coluna —</option>
                  ${opcoesCampos}
                </select>
              </td></tr>`;
          }).join("")}
        </tbody></table></div>
      </div>

      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn" id="imp-volta1">Voltar</button>
        <button class="btn p" id="imp-ir3">Conferir os dados${ico("check", 15)}</button>
      </div>`;

    elCorpo.querySelectorAll("[data-col]").forEach(s => {
      s.value = est.mapa[s.dataset.col] || "";
      s.onchange = () => {
        const v = s.value;
        if (v) {
          // um campo do sistema só pode receber uma coluna
          Object.keys(est.mapa).forEach(k => { if (est.mapa[k] === v && k !== s.dataset.col) delete est.mapa[k]; });
          elCorpo.querySelectorAll("[data-col]").forEach(o => {
            if (o !== s && o.value === v) o.value = "";
          });
          est.mapa[s.dataset.col] = v;
        } else delete est.mapa[s.dataset.col];
        est.resultado = null;
      };
    });
    elCorpo.querySelector("#imp-limpar-mapa").onclick = () => { est.mapa = {}; est.resultado = null; passo2(); };
    elCorpo.querySelector("#imp-volta1").onclick = () => ir(1);
    elCorpo.querySelector("#imp-ir3").onclick = () => {
      const faltando = OBRIGATORIOS.filter(o => !Object.values(est.mapa).includes(o));
      if (faltando.includes("patrimonio_newpc")) {
        return toast("Escolha qual coluna contém o patrimônio NEWPC — sem ele não é possível importar.", "warn");
      }
      if (faltando.length) {
        toast(`Sem coluna para: ${faltando.map(f => CAMPOS.find(c => c.n === f).l).join(", ")}. As linhas ficarão com erro.`, "warn");
      }
      ir(3);
    };
  }

  /* ---------------------------------------------------------
   * PASSO 3 — validação
   * --------------------------------------------------------- */

  async function carregarReferencias() {
    for (const col of Object.values(REF_DO_CAMPO)) {
      if (!est.referencias[col]) est.referencias[col] = await listaRef(col);
    }
  }

  /** Procura um registro pelo nome dentro da coleção referencial. */
  function acharPorNome(colecao, texto, paiId) {
    const t = norm(texto);
    if (!t) return null;
    const campos = NOMES_DE_BUSCA[colecao] || ["nome"];
    const pai = PAI_DA_COLECAO[colecao]?.[0];
    return (est.referencias[colecao] || []).find(d => {
      if (pai && paiId && !String(paiId).startsWith(MARCA_NOVO) && d[pai] && d[pai] !== paiId) return false;
      return campos.some(c => norm(d[c]) === t);
    }) || null;
  }

  /** Roda a validação de todas as linhas. Não grava nada. */
  async function validar() {
    await carregarReferencias();

    const colunasPorCampo = {};
    Object.entries(est.mapa).forEach(([i, campo]) => { colunasPorCampo[campo] = Number(i); });

    /* --- 1ª passada: monta os dados de cada linha e resolve as referências --- */
    const brutos = [];
    const novasEntidades = new Map();  // chave -> {colecao, nome, dados, chavePai}

    est.linhas.forEach((linha, idx) => {
      const numLinha = idx + 2; // +1 do cabeçalho, +1 porque planilha começa em 1
      const dados = {};
      const problemas = [];
      const contexto = {};

      const processar = campo => {
        const i = colunasPorCampo[campo];
        if (i === undefined) return;
        const def = CAMPOS.find(c => c.n === campo);
        const bruto = linha[i] ?? "";
        const texto = String(bruto).trim();
        const cabecalho = est.cabecalhos[i];
        if (!texto) return;

        if (REF_DO_CAMPO[campo]) {
          const colecao = REF_DO_CAMPO[campo];
          const paiInfo = PAI_DA_COLECAO[colecao];
          const paiId = paiInfo ? contexto[paiInfo[1]] : null;
          const achado = acharPorNome(colecao, texto, paiId);
          if (achado) { dados[campo] = achado.id; contexto[campo] = achado.id; return; }

          if (CRIAVEIS.includes(colecao) && est.criarFaltantes) {
            const chave = `${colecao}|${norm(texto)}|${paiId || ""}`;
            if (!novasEntidades.has(chave)) {
              novasEntidades.set(chave, {
                colecao, nome: texto,
                chavePai: paiId && String(paiId).startsWith(MARCA_NOVO) ? String(paiId).slice(MARCA_NOVO.length) : null,
                paiCampo: paiInfo?.[0] || null,
                paiId: paiId && !String(paiId).startsWith(MARCA_NOVO) ? paiId : null,
                municipio_id: contexto.municipio_id && !String(contexto.municipio_id).startsWith(MARCA_NOVO)
                  ? contexto.municipio_id : null
              });
            }
            dados[campo] = MARCA_NOVO + chave;
            contexto[campo] = MARCA_NOVO + chave;
            return;
          }
          problemas.push({
            coluna: cabecalho, valor: texto,
            motivo: CRIAVEIS.includes(colecao)
              ? `${SCHEMA[colecao].label} “${texto}” não existe no cadastro. Marque a opção de criar automaticamente ou cadastre antes.`
              : `${SCHEMA[colecao].label} “${texto}” não existe no cadastro. Cadastre antes de importar — não gravamos texto solto em campo de vínculo.`
          });
          return;
        }

        if (def?.t === "select") {
          const v = casarDominio(def.opcoes, texto);
          if (v === undefined) {
            problemas.push({
              coluna: cabecalho, valor: texto,
              motivo: `Valor não reconhecido para ${def.l}. Use um destes: ${def.opcoes.map(o => o.label ?? o).join(", ")}.`
            });
          } else if (v !== null) dados[campo] = v;
          return;
        }
        if (def?.t === "bool") { const b = paraBooleano(texto); if (b !== null) dados[campo] = b; return; }
        if (["number", "int", "money"].includes(def?.t)) {
          const n = paraNumero(texto);
          if (n === null) problemas.push({ coluna: cabecalho, valor: texto, motivo: `${def.l} precisa ser um número.` });
          else dados[campo] = n;
          return;
        }
        if (def?.t === "date") {
          const d = paraData(texto);
          if (!d) problemas.push({ coluna: cabecalho, valor: texto, motivo: `${def.l} não parece uma data válida.` });
          else dados[campo] = d;
          return;
        }
        dados[campo] = /patrimonio|serie|tag/.test(campo) ? texto.toUpperCase() : texto;
      };

      ORDEM_CAMPOS.forEach(processar);
      Object.values(est.mapa).forEach(c => { if (!ORDEM_CAMPOS.includes(c)) processar(c); });

      /* valores padrão para campos não trazidos pela planilha */
      ["status", "origem_ativo", "condicao"].forEach(c => {
        if (dados[c] == null) {
          const def = CAMPOS.find(x => x.n === c);
          if (def?.def) dados[c] = def.def;
        }
      });

      /* obrigatórios */
      OBRIGATORIOS.forEach(c => {
        if (dados[c] == null || dados[c] === "") {
          const def = CAMPOS.find(x => x.n === c);
          problemas.push({
            coluna: colunasPorCampo[c] !== undefined ? est.cabecalhos[colunasPorCampo[c]] : def.l,
            valor: "", motivo: `${def.l} é obrigatório e está em branco.`
          });
        }
      });

      /* regras 9 e 10: equipamento de terceiro precisa de dono e de contrato */
      if (["LOCADO", "COMODATO"].includes(dados.origem_ativo)) {
        const rot = C.labelDe(C.ORIGEM_ATIVO, dados.origem_ativo);
        if (!dados.fornecedor_id) problemas.push({
          coluna: "Fornecedor", valor: "",
          motivo: `Origem ${rot} exige informar o fornecedor proprietário do equipamento.`
        });
        if (!dados.contrato_fornecedor_id) problemas.push({
          coluna: "Contrato do fornecedor", valor: "",
          motivo: `Origem ${rot} exige informar o contrato/operação de origem.`
        });
      }

      brutos.push({ numLinha, dados, problemas, linha });
    });

    /* --- 2ª passada: duplicidade dentro do próprio arquivo --- */
    const vistosPat = new Map(), vistosSer = new Map();
    brutos.forEach(r => {
      const p = r.dados.patrimonio_newpc, s = r.dados.numero_serie;
      if (p) { if (vistosPat.has(p)) r.dupInterna = { campo: "patrimônio", valor: p, primeira: vistosPat.get(p) }; else vistosPat.set(p, r.numLinha); }
      if (s && !r.dupInterna) { if (vistosSer.has(s)) r.dupInterna = { campo: "número de série", valor: s, primeira: vistosSer.get(s) }; else vistosSer.set(s, r.numLinha); }
    });

    /* --- 3ª passada: consulta ao banco (patrimônio e serial), sem carregar a coleção inteira --- */
    const patUnicos = [...new Set(brutos.map(r => r.dados.patrimonio_newpc).filter(Boolean))];
    const serUnicos = [...new Set(brutos.map(r => r.dados.numero_serie).filter(Boolean))];
    const achadosPat = new Map(), achadosSer = new Map();

    const caixaProg = elCorpo.querySelector("#imp-prog-val");
    let feitos = 0;
    const total = patUnicos.length + serUnicos.length;
    const marcar = () => {
      feitos++;
      if (caixaProg && (feitos % 10 === 0 || feitos === total)) {
        caixaProg.innerHTML = `${barraProgresso(Math.round(feitos / Math.max(1, total) * 100))}
          <div style="font-size:12.5px;color:var(--texto-2);margin-top:6px">
            Conferindo ${num(feitos)} de ${num(total)} identificador(es) no banco…</div>`;
      }
    };

    async function emLotes(lista, fn) {
      const CONC = 8;
      for (let i = 0; i < lista.length; i += CONC) {
        await Promise.all(lista.slice(i, i + CONC).map(fn));
      }
    }
    await emLotes(patUnicos, async p => {
      const { dados } = await buscar("ativos", [["patrimonio_newpc", "==", p]], null, 1);
      if (dados[0]) achadosPat.set(p, dados[0]);
      marcar();
    });
    await emLotes(serUnicos, async s => {
      const { dados } = await buscar("ativos", [["numero_serie", "==", s]], null, 1);
      if (dados[0]) achadosSer.set(s, dados[0]);
      marcar();
    });

    /* --- classificação final --- */
    const grupos = { novos: [], atualizacoes: [], duplicados: [], conflitos: [], erros: [] };

    brutos.forEach(r => {
      if (r.problemas.length) { grupos.erros.push(r); return; }
      if (r.dupInterna) {
        r.motivo = `Mesmo ${r.dupInterna.campo} “${r.dupInterna.valor}” já aparece na linha ${r.dupInterna.primeira} deste arquivo.`;
        grupos.duplicados.push(r); return;
      }
      const existente = achadosPat.get(r.dados.patrimonio_newpc);
      const donoSerial = r.dados.numero_serie ? achadosSer.get(r.dados.numero_serie) : null;

      if (donoSerial && (!existente || donoSerial.id !== existente.id)) {
        r.motivo = `O número de série ${r.dados.numero_serie} já está no patrimônio ${donoSerial.patrimonio_newpc}. Confira antes de importar.`;
        r.conflitoCom = donoSerial;
        grupos.conflitos.push(r); return;
      }
      if (existente) {
        const mudancas = [];
        Object.entries(r.dados).forEach(([k, v]) => {
          if (v == null || v === "") return;
          const atual = existente[k] ?? null;
          if (String(atual ?? "") !== String(v)) mudancas.push({ campo: k, de: atual, para: v });
        });
        if (!mudancas.length) {
          r.motivo = "Já cadastrado e sem nenhuma diferença — nada a fazer nesta linha.";
          grupos.duplicados.push(r); return;
        }
        r.existente = existente; r.mudancas = mudancas;
        grupos.atualizacoes.push(r); return;
      }
      grupos.novos.push(r);
    });

    est.resultado = { grupos, novasEntidades, total: brutos.length };
    return est.resultado;
  }

  async function passo3() {
    elCorpo.innerHTML = `<div class="card card-pad"><div id="imp-prog-val">${carregando("Conferindo as linhas contra o banco de dados…")}</div></div>`;
    let r;
    try { r = await validar(); }
    catch (e) {
      console.error(e);
      elCorpo.innerHTML = `<div class="aviso err"><div><b>Não foi possível conferir os dados</b>${esc(e.message)}</div></div>
        <button class="btn" style="margin-top:12px" id="imp-volta2">Voltar ao mapeamento</button>`;
      elCorpo.querySelector("#imp-volta2").onclick = () => ir(2);
      return;
    }
    const g = r.grupos;

    const bloco = (id, titulo, cor, lista, corpoLinha) => {
      if (!lista.length) return "";
      return `<details class="card" style="margin-top:11px" ${id === "erros" ? "open" : ""}>
        <summary style="padding:12px 15px;cursor:pointer;font-weight:700;color:var(--marinho);font-size:14px">
          ${esc(titulo)} <span class="st ${cor}" style="margin-left:6px">${num(lista.length)}</span></summary>
        <div class="tab-wrap" style="border:0;box-shadow:none;border-top:1px solid var(--borda);border-radius:0">
          <table class="tab"><thead><tr><th style="width:80px">Linha</th><th>Patrimônio</th><th>O que acontece</th></tr></thead>
          <tbody>${lista.slice(0, 300).map(corpoLinha).join("")}</tbody></table>
        </div>
        ${lista.length > 300 ? `<div style="padding:10px 15px;font-size:12.5px;color:var(--texto-2)">
          Mostrando as 300 primeiras de ${num(lista.length)}. Baixe o relatório para ver todas.</div>` : ""}
      </details>`;
    };

    const rotuloCampo = n => CAMPOS.find(c => c.n === n)?.l || n;
    const mostrarValor = (campo, v) => {
      if (v == null || v === "") return "vazio";
      if (REF_DO_CAMPO[campo] && !String(v).startsWith(MARCA_NOVO)) return rotuloDeId(REF_DO_CAMPO[campo], v);
      if (String(v).startsWith(MARCA_NOVO)) return "novo cadastro";
      const def = CAMPOS.find(c => c.n === campo);
      if (def?.t === "select") return C.labelDe(def.opcoes, v);
      return String(v);
    };

    elCorpo.innerHTML = `
      <div class="aviso warn"><div><b>Nada foi gravado ainda.</b>
        Linhas com erro <b>nunca</b> são importadas — nem parcialmente, nem em silêncio. Elas ficam de fora
        e você pode baixar a lista com o motivo de cada uma, corrigir a planilha e importar de novo.</div></div>

      <div class="grade g5" style="margin-top:14px">
        ${kpi("Válidos novos", g.novos.length, { cor: "verde", sub: "serão criados" })}
        ${kpi("Atualizações", g.atualizacoes.length, { cor: "azul", sub: "patrimônio já existe" })}
        ${kpi("Duplicados na planilha", g.duplicados.length, { cor: "amarelo", sub: "repetidos no arquivo" })}
        ${kpi("Conflito de série", g.conflitos.length, { cor: "laranja", sub: "série em outro patrimônio" })}
        ${kpi("Com erro", g.erros.length, { cor: "vermelho", sub: "não serão importados" })}
      </div>

      <div class="card card-pad" style="margin-top:14px">
        <label class="check"><input type="checkbox" id="imp-criar" ${est.criarFaltantes ? "checked" : ""}>
          <span>Criar automaticamente clientes, unidades, setores, locais e categorias que não existirem</span></label>
        <div style="font-size:12.3px;color:var(--texto-2);margin-top:2px">
          ${est.criarFaltantes
            ? `Serão criados ${num(r.novasEntidades.size)} novo(s) cadastro(s) de apoio. Eles nascem com o
               mínimo preenchido — revise depois em Cadastros.`
            : "Desligado: linhas que citam um cadastro inexistente entram como erro e ficam de fora."}
        </div>
      </div>

      ${bloco("erros", "Com erro — ficam de fora", "st-vermelho", g.erros, l => `<tr>
        <td class="mono">${l.numLinha}</td><td class="mono">${esc(l.dados.patrimonio_newpc || "—")}</td>
        <td>${l.problemas.map(p => `<div style="color:#A62029">${esc(p.motivo)}</div>`).join("")}</td></tr>`)}

      ${bloco("conflitos", "Conflito de número de série — precisam de conferência manual", "st-laranja", g.conflitos, l => `<tr>
        <td class="mono">${l.numLinha}</td><td class="mono">${esc(l.dados.patrimonio_newpc || "—")}</td>
        <td>${esc(l.motivo)}</td></tr>`)}

      ${bloco("duplicados", "Duplicados na planilha — só a primeira ocorrência será usada", "st-amarelo", g.duplicados, l => `<tr>
        <td class="mono">${l.numLinha}</td><td class="mono">${esc(l.dados.patrimonio_newpc || "—")}</td>
        <td>${esc(l.motivo)}</td></tr>`)}

      ${bloco("atualizacoes", "Atualizações — patrimônio já cadastrado", "st-azul", g.atualizacoes, l => `<tr>
        <td class="mono">${l.numLinha}</td><td class="mono">${esc(l.dados.patrimonio_newpc)}</td>
        <td>${l.mudancas.map(m => `<div style="font-size:12.5px">
          <b>${esc(rotuloCampo(m.campo))}:</b> ${esc(mostrarValor(m.campo, m.de))}
          &rarr; ${esc(mostrarValor(m.campo, m.para))}</div>`).join("")}</td></tr>`)}

      ${bloco("novos", "Válidos novos — serão criados", "st-verde", g.novos, l => `<tr>
        <td class="mono">${l.numLinha}</td><td class="mono">${esc(l.dados.patrimonio_newpc)}</td>
        <td>${esc([l.dados.fabricante, l.dados.modelo].filter(Boolean).join(" "))}
          ${l.dados.categoria ? ` · ${esc(mostrarValor("categoria", l.dados.categoria))}` : ""}</td></tr>`)}

      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
        <button class="btn" id="imp-volta2">Voltar ao mapeamento</button>
        <button class="btn" id="imp-rel-erros" ${g.erros.length || g.conflitos.length || g.duplicados.length ? "" : "disabled"}>
          ${ico("down", 15)}Baixar relatório de erros</button>
        <button class="btn p" id="imp-ir4" ${g.novos.length + g.atualizacoes.length ? "" : "disabled"}>
          ${ico("upload", 15)}Importar ${num(g.novos.length + g.atualizacoes.length)} linha(s)</button>
      </div>`;

    elCorpo.querySelector("#imp-criar").onchange = async e => {
      est.criarFaltantes = e.target.checked;
      await passo3();  // recalcula a validação com a nova regra
    };
    elCorpo.querySelector("#imp-volta2").onclick = () => ir(2);
    elCorpo.querySelector("#imp-rel-erros").onclick = () => baixarRelatorioErros(g);
    elCorpo.querySelector("#imp-ir4").onclick = () => ir(4);
  }

  function baixarRelatorioErros(g) {
    const linhas = [];
    g.erros.forEach(l => l.problemas.forEach(p =>
      linhas.push([l.numLinha, "Com erro", p.coluna, p.valor, p.motivo])));
    g.conflitos.forEach(l => linhas.push([l.numLinha, "Conflito de série", "Número de série", l.dados.numero_serie || "", l.motivo]));
    g.duplicados.forEach(l => linhas.push([l.numLinha, "Duplicado na planilha", "Patrimônio", l.dados.patrimonio_newpc || "", l.motivo]));
    if (!linhas.length) return toast("Não há nada a relatar — todas as linhas estão válidas.", "info");
    baixarCSV("importacao_erros", ["Linha da planilha", "Situação", "Coluna", "Valor", "Motivo"], linhas);
    toast(`${linhas.length} ocorrência(s) no relatório.`, "ok");
  }

  /* ---------------------------------------------------------
   * PASSO 4 — gravação
   * --------------------------------------------------------- */
  async function passo4() {
    const { grupos: g, novasEntidades } = est.resultado;
    const totalGravar = g.novos.length + g.atualizacoes.length;

    elCorpo.innerHTML = `
      <div class="card card-pad">
        <h3 style="font-size:15px;color:var(--marinho);margin-bottom:4px">Pronto para importar</h3>
        <p style="font-size:13px;color:var(--texto-2)">
          Serão criados <b>${num(g.novos.length)}</b> ativo(s) e atualizados <b>${num(g.atualizacoes.length)}</b>.
          ${novasEntidades.size ? `Antes disso, criaremos <b>${num(novasEntidades.size)}</b> cadastro(s) de apoio.` : ""}
          ${g.erros.length + g.conflitos.length + g.duplicados.length
            ? `<b>${num(g.erros.length + g.conflitos.length + g.duplicados.length)}</b> linha(s) ficam de fora.` : ""}
        </p>
        <div id="imp-prog" style="margin-top:16px"></div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn" id="imp-volta3">Voltar à conferência</button>
          <button class="btn v lg" id="imp-gravar">${ico("check", 16)}Importar agora</button>
        </div>
      </div>`;

    elCorpo.querySelector("#imp-volta3").onclick = () => ir(3);
    elCorpo.querySelector("#imp-gravar").onclick = async () => {
      if (!await confirmar("Importar agora?",
        `Vamos gravar <b>${num(totalGravar)}</b> registro(s) no sistema. Esta ação fica registrada em auditoria
         e o histórico de cada ativo é preservado.`, "Importar")) return;
      await gravar();
    };

    async function gravar() {
      const prog = elCorpo.querySelector("#imp-prog");
      elCorpo.querySelector("#imp-gravar").disabled = true;
      elCorpo.querySelector("#imp-volta3").disabled = true;

      let criados = 0, atualizados = 0, entidadesCriadas = 0, erroFatal = null;
      const mapaNovos = new Map(); // chave -> id real

      const pintar = (p, txt) => {
        prog.innerHTML = barraProgresso(p, true) +
          `<div style="font-size:13px;color:var(--texto-2);margin-top:7px">${esc(txt)}</div>`;
      };

      try {
        /* 1) cadastros de apoio, na ordem de dependência */
        if (novasEntidades.size) {
          const ordem = CRIAVEIS;
          const pendentes = [...novasEntidades.entries()]
            .sort((a, b) => ordem.indexOf(a[1].colecao) - ordem.indexOf(b[1].colecao));
          let i = 0;
          for (const [chave, ent] of pendentes) {
            const aviso = "Cadastro criado automaticamente durante uma importação de planilha. Complete as informações.";
            const dados = { nome: ent.nome };
            if (["setores", "locais"].includes(ent.colecao)) dados.descricao = aviso;
            else { dados.ativo = true; dados.observacoes = aviso; }
            if (ent.paiCampo) {
              const paiId = ent.paiId || (ent.chavePai ? mapaNovos.get(ent.chavePai) : null);
              if (paiId) dados[ent.paiCampo] = paiId;
            }
            if (ent.colecao === "clientes") {
              dados.razao_social = ent.nome; dados.nome_fantasia = ent.nome; dados.tipo = "Outro";
              if (ent.municipio_id) dados.municipio_id = ent.municipio_id;
            }
            if (ent.colecao === "unidades" && ent.municipio_id) dados.municipio_id = ent.municipio_id;
            const id = await criar(ent.colecao, dados, { ignorarDuplicidade: true });
            mapaNovos.set(chave, id);
            entidadesCriadas++;
            i++;
            pintar(Math.round(i / pendentes.length * 15), `Criando cadastros de apoio (${i} de ${pendentes.length})…`);
          }
          limparCache();
        }

        /* substitui os marcadores pelos ids reais */
        const resolver = dados => {
          const saida = {};
          for (const [k, v] of Object.entries(dados)) {
            if (typeof v === "string" && v.startsWith(MARCA_NOVO)) {
              const id = mapaNovos.get(v.slice(MARCA_NOVO.length));
              if (id) saida[k] = id;
            } else saida[k] = v;
          }
          return saida;
        };

        /* 2) monta as operações */
        const u = sessao.usuario;
        const ops = [];
        g.novos.forEach(l => {
          const id = doc(collection(db, "ativos")).id;
          ops.push({ colecao: "ativos", id, tipo: "set", dados: {
            ...resolver(l.dados),
            criado_em: serverTimestamp(), atualizado_em: serverTimestamp(),
            criado_por: u?.id || null, criado_por_nome: u?.nome || null,
            atualizado_por: u?.id || null, origem_cadastro: "IMPORTACAO"
          }});
          ops.push({ colecao: "historico", tipo: "set", dados: {
            ativo_id: id, tipo: "CADASTRO", titulo: "Ativo cadastrado por importação de planilha",
            detalhe: `Arquivo ${est.arquivo?.name || ""} · linha ${l.numLinha}`.trim(),
            usuario_id: u?.id || null, usuario_nome: u?.nome || "sistema", data: serverTimestamp()
          }});
          l._novoId = id;
        });
        g.atualizacoes.forEach(l => {
          const dados = resolver(Object.fromEntries(l.mudancas.map(m => [m.campo, m.para])));
          ops.push({ colecao: "ativos", id: l.existente.id, tipo: "update", dados: {
            ...dados, atualizado_em: serverTimestamp(), atualizado_por: u?.id || null
          }});
          ops.push({ colecao: "historico", tipo: "set", dados: {
            ativo_id: l.existente.id, tipo: "IMPORTACAO", titulo: "Ativo atualizado por importação de planilha",
            detalhe: l.mudancas.map(m => `${CAMPOS.find(c => c.n === m.campo)?.l || m.campo}: ${m.de ?? "vazio"} → ${m.para}`).join(" · "),
            usuario_id: u?.id || null, usuario_nome: u?.nome || "sistema", data: serverTimestamp()
          }});
        });

        /* 3) grava em blocos, com progresso real e tolerância a falha parcial */
        const BLOCO = 200;
        let gravadas = 0;
        for (let i = 0; i < ops.length; i += BLOCO) {
          const parte = ops.slice(i, i + BLOCO);
          try {
            await lote(parte);
          } catch (e) {
            erroFatal = e;
            break;
          }
          gravadas += parte.length;
          parte.forEach(op => {
            if (op.colecao !== "ativos") return;
            if (op.tipo === "update") atualizados++; else criados++;
          });
          pintar(15 + Math.round(gravadas / ops.length * 80),
            `Gravando… ${num(criados)} criado(s) e ${num(atualizados)} atualizado(s).`);
        }

        /* 4) registro da importação */
        pintar(97, "Registrando a importação…");
        const codigo = await proximoCodigo("importacoes");
        const mapeamento = {};
        Object.entries(est.mapa).forEach(([i, campo]) => { mapeamento[est.cabecalhos[i]] = campo; });
        const registro = {
          codigo,
          arquivo_nome: est.arquivo?.name || "planilha",
          total_linhas: est.resultado.total,
          criados, atualizados,
          ignorados: g.duplicados.length + g.conflitos.length,
          erros: g.erros.length,
          entidades_criadas: entidadesCriadas,
          mapeamento,
          concluida: !erroFatal,
          usuario_id: u?.id || null,
          usuario_nome: u?.nome || "sistema",
          criado_em: serverTimestamp()
        };
        await lote([{ colecao: "importacoes", tipo: "set", dados: registro }]);
        limparCache();
        pintar(100, "Concluído.");
        resumoFinal(codigo, { criados, atualizados, entidadesCriadas, erroFatal, g });
      } catch (e) {
        console.error(e);
        prog.innerHTML = `<div class="aviso err"><div><b>A importação parou por um erro</b>
          ${esc(e.message)}<br>Foram gravados ${num(criados)} novo(s) e ${num(atualizados)} atualizado(s) antes da parada.
          Corrija o problema e importe novamente — os registros já gravados serão reconhecidos como atualização.</div></div>`;
        elCorpo.querySelector("#imp-volta3").disabled = false;
      }
    }
  }

  function resumoFinal(codigo, { criados, atualizados, entidadesCriadas, erroFatal, g }) {
    elCorpo.innerHTML = `
      <div class="card card-pad">
        <div class="aviso ${erroFatal ? "warn" : "ok"}"><div>
          <b>${erroFatal ? "Importação concluída parcialmente" : "Importação concluída"}</b>
          Registro <span class="mono">${esc(codigo)}</span> gravado no histórico de importações.
          ${erroFatal ? `A gravação parou no meio: ${esc(erroFatal.message)}` : ""}</div></div>

        <div class="grade g4" style="margin-top:14px">
          ${kpi("Ativos criados", criados, { cor: "verde" })}
          ${kpi("Ativos atualizados", atualizados, { cor: "azul" })}
          ${kpi("Cadastros de apoio criados", entidadesCriadas, { cor: "ciano" })}
          ${kpi("Linhas fora da importação", g.erros.length + g.duplicados.length + g.conflitos.length, { cor: "vermelho" })}
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
          <button class="btn p" id="imp-ver">${ico("cpu", 15)}Ver ativos importados</button>
          ${g.erros.length ? `<button class="btn" id="imp-rel2">${ico("down", 15)}Baixar relatório de erros</button>` : ""}
          <button class="btn" id="imp-nova">Importar outra planilha</button>
        </div>
      </div>`;
    elCorpo.querySelector("#imp-ver").onclick = () => { location.hash = "#/ativos"; };
    elCorpo.querySelector("#imp-rel2")?.addEventListener("click", () => baixarRelatorioErros(g));
    elCorpo.querySelector("#imp-nova").onclick = () => {
      est.arquivo = null; est.cabecalhos = []; est.linhas = []; est.mapa = {};
      est.resultado = null; est.abas = []; est.criarFaltantes = false;
      ir(1); historico();
    };
    historico();
  }

  /* ---------------------------------------------------------
   * Histórico de importações anteriores
   * --------------------------------------------------------- */
  async function historico() {
    const box = alvo.querySelector("#imp-hist");
    box.innerHTML = `<div class="card"><div class="card-tit"><h3>Importações anteriores</h3></div>
      <div style="padding:14px">${carregando("Buscando…")}</div></div>`;
    let dados = [];
    try { ({ dados } = await buscar("importacoes", [], ["criado_em", "desc"], 20)); }
    catch (e) { console.error(e); }

    box.innerHTML = `<div class="card">
      <div class="card-tit"><h3>Importações anteriores</h3></div>
      ${dados.length ? `<div class="tab-wrap" style="border:0;box-shadow:none;border-radius:0">
        <table class="tab"><thead><tr>
          <th>Código</th><th>Arquivo</th><th>Quando</th><th>Quem</th>
          <th class="num">Linhas</th><th class="num">Criados</th><th class="num">Atualizados</th>
          <th class="num">Fora</th></tr></thead><tbody>
          ${dados.map(d => `<tr>
            <td class="mono">${esc(d.codigo || "—")}</td>
            <td>${esc(d.arquivo_nome || "—")}${d.concluida === false
              ? ` <span class="st st-laranja">parcial</span>` : ""}</td>
            <td>${dataBR(d.criado_em, true)}</td>
            <td>${esc(d.usuario_nome || "—")}</td>
            <td class="num">${num(d.total_linhas || 0)}</td>
            <td class="num">${num(d.criados || 0)}</td>
            <td class="num">${num(d.atualizados || 0)}</td>
            <td class="num">${num((d.erros || 0) + (d.ignorados || 0))}</td>
          </tr>`).join("")}
        </tbody></table></div>`
        : `<div style="padding:8px 0">${vazio("Nenhuma importação registrada",
            "Quando você importar a primeira planilha, o registro aparece aqui.")}</div>`}
    </div>`;
  }

  render();
  historico();
}

/* ============================================================
 * Planilha modelo
 * ============================================================ */

const MODELO_COLUNAS = [
  "Patrimônio NEWPC", "Categoria", "Fabricante", "Modelo", "Número de Série", "Service Tag",
  "Patrimônio do Fornecedor", "Origem", "Fornecedor", "Contrato", "Cliente", "Município",
  "Unidade", "Setor", "Sala", "Status", "Condição", "Processador", "Memória RAM",
  "Armazenamento", "Sistema Operacional", "Data de Implantação", "Observações"
];

/** Gera e baixa um CSV modelo com os cabeçalhos recomendados e duas linhas de exemplo. */
export async function baixarModeloPlanilha() {
  const comentario = [
    "# As duas linhas de exemplo abaixo são apenas para orientação — apague-as antes de importar.",
    ...Array(MODELO_COLUNAS.length - 1).fill("")
  ];
  const exemplo1 = [
    "NEWPC-000001", "Notebook", "Dell", "Latitude 3420", "SN123456789", "ABC1234",
    "", "PROPRIO", "", "", "Prefeitura Municipal", "Campo Grande",
    "Escola Municipal Exemplo", "Secretaria", "Sala 1", "EM_USO", "BOM",
    "Intel Core i5", "8 GB", "SSD 256 GB", "Windows 11 Pro", "01/03/2026",
    "Linha de exemplo — apague"
  ];
  const exemplo2 = [
    "NEWPC-000002", "Monitor", "LG", "24MK430H", "SN987654321", "",
    "FRN-0099", "LOCADO", "Nome do Fornecedor", "Aventis 01", "Prefeitura Municipal", "Campo Grande",
    "Escola Municipal Exemplo", "Secretaria", "Sala 1", "EM_USO", "BOM",
    "", "", "", "", "01/03/2026",
    "Origem LOCADO exige Fornecedor e Contrato preenchidos"
  ];
  baixarCSV("modelo_importacao_ativos", MODELO_COLUNAS, [comentario, exemplo1, exemplo2]);
  toast("Planilha modelo baixada. Preencha e volte para importar.", "ok");
}
