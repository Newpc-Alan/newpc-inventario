/* Biblioteca de UI: ícones, formatação, toast, modal, formulários dirigidos por schema,
 * tabelas paginadas e cards responsivos. Sem framework — DOM direto.
 */
import { SCHEMA, campoVisivel } from "./schema.js";
import * as C from "./config.js";
import { listaRef, rotulo, rotuloDeId } from "./store.js";
import { sessao } from "./auth.js";

/* ---------------- ícones (Lucide, subconjunto inline) ---------------- */
const P = {
  dashboard:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  scan:'<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
  cpu:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  building:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
  school:'<path d="m4 6 8-4 8 4v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M12 8v6M9 11h6"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  truck:'<path d="M14 18V6a1 1 0 0 0-1-1H2v13h12z"/><path d="M14 9h4l3 3v6h-7"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
  arrows:'<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  box:'<path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="m3 8v8l9 5 9-5V8"/>',
  alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  wrench:'<path d="M14.7 6.3a4 4 0 1 0 5 5L21 21l-3-3-9.3-9.3 6-2.4z"/>',
  chart:'<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  upload:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  layers:'<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  door:'<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h20"/><path d="M13 2v18H4V4l9-2z"/><circle cx="10" cy="12" r="1"/>',
  tag:'<path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z"/><circle cx="7" cy="7" r="1.5"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  camera:'<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  hist:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit:'<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  file2:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h2"/>',
  print:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>'
};
export function ico(nome, tam = 17, extra = "") {
  return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${P[nome] || P.box}</svg>`;
}

/* ---------------- formatação ---------------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, m =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

export function dataBR(v, comHora = false) {
  if (!v) return "—";
  const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v + (String(v).length === 10 ? "T12:00:00" : "")));
  if (isNaN(d)) return "—";
  const s = d.toLocaleDateString("pt-BR");
  return comHora ? `${s} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : s;
}
export function dataISO(v) {
  if (!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}
export function diasDesde(v) {
  if (!v) return null;
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
}
export const moeda = n => (n == null || n === "") ? "—"
  : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const num = n => Number(n || 0).toLocaleString("pt-BR");
export function cnpjFmt(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : (v || "—");
}
export const iniciais = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase();
export const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;

/* ---------------- badges ---------------- */
export function badge(lista, valor) {
  return `<span class="st ${C.corDe(lista, valor)}">${esc(C.labelDe(lista, valor))}</span>`;
}
export const badgeStatusAtivo = v => badge(C.STATUS_ATIVO, v);
export const badgeAtivoInativo = v => v === false
  ? `<span class="st st-cinza">Inativo</span>` : `<span class="st st-verde">Ativo</span>`;

/* ---------------- toast ---------------- */
let elToasts;
export function toast(msg, tipo = "ok", titulo = "") {
  if (!elToasts) { elToasts = document.createElement("div"); elToasts.className = "toasts"; document.body.appendChild(elToasts); }
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  const i = { ok: "check", err: "x", warn: "alert", info: "bell" }[tipo] || "check";
  t.innerHTML = `${ico(i, 18)}<div>${titulo ? `<b>${esc(titulo)}</b>` : ""}${esc(msg)}</div>`;
  elToasts.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = ".3s"; setTimeout(() => t.remove(), 300); },
    tipo === "err" ? 6500 : 3400);
}

