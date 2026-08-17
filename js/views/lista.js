/* CRUD genérico dirigido por schema: listagem paginada, filtros, cards mobile,
 * editor em modal com validação de duplicidade e exportação. */
import { SCHEMA, campoVisivel } from "../schema.js";
import { buscar, contar, criar, atualizar, obter, excluir, inativar, listaRef, rotulo, parametros } from "../store.js";
import {
  ico, esc, toast, modal, confirmar, montarFormulario, lerFormulario, celula, rotuloColuna,
  cabecalhoPagina, vazio, carregando, baixarCSV, badgeAtivoInativo
} from "../ui.js";
import { pode, sessao } from "../auth.js";
import * as C from "../config.js";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export async function abrirEditor(entidade, id = null, opcoes = {}) {
  const def = SCHEMA[entidade];
  const dados = id ? await obter(entidade, id) : (opcoes.valoresIniciais || {});
  if (id && !dados) return toast("Registro não encontrado.", "err");
  const form = await montarFormulario(entidade, dados, opcoes);

  const m = modal({
    titulo: `${id ? "Editar" : "Novo"} ${def.label.toLowerCase()}`,
    corpo: form, tamanho: def.campos.length > 12 ? "g" : "",
    acoes: [
      { texto: "Cancelar" },
      { texto: "Salvar", classe: "p", icone: "check", aoClicar: async () => {
        const r = lerFormulario(form, entidade);
        if (!r.ok) { toast("Verifique os campos destacados.", "warn"); return false; }
        try {
          const novoId = id ? await atualizar(entidade, id, r.dados) : await criar(entidade, r.dados);
          toast(`${def.label} ${id ? "atualizado" : "cadastrado"} com sucesso.`, "ok");
          opcoes.aoSalvar && opcoes.aoSalvar(novoId, r.dados);
        } catch (e) {
          if (e.message === "DUPLICIDADE") { avisarDuplicidade(entidade, e.duplicados, r.dados, id, opcoes); return false; }
          throw e;
        }
      }}
    ]
  });
  return m;
}

function avisarDuplicidade(entidade, dups, dados, id, opcoes) {
  const def = SCHEMA[entidade];
  modal({
    titulo: "Possível equipamento já cadastrado",
    corpo: `<div class="aviso warn"><div><b>Encontramos registro(s) com o mesmo identificador.</b>
      Confira antes de continuar — patrimônio e número de série não devem se repetir.</div></div>
      <div style="margin-top:14px">${dups.map(d => `
        <div class="card card-pad" style="margin-bottom:9px">
          <div style="font-size:11.5px;color:#5B6F80;font-weight:650;text-transform:uppercase">
            ${esc(rotuloColuna(entidade, d.campo))} duplicado: <span class="mono">${esc(d.valor)}</span></div>
          <div style="margin-top:5px;font-size:14px"><b>${esc(rotulo(entidade, d.registro))}</b></div>
          <div style="font-size:12.5px;color:#5B6F80">${esc([d.registro.fabricante, d.registro.modelo]
            .filter(Boolean).join(" ") || d.registro.razao_social || "")}</div>
          <button class="btn sm" style="margin-top:8px" data-abrir="${d.registro.id}">
            ${ico("eye", 14)}Abrir registro existente</button>
        </div>`).join("")}</div>`,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Salvar mesmo assim", classe: "d", aoClicar: async () => {
        const novoId = id ? await atualizar(entidade, id, dados, { ignorarDuplicidade: true })
                          : await criar(entidade, dados, { ignorarDuplicidade: true });
        toast(`${def.label} salvo. Duplicidade registrada em auditoria.`, "warn");
        opcoes.aoSalvar && opcoes.aoSalvar(novoId, dados);
      }}
    ]
  }).corpo.querySelectorAll("[data-abrir]").forEach(b =>
    b.onclick = () => { location.hash = `#/${entidade}/${b.dataset.abrir}`; document.querySelector(".modal-fundo")?.remove(); });
}