/* ---------------- modal ---------------- */
export function modal({ titulo, corpo, acoes = [], tamanho = "", aoFechar, semFechar }) {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo";
  fundo.innerHTML = `<div class="modal ${tamanho}">
    <div class="modal-topo"><h3>${esc(titulo)}</h3>${semFechar ? "" : `<button class="x" data-x>${ico("x", 19)}</button>`}</div>
    <div class="modal-corpo"></div>
    ${acoes.length ? `<div class="modal-pe"></div>` : ""}
  </div>`;
  const corpoEl = fundo.querySelector(".modal-corpo");
  if (typeof corpo === "string") corpoEl.innerHTML = corpo; else corpoEl.appendChild(corpo);

  const fechar = () => { fundo.remove(); aoFechar && aoFechar(); };
  fundo.querySelector("[data-x]")?.addEventListener("click", fechar);
  fundo.addEventListener("mousedown", e => { if (e.target === fundo && !semFechar) fechar(); });

  const pe = fundo.querySelector(".modal-pe");
  acoes.forEach(a => {
    const b = document.createElement("button");
    b.className = `btn ${a.classe || ""}`;
    b.innerHTML = (a.icone ? ico(a.icone, 16) : "") + esc(a.texto);
    b.onclick = async () => {
      if (a.aoClicar) {
        b.disabled = true;
        const txtOrig = b.innerHTML;
        b.innerHTML = `<span class="spin"></span>`;
        try { const r = await a.aoClicar(fechar); if (r !== false) fechar(); }
        catch (e) { console.error(e); toast(e.message || "Erro na operação.", "err"); }
        finally { b.disabled = false; b.innerHTML = txtOrig; }
      } else fechar();
    };
    pe.appendChild(b);
  });
  document.body.appendChild(fundo);
  setTimeout(() => corpoEl.querySelector("input,select,textarea")?.focus(), 60);
  return { fechar, el: fundo, corpo: corpoEl };
}

export function confirmar(titulo, texto, textoBotao = "Confirmar", perigo = false) {
  return new Promise(res => {
    modal({
      titulo, tamanho: "p",
      corpo: `<p style="font-size:14px;line-height:1.55">${texto}</p>`,
      acoes: [
        { texto: "Cancelar", aoClicar: () => { res(false); } },
        { texto: textoBotao, classe: perigo ? "d" : "p", aoClicar: () => { res(true); } }
      ],
      aoFechar: () => res(false)
    });
  });
}

/* ---------------- formulário dirigido por schema ---------------- */
export async function montarFormulario(entidade, dados = {}, opcoes = {}) {
  const def = SCHEMA[entidade];
  const perfil = sessao.usuario?.perfil;
  const form = document.createElement("form");
  form.className = "form-grade";
  form.noValidate = true;

  const campos = (opcoes.campos
    ? def.campos.filter(c => opcoes.campos.includes(c.n))
    : def.campos).filter(c => campoVisivel(c, perfil));

  const refs = {};
  for (const c of campos.filter(x => x.t === "ref")) refs[c.ref] = await listaRef(c.ref);

  for (const c of campos) {
    const w = document.createElement("div");
    w.className = "campo" + (c.grid === 2 || c.t === "textarea" ? " w2" : "");
    const val = dados[c.n] ?? c.def ?? "";
    const req = c.req ? ' <span class="req">*</span>' : "";
    let controle;

    if (c.t === "bool") {
      w.innerHTML = `<label class="check"><input type="checkbox" name="${c.n}" ${val ? "checked" : ""}>
        <span>${esc(c.l)}</span></label>`;
    } else if (c.t === "select" || c.t === "ref") {
      const lista = c.t === "select" ? c.opcoes
        : refs[c.ref].filter(x => x.ativo !== false).map(x => ({ v: x.id, label: rotulo(c.ref, x), _raw: x }));
      const ops = lista.map(o => `<option value="${esc(o.v ?? o)}" ${String(o.v ?? o) === String(val) ? "selected" : ""}
        ${o._raw && c.filtroPor ? `data-pai="${esc(o._raw[c.filtroPor] || "")}"` : ""}>${esc(o.label ?? o)}</option>`).join("");
      w.innerHTML = `<label>${esc(c.l)}${req}</label>
        <select class="inp" name="${c.n}" ${c.filtroPor ? `data-filtro-por="${c.filtroPor}"` : ""}>
        <option value="">— selecione —</option>${ops}</select>`;
    } else if (c.t === "textarea") {
      w.innerHTML = `<label>${esc(c.l)}${req}</label><textarea class="inp" name="${c.n}">${esc(val)}</textarea>`;
    } else if (c.t === "uf") {
      const ufs = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
      w.innerHTML = `<label>${esc(c.l)}${req}</label><select class="inp" name="${c.n}"><option value="">—</option>
        ${ufs.map(u => `<option ${u === val ? "selected" : ""}>${u}</option>`).join("")}</select>`;
    } else {
      const tipo = { number: "number", money: "number", int: "number", date: "date", email: "email", tel: "tel" }[c.t] || "text";
      const passo = c.t === "money" ? ' step="0.01"' : c.t === "int" ? ' step="1"' : c.t === "number" ? ' step="any"' : "";
      const v = c.t === "date" ? dataISO(val) : val;
      w.innerHTML = `<label>${esc(c.l)}${req}</label>
        <input class="inp" type="${tipo}"${passo} name="${c.n}" value="${esc(v)}" ${c.t === "cnpj" ? 'maxlength="18"' : ""}>`;
    }
    if (c.hint) w.insertAdjacentHTML("beforeend", `<span class="hint">${esc(c.hint)}</span>`);
    w.insertAdjacentHTML("beforeend", `<span class="erro oculto" data-erro="${c.n}"></span>`);
    form.appendChild(w);
    controle = w.querySelector("[name]");
    if (c.t === "cnpj") controle.addEventListener("input", e => {
      let d = e.target.value.replace(/\D/g, "").slice(0, 14);
      e.target.value = d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
        .replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
    });
  }

  /* cascatas: unidade filtra por cliente, setor por unidade, local por setor, contrato por fornecedor */
  form.querySelectorAll("[data-filtro-por]").forEach(sel => {
    const pai = form.querySelector(`[name="${sel.dataset.filtroPor}"]`);
    if (!pai) return;
    const aplicar = () => {
      const v = pai.value;
      let manter = false;
      sel.querySelectorAll("option[data-pai]").forEach(o => {
        const ok = !v || o.dataset.pai === v;
        o.hidden = !ok; o.disabled = !ok;
        if (ok && o.selected) manter = true;
      });
      if (!manter && sel.value) sel.value = "";
      sel.disabled = !v;
      sel.title = v ? "" : `Selecione ${sel.dataset.filtroPor.replace("_id", "")} primeiro`;
    };
    pai.addEventListener("change", () => { aplicar(); sel.dispatchEvent(new Event("change")); });
    aplicar();
  });

  /* origem_ativo controla obrigatoriedade de fornecedor/contrato */
  const origem = form.querySelector('[name="origem_ativo"]');
  if (origem) {
    const forn = form.querySelector('[name="fornecedor_id"]');
    const ctr = form.querySelector('[name="contrato_fornecedor_id"]');
    const aplicar = () => {
      const exige = ["LOCADO", "COMODATO"].includes(origem.value);
      [forn, ctr].forEach(el => {
        if (!el) return;
        const lab = el.closest(".campo").querySelector("label");
        lab.innerHTML = lab.innerHTML.replace(/ <span class="req">\*<\/span>/, "") + (exige ? ' <span class="req">*</span>' : "");
      });
    };
    origem.addEventListener("change", aplicar); aplicar();
  }
  return form;
}

/** Lê o formulário aplicando conversões de tipo e validação. */
export function lerFormulario(form, entidade) {
  const def = SCHEMA[entidade];
  const out = {}, erros = {};
  form.querySelectorAll("[data-erro]").forEach(e => e.classList.add("oculto"));
  form.querySelectorAll(".inp").forEach(i => i.classList.remove("ruim"));

  for (const c of def.campos) {
    const el = form.querySelector(`[name="${c.n}"]`);
    if (!el) continue;
    let v = c.t === "bool" ? el.checked : el.value.trim();
    if (c.t === "cnpj") v = v.replace(/\D/g, "");
    if (["number", "money", "int"].includes(c.t)) v = v === "" ? null : Number(v);
    out[c.n] = v === "" ? null : v;
  }
  for (const c of def.campos) {
    if (!(c.n in out)) continue;
    const exige = c.req || (c.reqSe && c.reqSe(out));
    if (exige && (out[c.n] === null || out[c.n] === "" || out[c.n] === undefined)) erros[c.n] = "Campo obrigatório.";
    if (c.t === "cnpj" && out[c.n] && String(out[c.n]).length !== 14) erros[c.n] = "CNPJ deve ter 14 dígitos.";
    if (c.t === "email" && out[c.n] && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out[c.n])) erros[c.n] = "E-mail inválido.";
  }
  if (Object.keys(erros).length) {
    for (const [k, m] of Object.entries(erros)) {
      const e = form.querySelector(`[data-erro="${k}"]`);
      if (e) { e.textContent = m; e.classList.remove("oculto"); }
      form.querySelector(`[name="${k}"]`)?.classList.add("ruim");
    }
    form.querySelector(".ruim")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return { ok: false, erros };
  }
  return { ok: true, dados: out };
}