export async function paginaLista(alvo, entidade, o = {}) {
  const def = SCHEMA[entidade];
  const p = await parametros();
  const tam = o.tamanho || p.paginaTamanho;
  const colunas = o.colunas || def.colunas;
  const podeEditar = pode(def.permEditar) || pode("*");
  const filtrosUI = o.filtrosUI || [];
  const estado = { pagina: 0, cursores: [null], filtros: {}, termo: "" };

  alvo.innerHTML = cabecalhoPagina(o.titulo || def.plural, o.subtitulo || "", `
    ${o.acoesTopoHTML || ""}
    <button class="btn" id="lst-exp">${ico("down", 15)}Exportar</button>
    ${podeEditar && !o.semCriar ? `<button class="btn p" id="lst-novo">${ico("plus", 15)}Novo</button>` : ""}`)
    + `<div id="lst-filtros"></div><div id="lst-corpo">${carregando()}</div>`;

  /* ----- filtros ----- */
  if (filtrosUI.length || def.busca?.length) {
    const box = alvo.querySelector("#lst-filtros");
    const selects = [];
    for (const nome of filtrosUI) {
      const campo = def.campos.find(c => c.n === nome);
      if (!campo) continue;
      let ops = [];
      if (campo.t === "select") ops = campo.opcoes.map(x => ({ v: x.v ?? x, l: x.label ?? x }));
      else if (campo.t === "ref") ops = (await listaRef(campo.ref)).map(x => ({ v: x.id, l: rotulo(campo.ref, x) }));
      /* Campos de UF não têm lista no schema; sem isto o filtro nasceria vazio. */
      else if (campo.t === "uf") ops = UFS.map(u => ({ v: u, l: u }));
      selects.push(`<select class="inp" data-f="${nome}"><option value="">${esc(campo.l)}: todos</option>
        ${ops.map(x => `<option value="${esc(x.v)}">${esc(x.l)}</option>`).join("")}</select>`);
    }
    box.innerHTML = `<div class="filtros"><div class="linha">
      ${def.busca?.length ? `<input class="inp" id="lst-busca" placeholder="Buscar por ${def.busca.slice(0,2).map(b=>rotuloColuna(entidade,b).toLowerCase()).join(" ou ")}…">` : ""}
      ${selects.join("")}</div>
      <div class="pe"><span class="cont" id="lst-cont"></span>
        <button class="btn sm" id="lst-limpar">Limpar filtros</button></div></div>`;

    box.querySelectorAll("[data-f]").forEach(s => s.onchange = () => {
      estado.filtros[s.dataset.f] = s.value || undefined; reiniciar();
    });
    const bi = box.querySelector("#lst-busca");
    if (bi) { let t; bi.oninput = () => { clearTimeout(t); t = setTimeout(() => { estado.termo = bi.value.trim(); reiniciar(); }, 300); }; }
    box.querySelector("#lst-limpar").onclick = () => {
      estado.filtros = {}; estado.termo = "";
      box.querySelectorAll("[data-f]").forEach(s => s.value = "");
      if (bi) bi.value = ""; reiniciar();
    };
  }

  alvo.querySelector("#lst-novo")?.addEventListener("click", () =>
    abrirEditor(entidade, null, { valoresIniciais: o.valoresIniciais, aoSalvar: () => reiniciar() }));
  alvo.querySelector("#lst-exp")?.addEventListener("click", exportar);

  function filtrosAtuais() {
    const f = [...(o.filtrosFixos || [])];
    for (const [k, v] of Object.entries(estado.filtros)) if (v) f.push([k, "==", v]);
    if (estado.termo) {
      const campo = def.busca[0];
      const t = /patrimonio|serie|tag/.test(campo) ? estado.termo.toUpperCase() : estado.termo;
      f.push([campo, ">=", t], [campo, "<=", t + ""]);
    }
    return f;
  }

  function reiniciar() { estado.pagina = 0; estado.cursores = [null]; carregar(); }

  async function carregar() {
    const corpo = alvo.querySelector("#lst-corpo");
    corpo.innerHTML = carregando();
    const filtros = filtrosAtuais();
    const ordem = estado.termo ? [def.busca[0], "asc"] : (o.ordem || def.ordem || null);
    let res;
    try {
      res = await buscar(entidade, filtros, ordem, tam, estado.cursores[estado.pagina]);
    } catch (e) {
      corpo.innerHTML = `<div class="aviso err"><div><b>Consulta bloqueada</b>
        ${/index/i.test(e.message) ? "Falta um índice composto no Firestore. Abra o console do navegador e clique no link gerado pelo Firebase para criá-lo automaticamente."
          : esc(e.message)}</div></div>`;
      console.error(e); return;
    }
    const { dados, ultimo, fim } = res;

    const cont = alvo.querySelector("#lst-cont");
    if (cont) {
      try { cont.textContent = `${await contar(entidade, filtros)} registro(s)`; }
      catch { cont.textContent = `${dados.length} nesta página`; }
    }

    if (!dados.length && estado.pagina === 0) {
      corpo.innerHTML = vazio(`Nenhum ${def.label.toLowerCase()} encontrado`,
        Object.keys(estado.filtros).length || estado.termo
          ? "Ajuste os filtros ou limpe a busca."
          : `Comece cadastrando o primeiro ${def.label.toLowerCase()}.`,
        podeEditar && !o.semCriar ? { texto: `Cadastrar ${def.label.toLowerCase()}`, attr: 'id="lst-novo2"' } : null);
      corpo.querySelector("#lst-novo2")?.addEventListener("click", () =>
        abrirEditor(entidade, null, { valoresIniciais: o.valoresIniciais, aoSalvar: reiniciar }));
      return;
    }

    corpo.innerHTML = `
      <div class="tab-wrap responsiva"><table class="tab"><thead><tr>
        ${colunas.map(c => `<th>${esc(rotuloColuna(entidade, c))}</th>`).join("")}
        ${podeEditar ? "<th></th>" : ""}
      </tr></thead><tbody>
        ${dados.map(d => `<tr class="click" data-id="${d.id}">
          ${colunas.map(c => `<td>${celula(entidade, c, d)}</td>`).join("")}
          ${podeEditar ? `<td><div class="acoes">
            <button class="btn sm" data-ed="${d.id}" title="Editar">${ico("edit", 14)}</button>
            <button class="btn sm" data-ex="${d.id}" title="Excluir">${ico("trash", 14)}</button>
          </div></td>` : ""}
        </tr>`).join("")}
      </tbody></table></div>

      <div class="lista-cards">
        ${dados.map(d => {
          const cm = o.cardMobile ? o.cardMobile(d) : {
            titulo: rotulo(entidade, d),
            linha2: colunas.slice(1, 3).map(c => celula(entidade, c, d)).join(" · "),
            linha3: colunas.slice(3).map(c => celula(entidade, c, d)).join(" · ")
          };
          return `<div class="item-card" data-id="${d.id}">
            <div class="l1"><b>${cm.titulo}</b>${cm.badge || ""}</div>
            <div class="l2">${cm.linha2 || ""}</div>
            <div class="l3">${cm.linha3 || ""}</div></div>`;
        }).join("")}
      </div>

      <div class="paginacao">
        <span>Página ${estado.pagina + 1}</span>
        <button class="btn sm" id="pg-ant" ${estado.pagina === 0 ? "disabled" : ""}>Anterior</button>
        <button class="btn sm" id="pg-prox" ${fim ? "disabled" : ""}>Próxima</button>
      </div>`;

    corpo.querySelectorAll("[data-id]").forEach(el => el.onclick = e => {
      if (e.target.closest("[data-ed],[data-ex]")) return;
      const d = dados.find(x => x.id === el.dataset.id);
      if (o.aoClicarLinha) o.aoClicarLinha(d);
      else if (podeEditar) abrirEditor(entidade, d.id, { aoSalvar: carregar });
    });
    corpo.querySelectorAll("[data-ed]").forEach(b => b.onclick = e => {
      e.stopPropagation(); abrirEditor(entidade, b.dataset.ed, { aoSalvar: carregar });
    });
    corpo.querySelectorAll("[data-ex]").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const d = dados.find(x => x.id === b.dataset.ex);
      const nome = rotulo(entidade, d);
      if (!await confirmar(`Excluir ${def.label.toLowerCase()}?`,
        `<b>${esc(nome)}</b> será removido. Registros com histórico vinculado não podem ser excluídos —
         nesse caso você poderá inativá-lo.`, "Excluir", true)) return;
      try { await excluir(entidade, d.id); toast("Registro excluído.", "ok"); carregar(); }
      catch (ex) {
        if (ex.message === "VINCULADO") {
          if (await confirmar("Exclusão bloqueada",
            `Este registro possui ${esc(ex.detalhe)} vinculado(s). Excluir apagaria histórico.
             Deseja <b>inativar</b> em vez de excluir?`, "Inativar")) {
            await inativar(entidade, d.id); toast("Registro inativado.", "ok"); carregar();
          }
        } else throw ex;
      }
    });
    corpo.querySelector("#pg-ant").onclick = () => { estado.pagina--; carregar(); };
    corpo.querySelector("#pg-prox").onclick = () => {
      estado.cursores[estado.pagina + 1] = ultimo; estado.pagina++; carregar();
    };
  }

  async function exportar() {
    toast("Preparando exportação…", "info");
    const { dados } = await buscar(entidade, filtrosAtuais(), o.ordem || null, 5000);
    /* Campos financeiros nunca saem no CSV de quem não pode vê-los na tela. */
    const cols = def.campos.filter(c => campoVisivel(c, sessao.usuario?.perfil)).map(c => c.n);
    baixarCSV(entidade,
      cols.map(c => rotuloColuna(entidade, c)),
      dados.map(d => cols.map(c => {
        const html = celula(entidade, c, d);
        return html.replace(/<[^>]+>/g, "").trim();
      })));
    toast(`${dados.length} registro(s) exportado(s).`, "ok");
  }

  carregar();
}