/* ---------------- células de listagem ---------------- */
const REF_DE_CAMPO = {
  fornecedor_id: "fornecedores", cliente_id: "clientes", municipio_id: "municipios",
  unidade_id: "unidades", setor_id: "setores", local_id: "locais",
  contrato_fornecedor_id: "contratos_fornecedor", contrato_cliente_id: "contratos_cliente",
  categoria: "categorias", tecnico_id: "usuarios", responsavel_id: "usuarios"
};

export function celula(entidade, campo, dado) {
  const v = dado[campo];
  if (campo === "ativo") return badgeAtivoInativo(v);
  if (campo === "status") {
    const mapa = { ativos: C.STATUS_ATIVO, contratos_fornecedor: C.STATUS_CONTRATO_FORNECEDOR,
      contratos_cliente: C.STATUS_CONTRATO_CLIENTE, inventarios: C.STATUS_INVENTARIO,
      movimentacoes: C.STATUS_MOVIMENTACAO, pendencias: C.STATUS_PENDENCIA };
    return badge(mapa[entidade] || C.STATUS_ATIVO, v);
  }
  if (campo === "perfil") return `<span class="st st-azul">${esc(C.PERFIL_LABEL[v] || v)}</span>`;
  if (REF_DE_CAMPO[campo]) return esc(rotuloDeId(REF_DE_CAMPO[campo], v));
  if (campo === "cnpj") return esc(cnpjFmt(v));
  const def = SCHEMA[entidade]?.campos.find(c => c.n === campo);
  if (def?.t === "money") return moeda(v);
  if (def?.t === "date" || /(_em|data_|ultimo_)/.test(campo)) return dataBR(v, /_em$|acesso/.test(campo));
  if (campo === "patrimonio_newpc" || campo === "numero_serie" || campo === "codigo")
    return `<span class="mono">${esc(v || "—")}</span>`;
  return esc(v ?? "—");
}

export function rotuloColuna(entidade, campo) {
  const c = SCHEMA[entidade]?.campos.find(x => x.n === campo);
  if (c) return c.l;
  return ({ municipio_nome: "Município", ultimo_acesso: "Último acesso", codigo: "Código",
    criado_em: "Criado em", data_hora: "Data/hora" })[campo] || campo.replace(/_/g, " ");
}

/* ---------------- estados ---------------- */
export const carregando = (txt = "Carregando…") =>
  `<div class="carregando"><span class="spin"></span>${esc(txt)}</div>`;

export function vazio(titulo, texto = "", botao = null) {
  return `<div class="vazio">${ico("box", 44)}<b>${esc(titulo)}</b>
    ${texto ? `<p>${esc(texto)}</p>` : ""}
    ${botao ? `<button class="btn p" ${botao.attr || ""}>${ico("plus", 16)}${esc(botao.texto)}</button>` : ""}</div>`;
}

export function cabecalhoPagina(titulo, sub = "", acoesHTML = "") {
  return `<div class="pg-topo"><div><h2>${esc(titulo)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
    ${acoesHTML ? `<div class="pg-acoes">${acoesHTML}</div>` : ""}</div>`;
}

export function kpi(rot, val, { cor = "", sub = "", href = "" } = {}) {
  return `<div class="kpi ${cor} ${href ? "click" : ""}" ${href ? `data-ir="${esc(href)}"` : ""}>
    <span class="faixa"></span><div class="rot">${esc(rot)}</div>
    <div class="val">${typeof val === "number" ? num(val) : esc(val)}</div>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

export function barraProgresso(p, grande = false) {
  return `<div class="barra ${grande ? "g" : ""}"><i style="width:${Math.min(100, Math.max(0, p))}%"></i></div>`;
}

/* Delegação global para KPIs clicáveis */
document.addEventListener("click", e => {
  const k = e.target.closest("[data-ir]");
  if (k) location.hash = k.dataset.ir;
});

/* ---------------- exportação CSV ---------------- */
export function baixarCSV(nome, colunas, linhas) {
  const sep = ";";
  const escv = v => {
    const s = String(v ?? "").replace(/"/g, '""');
    return /[";\n]/.test(s) ? `"${s}"` : s;
  };
  const txt = "﻿" + [colunas.map(escv).join(sep), ...linhas.map(l => l.map(escv).join(sep))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
