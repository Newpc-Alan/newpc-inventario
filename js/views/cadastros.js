/* NEWPC INVENTÁRIO — Cadastros: clientes, unidades, municípios e fornecedores.
 *
 * Regra de ouro deste arquivo:
 *   FORNECEDOR  = quem é DONO do equipamento (locação/comodato de terceiro).
 *   CLIENTE     = onde o equipamento está INSTALADO.
 * São coisas diferentes e a tela deixa isso explícito — cor, rótulo e ícone distintos.
 *
 * Nenhum número desta tela é fixo: tudo sai de contar() ou buscar().
 * A coleção "ativos" nunca é carregada inteira — só contagens e listas paginadas.
 */
import { paginaLista, abrirEditor } from "./lista.js";
import { obter, buscar, contar, excluir, parametros } from "../store.js";
import {
  ico, esc, num, pct, dataBR, cnpjFmt, badge, kpi, barraProgresso,
  vazio, carregando, toast, confirmar
} from "../ui.js";
import { irPara } from "../router.js";
import { pode } from "../auth.js";
import * as C from "../config.js";

/* ============================================================
 * Utilidades locais
 * ============================================================ */

/* Conta ativos por status. Uma consulta de agregação por status, sempre em paralelo. */
function contarPorStatus(base, status) {
  return contar("ativos", [...base, ["status", "==", status]]);
}

/* Ordena em memória. Evita exigir índice composto do Firestore em listas pequenas
   (setores, locais, unidades de um cliente), que seriam bloqueadas sem índice. */
function porNome(a, b) {
  return String(a.nome || a.codigo_interno || "").localeCompare(String(b.nome || b.codigo_interno || ""), "pt-BR");
}

/* Excluir com mensagem honesta quando existe vínculo (o store bloqueia por segurança). */
async function apagar(colecao, id, descricao, recarregar) {
  const ok = await confirmar(`Excluir ${esc(descricao)}?`,
    "O registro será removido. Se houver equipamentos ou cadastros vinculados, a exclusão será bloqueada.",
    "Excluir", true);
  if (!ok) return;
  try {
    await excluir(colecao, id);
    toast("Registro excluído.", "ok");
    recarregar();
  } catch (e) {
    if (e.message === "VINCULADO") {
      toast(`Existem ${e.detalhe} apontando para este registro. Remova ou transfira antes de excluir.`,
        "err", "Exclusão bloqueada");
      return;
    }
    throw e;
  }
}

/* Linha de dado da ficha. */
function dado(rot, valor) {
  const vazioV = valor === null || valor === undefined || valor === "" || valor === "—";
  return `<div class="dado"><div class="r">${esc(rot)}</div>
    <div class="v ${vazioV ? "vazio-v" : ""}">${vazioV ? "—" : valor}</div></div>`;
}

/* ============================================================
 * MUNICÍPIOS — cadastro simples, sem ficha própria
 * ============================================================ */
export async function municipios(alvo, ctx) {
  await paginaLista(alvo, "municipios", {
    subtitulo: "Municípios usados por clientes, unidades e ativos.",
    filtrosUI: ["uf"],
    ordem: ["nome", "asc"]
  });
}

/* ============================================================
 * FORNECEDORES — o proprietário dos equipamentos locados
 * ============================================================ */
export async function fornecedores(alvo, ctx) {
  if (!ctx.id) {
    return paginaLista(alvo, "fornecedores", {
      subtitulo: "Empresas proprietárias de equipamentos locados ou em comodato.",
      filtrosUI: ["uf"],
      ordem: ["razao_social", "asc"],
      aoClicarLinha: d => irPara("fornecedores", d.id),
      cardMobile: d => ({
        titulo: esc(d.nome_fantasia || d.razao_social),
        linha2: esc(d.razao_social || ""),
        linha3: `${esc(cnpjFmt(d.cnpj))} · ${esc(d.cidade || "")}${d.uf ? "/" + esc(d.uf) : ""}`
      })
    });
  }
  await fichaFornecedor(alvo, ctx.id);
}

async function fichaFornecedor(alvo, id) {
  const f = await obter("fornecedores", id);
  if (!f) { alvo.innerHTML = vazio("Fornecedor não encontrado", "O registro pode ter sido excluído."); return; }

  const base = [["fornecedor_id", "==", id]];

  alvo.innerHTML = `
    <div class="ficha-topo">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:1px;opacity:.75;font-weight:700">
          ${ico("truck", 13)} FORNECEDOR · PROPRIETÁRIO DOS EQUIPAMENTOS</div>
        <div class="pat" style="font-size:21px">${esc(f.nome_fantasia || f.razao_social)}</div>
        <div class="desc">${esc(f.razao_social || "")}</div>
        <div class="desc mono">${esc(cnpjFmt(f.cnpj))}</div>
      </div>
      <div class="dir">
        <button class="btn" data-ir="#/fornecedores">${ico("arrows", 15)}Voltar</button>
        <button class="btn" id="fo-editar">${ico("edit", 15)}Editar</button>
        <button class="btn p" data-ir="#/ativos?fornecedor_id=${esc(id)}">
          ${ico("cpu", 15)}Ver todos os ativos deste fornecedor</button>
      </div>
    </div>

    <div class="grade g3" style="margin-bottom:16px">
      ${dado("Contato", esc(f.contato || ""))}
      ${dado("Telefone", esc(f.telefone || ""))}
      ${dado("E-mail", f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : "")}
      ${dado("Endereço", esc(f.endereco || ""))}
      ${dado("Cidade / UF", esc([f.cidade, f.uf].filter(Boolean).join(" / ")))}
      ${dado("Situação", f.ativo === false
        ? `<span class="st st-cinza">Inativo</span>` : `<span class="st st-verde">Ativo</span>`)}
    </div>

    <div id="fo-kpis">${carregando("Contando equipamentos deste fornecedor…")}</div>

    <div class="pg-topo" style="margin-top:22px">
      <div><h2 style="font-size:17px">Contratos e operações</h2>
        <p>Cada operação é um lote de equipamentos que não se mistura com os demais.</p></div>
      <div class="pg-acoes">
        ${pode("contrato.editar") ? `<button class="btn p" id="fo-novo-contrato">
          ${ico("plus", 15)}Novo contrato</button>` : ""}
      </div>
    </div>
    <div id="fo-contratos">${carregando()}</div>`;

  alvo.querySelector("#fo-editar").onclick = () =>
    abrirEditor("fornecedores", id, { aoSalvar: () => fichaFornecedor(alvo, id) });
  alvo.querySelector("#fo-novo-contrato")?.addEventListener("click", () =>
    abrirEditor("contratos_fornecedor", null, {
      valoresIniciais: { fornecedor_id: id },
      aoSalvar: () => fichaFornecedor(alvo, id)
    }));

  /* ---- KPIs: cada número é uma agregação no servidor, disparada em paralelo ---- */
  const [total, emUso, emEstoque, manutencao, naoLocalizado, devolvidos] = await Promise.all([
    contar("ativos", base),
    contarPorStatus(base, "EM_USO"),
    contarPorStatus(base, "EM_ESTOQUE"),
    contarPorStatus(base, "EM_MANUTENCAO"),
    contarPorStatus(base, "NAO_LOCALIZADO"),
    contarPorStatus(base, "DEVOLVIDO_FORNECEDOR")
  ]);
  const q = s => `#/ativos?fornecedor_id=${id}&status=${s}`;
  alvo.querySelector("#fo-kpis").innerHTML = `<div class="grade g3">
    ${kpi("Equipamentos do fornecedor", total, { cor: "azul", href: `#/ativos?fornecedor_id=${id}` })}
    ${kpi("Em uso", emUso, { cor: "verde", href: q("EM_USO") })}
    ${kpi("Em estoque", emEstoque, { cor: "azul", href: q("EM_ESTOQUE") })}
    ${kpi("Em manutenção", manutencao, { cor: "laranja", href: q("EM_MANUTENCAO") })}
    ${kpi("Não localizados", naoLocalizado, { cor: "vermelho", href: q("NAO_LOCALIZADO") })}
    ${kpi("Devolvidos", devolvidos, { cor: "", href: q("DEVOLVIDO_FORNECEDOR") })}
  </div>`;

  /* ---- Contratos/operações do fornecedor ---- */
  const { dados: contratos } = await buscar("contratos_fornecedor", base, null, 300);
  contratos.sort((a, b) =>
    String(a.codigo_interno || "").localeCompare(String(b.codigo_interno || ""), "pt-BR"));

  const boxC = alvo.querySelector("#fo-contratos");
  if (!contratos.length) {
    boxC.innerHTML = vazio("Nenhum contrato cadastrado para este fornecedor",
      "Cadastre a operação (ex.: “Aventis 01”) para conseguir separar os equipamentos por contrato.",
      pode("contrato.editar") ? { texto: "Cadastrar contrato", attr: 'id="fo-novo-contrato2"' } : null);
    boxC.querySelector("#fo-novo-contrato2")?.addEventListener("click", () =>
      abrirEditor("contratos_fornecedor", null, {
        valoresIniciais: { fornecedor_id: id }, aoSalvar: () => fichaFornecedor(alvo, id)
      }));
    return;
  }

  /* Quantidade real de ativos por contrato — todas as contagens em paralelo. */
  const reais = await Promise.all(contratos.map(c =>
    contar("ativos", [["contrato_fornecedor_id", "==", c.id]])));

  boxC.innerHTML = `<div class="grade g3">${contratos.map((c, i) => {
    const real = reais[i];
    const prev = Number(c.quantidade_prevista || 0);
    return `<div class="card card-pad" data-ir="#/locacoes/${esc(c.id)}" style="cursor:pointer">
      <div style="display:flex;align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div style="font-size:15.5px;font-weight:800;color:var(--marinho)">${esc(c.codigo_interno || "—")}</div>
          <div style="font-size:12.3px;color:var(--texto-2)">
            Contrato ${esc(c.numero_contrato || "sem número")}</div>
        </div>
        <div style="margin-left:auto">${badge(C.STATUS_CONTRATO_FORNECEDOR, c.status)}</div>
      </div>
      <div style="font-size:12.3px;color:var(--texto-2);margin-top:9px">
        Vigência: ${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))}</div>
      <div style="display:flex;justify-content:space-between;font-size:12.8px;margin:11px 0 5px">
        <span>Previstos: <b>${num(prev)}</b></span>
        <span>Cadastrados: <b>${num(real)}</b></span>
      </div>
      ${barraProgresso(pct(real, prev))}
      ${prev > 0 && real > prev
        ? `<div class="aviso warn" style="margin-top:9px;font-size:12px">
            <div>${num(real - prev)} equipamento(s) acima do previsto em contrato.</div></div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

/* ============================================================
 * CLIENTES — onde os equipamentos estão instalados
 * ============================================================ */
export async function clientes(alvo, ctx) {
  if (!ctx.id) {
    return paginaLista(alvo, "clientes", {
      subtitulo: "Órgãos e empresas atendidas. É onde o equipamento está instalado — não confundir com o fornecedor.",
      filtrosUI: ["tipo", "municipio_id", "esfera"],
      ordem: ["razao_social", "asc"],
      aoClicarLinha: d => irPara("clientes", d.id)
    });
  }
  await fichaCliente(alvo, ctx.id);
}

async function fichaCliente(alvo, id) {
  const cli = await obter("clientes", id);
  if (!cli) { alvo.innerHTML = vazio("Cliente não encontrado", "O registro pode ter sido excluído."); return; }
  const p = await parametros();
  const base = [["cliente_id", "==", id]];

  alvo.innerHTML = `
    <div class="ficha-topo">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:1px;opacity:.75;font-weight:700">
          ${ico("building", 13)} CLIENTE · LOCAL DE INSTALAÇÃO DOS EQUIPAMENTOS</div>
        <div class="pat" style="font-size:21px">${esc(cli.nome_fantasia || cli.razao_social)}</div>
        <div class="desc">${esc(cli.razao_social || "")}</div>
        <div class="desc mono">${esc(cnpjFmt(cli.cnpj))}</div>
      </div>
      <div class="dir">
        <button class="btn" data-ir="#/clientes">${ico("arrows", 15)}Voltar</button>
        <button class="btn" id="cl-editar">${ico("edit", 15)}Editar</button>
        <button class="btn p" data-ir="#/ativos?cliente_id=${esc(id)}">
          ${ico("cpu", 15)}Ver ativos deste cliente</button>
      </div>
    </div>

    <div class="grade g3" style="margin-bottom:16px">
      ${dado("Tipo", esc(cli.tipo || ""))}
      ${dado("Esfera", esc(cli.esfera || ""))}
      ${dado("Município", esc(cli.municipio_id ? await rotuloMunicipio(cli.municipio_id) : ""))}
      ${dado("Endereço", esc(cli.endereco || ""))}
      ${dado("Responsável", esc(cli.responsavel || ""))}
      ${dado("Telefone", esc(cli.telefone || ""))}
      ${dado("E-mail", cli.email ? `<a href="mailto:${esc(cli.email)}">${esc(cli.email)}</a>` : "")}
      ${dado("Situação", cli.ativo === false
        ? `<span class="st st-cinza">Inativo</span>` : `<span class="st st-verde">Ativo</span>`)}
    </div>

    <div id="cl-kpis">${carregando("Contando equipamentos deste cliente…")}</div>

    <div class="pg-topo" style="margin-top:22px">
      <div><h2 style="font-size:17px">Unidades atendidas</h2>
        <p>Escolas, secretarias e demais locais deste cliente.</p></div>
      <div class="pg-acoes">
        ${pode("unidade.editar") ? `<button class="btn p" id="cl-nova-unidade">
          ${ico("plus", 15)}Nova unidade</button>` : ""}
      </div>
    </div>
    <div id="cl-unidades">${carregando()}</div>

    <div class="pg-topo" style="margin-top:22px">
      <div><h2 style="font-size:17px">Contratos comerciais</h2>
        <p>Contratos firmados com este cliente. Não confundir com locações de fornecedores.</p></div>
    </div>
    <div id="cl-contratos">${carregando()}</div>`;

  alvo.querySelector("#cl-editar").onclick = () =>
    abrirEditor("clientes", id, { aoSalvar: () => fichaCliente(alvo, id) });
  alvo.querySelector("#cl-nova-unidade")?.addEventListener("click", () =>
    abrirEditor("unidades", null, {
      valoresIniciais: { cliente_id: id, municipio_id: cli.municipio_id },
      aoSalvar: () => fichaCliente(alvo, id)
    }));

  /* ---- KPIs ---- */
  const limiteInventario = new Date(Date.now() - (p.diasInventarioVencido || 90) * 86400000);
  const [total, emUso, naoLocalizado] = await Promise.all([
    contar("ativos", base),
    contarPorStatus(base, "EM_USO"),
    contarPorStatus(base, "NAO_LOCALIZADO")
  ]);
  /* O carimbo "ultimo_inventario" é gravado pelo módulo de inventário. Se o índice composto
     ainda não existir, mostramos "—" em vez de um número inventado. */
  let inventariados = null;
  try {
    inventariados = await contar("ativos", [...base, ["ultimo_inventario", ">=", limiteInventario]]);
  } catch { inventariados = null; }

  alvo.querySelector("#cl-kpis").innerHTML = `<div class="grade g4">
    ${kpi("Total de ativos", total, { cor: "azul", href: `#/ativos?cliente_id=${id}` })}
    ${kpi("Em uso", emUso, { cor: "verde", href: `#/ativos?cliente_id=${id}&status=EM_USO` })}
    ${kpi("Não localizados", naoLocalizado, { cor: "vermelho", href: `#/ativos?cliente_id=${id}&status=NAO_LOCALIZADO` })}
    ${kpi(`Inventariados em ${p.diasInventarioVencido} dias`,
      inventariados === null ? "—" : inventariados,
      { cor: inventariados !== null && pct(inventariados, total) >= 80 ? "verde" : "amarelo",
        sub: inventariados === null ? "Contagem indisponível" : `${pct(inventariados, total)}% do total` })}
  </div>`;

  await montarUnidadesDoCliente(alvo.querySelector("#cl-unidades"), id, () => fichaCliente(alvo, id));
  await montarContratosDoCliente(alvo.querySelector("#cl-contratos"), id);
}

async function rotuloMunicipio(municipioId) {
  const m = await obter("municipios", municipioId);
  return m ? `${m.nome}/${m.uf}` : "";
}

/* Unidades do cliente com total de ativos por unidade.
   Cuidado com desempenho: uma consulta de contagem por unidade. Acima de 40 unidades
   a contagem vira sob demanda, para não disparar centenas de consultas ao abrir a ficha. */
const LIMITE_CONTAGEM_UNIDADES = 40;

async function montarUnidadesDoCliente(box, clienteId, recarregar) {
  const { dados: unidades } = await buscar("unidades", [["cliente_id", "==", clienteId]], null, 500);
  unidades.sort(porNome);

  if (!unidades.length) {
    box.innerHTML = vazio("Nenhuma unidade cadastrada",
      "Cadastre as escolas, secretarias e demais locais deste cliente para poder inventariar.",
      pode("unidade.editar") ? { texto: "Cadastrar unidade", attr: 'id="cl-nova-unidade2"' } : null);
    box.querySelector("#cl-nova-unidade2")?.addEventListener("click", async () => {
      const cli = await obter("clientes", clienteId);
      abrirEditor("unidades", null, {
        valoresIniciais: { cliente_id: clienteId, municipio_id: cli?.municipio_id },
        aoSalvar: recarregar
      });
    });
    return;
  }

  const muitas = unidades.length > LIMITE_CONTAGEM_UNIDADES;
  const linhas = u => `
    <td><b>${esc(u.nome)}</b></td>
    <td>${esc(u.tipo || "—")}</td>
    <td>${esc(u.bairro || "—")}</td>
    <td class="num" data-cont="${esc(u.id)}">${muitas ? "—" : `<span class="spin"></span>`}</td>`;

  box.innerHTML = `
    ${muitas ? `<div class="aviso info" style="margin-bottom:11px"><div>
      <b>${num(unidades.length)} unidades neste cliente.</b>
      Para não deixar a página lenta, os totais de ativos não são contados automaticamente.</div>
      <button class="btn sm" id="cl-calcular" style="margin-left:auto">${ico("chart", 14)}Calcular</button>
    </div>` : ""}
    <div class="tab-wrap responsiva"><table class="tab"><thead><tr>
      <th>Unidade</th><th>Tipo</th><th>Bairro</th><th style="text-align:right">Ativos</th>
    </tr></thead><tbody>
      ${unidades.map(u => `<tr class="click" data-un="${esc(u.id)}">${linhas(u)}</tr>`).join("")}
    </tbody></table></div>
    <div class="lista-cards">
      ${unidades.map(u => `<div class="item-card" data-un="${esc(u.id)}">
        <div class="l1"><b>${esc(u.nome)}</b><span class="st st-azul" data-cont="${esc(u.id)}">${muitas ? "—" : "…"}</span></div>
        <div class="l2">${esc(u.tipo || "—")}</div>
        <div class="l3">${esc(u.bairro || "")}</div></div>`).join("")}
    </div>`;

  box.querySelectorAll("[data-un]").forEach(el =>
    el.onclick = () => irPara("unidades", el.dataset.un));

  const preencher = async () => {
    box.querySelectorAll("[data-cont]").forEach(c => { if (c.textContent === "—") c.innerHTML = `<span class="spin"></span>`; });
    const totais = await Promise.all(unidades.map(u => contar("ativos", [["unidade_id", "==", u.id]])));
    unidades.forEach((u, i) =>
      box.querySelectorAll(`[data-cont="${u.id}"]`).forEach(c => c.textContent = num(totais[i])));
  };

  if (muitas) box.querySelector("#cl-calcular").onclick = e => { e.currentTarget.disabled = true; preencher(); };
  else await preencher();
}

async function montarContratosDoCliente(box, clienteId) {
  const { dados } = await buscar("contratos_cliente", [["cliente_id", "==", clienteId]], null, 200);
  if (!dados.length) {
    box.innerHTML = vazio("Nenhum contrato comercial cadastrado",
      "Cadastre o contrato para vincular os equipamentos entregues a este cliente.");
    return;
  }
  dados.sort((a, b) => String(b.data_inicio || "").localeCompare(String(a.data_inicio || "")));
  box.innerHTML = `<div class="tab-wrap responsiva"><table class="tab"><thead><tr>
      <th>Contrato</th><th>Modalidade</th><th>Vigência</th><th style="text-align:right">Qtd. prevista</th><th>Status</th>
    </tr></thead><tbody>
      ${dados.map(c => `<tr class="click" data-ct="${esc(c.id)}">
        <td><b>${esc(c.numero_contrato || "—")}</b></td>
        <td>${esc(c.modalidade || "—")}</td>
        <td>${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))}</td>
        <td class="num">${num(c.quantidade_prevista || 0)}</td>
        <td>${badge(C.STATUS_CONTRATO_CLIENTE, c.status)}</td>
      </tr>`).join("")}
    </tbody></table></div>
    <div class="lista-cards">
      ${dados.map(c => `<div class="item-card" data-ct="${esc(c.id)}">
        <div class="l1"><b>${esc(c.numero_contrato || "—")}</b>${badge(C.STATUS_CONTRATO_CLIENTE, c.status)}</div>
        <div class="l2">${esc(c.modalidade || "—")}</div>
        <div class="l3">${esc(dataBR(c.data_inicio))} a ${esc(dataBR(c.data_fim))}</div></div>`).join("")}
    </div>`;
  box.querySelectorAll("[data-ct]").forEach(el => el.onclick = () => irPara("contratos", el.dataset.ct));
}

/* ============================================================
 * UNIDADES — a ponta da operação: setores, locais e inventário
 * ============================================================ */
export async function unidades(alvo, ctx) {
  if (!ctx.id) {
    return paginaLista(alvo, "unidades", {
      subtitulo: "Escolas, secretarias e demais locais atendidos.",
      filtrosUI: ["cliente_id", "municipio_id", "tipo"],
      ordem: ["nome", "asc"],
      aoClicarLinha: d => irPara("unidades", d.id)
    });
  }
  await fichaUnidade(alvo, ctx.id);
}

async function fichaUnidade(alvo, id) {
  const u = await obter("unidades", id);
  if (!u) { alvo.innerHTML = vazio("Unidade não encontrada", "O registro pode ter sido excluído."); return; }

  const [cli, mun] = await Promise.all([
    u.cliente_id ? obter("clientes", u.cliente_id) : null,
    u.municipio_id ? obter("municipios", u.municipio_id) : null
  ]);
  const base = [["unidade_id", "==", id]];
  const temGeo = u.latitude != null && u.longitude != null && u.latitude !== "" && u.longitude !== "";

  alvo.innerHTML = `
    <div class="ficha-topo">
      <div style="min-width:0">
        <div style="font-size:11px;letter-spacing:1px;opacity:.75;font-weight:700">
          ${ico("school", 13)} UNIDADE</div>
        <div class="pat" style="font-size:21px">${esc(u.nome)}</div>
        <div class="desc">${ico("building", 12)} ${esc(cli ? (cli.nome_fantasia || cli.razao_social) : "Sem cliente")}
          ${mun ? ` · ${esc(mun.nome)}/${esc(mun.uf)}` : ""}</div>
        <div class="desc">${esc([u.endereco, u.bairro, u.cep].filter(Boolean).join(" · ") || "Endereço não informado")}</div>
      </div>
      <div class="dir">
        <button class="btn" data-ir="#/unidades">${ico("arrows", 15)}Voltar</button>
        <button class="btn" id="un-editar">${ico("edit", 15)}Editar</button>
        ${temGeo ? `<a class="btn" target="_blank" rel="noopener"
          href="https://www.google.com/maps?q=${encodeURIComponent(u.latitude + "," + u.longitude)}">
          ${ico("pin", 15)}Ver no mapa</a>` : ""}
        <button class="btn p" data-ir="#/ativos?unidade_id=${esc(id)}">${ico("cpu", 15)}Ver ativos</button>
      </div>
    </div>

    <div class="grade g3" style="margin-bottom:16px">
      ${dado("Tipo", esc(u.tipo || ""))}
      ${dado("Responsável", esc(u.responsavel || ""))}
      ${dado("Telefone", esc(u.telefone || ""))}
    </div>

    <div id="un-kpis">${carregando("Contando equipamentos desta unidade…")}</div>

    <button class="btn v lg bloco" id="un-inventario" style="margin:18px 0">
      ${ico("scan", 19)}Iniciar inventário desta unidade</button>

    <div class="card">
      <div class="card-tit">${ico("layers", 17)}<h3>Setores e locais</h3>
        <div class="dir">${pode("unidade.editar")
          ? `<button class="btn sm p" id="un-novo-setor">${ico("plus", 14)}Novo setor</button>` : ""}</div>
      </div>
      <div class="card-pad" id="un-arvore">${carregando()}</div>
    </div>`;

  alvo.querySelector("#un-editar").onclick = () =>
    abrirEditor("unidades", id, { aoSalvar: () => fichaUnidade(alvo, id) });
  alvo.querySelector("#un-inventario").onclick = () =>
    irPara("inventario", "novo", { cliente_id: u.cliente_id || "", unidade_id: id });
  alvo.querySelector("#un-novo-setor")?.addEventListener("click", () =>
    abrirEditor("setores", null, { valoresIniciais: { unidade_id: id }, aoSalvar: () => fichaUnidade(alvo, id) }));

  const [total, emUso, manutencao, naoLocalizado] = await Promise.all([
    contar("ativos", base),
    contarPorStatus(base, "EM_USO"),
    contarPorStatus(base, "EM_MANUTENCAO"),
    contarPorStatus(base, "NAO_LOCALIZADO")
  ]);
  alvo.querySelector("#un-kpis").innerHTML = `<div class="grade g4">
    ${kpi("Ativos na unidade", total, { cor: "azul", href: `#/ativos?unidade_id=${id}` })}
    ${kpi("Em uso", emUso, { cor: "verde", href: `#/ativos?unidade_id=${id}&status=EM_USO` })}
    ${kpi("Em manutenção", manutencao, { cor: "laranja", href: `#/ativos?unidade_id=${id}&status=EM_MANUTENCAO` })}
    ${kpi("Não localizados", naoLocalizado, { cor: "vermelho", href: `#/ativos?unidade_id=${id}&status=NAO_LOCALIZADO` })}
  </div>`;

  await montarArvore(alvo.querySelector("#un-arvore"), id, () => fichaUnidade(alvo, id));
}

/* Árvore setor → local, com contagem de ativos em cada nível.
   Setores e locais de uma unidade são poucos; as contagens vão todas em paralelo. */
async function montarArvore(box, unidadeId, recarregar) {
  const editar = pode("unidade.editar");
  const { dados: setores } = await buscar("setores", [["unidade_id", "==", unidadeId]], null, 200);
  setores.sort(porNome);

  if (!setores.length) {
    box.innerHTML = vazio("Nenhum setor cadastrado",
      "Organize a unidade em setores (ex.: Secretaria, Laboratório) e depois em locais/salas.",
      editar ? { texto: "Cadastrar setor", attr: 'id="arv-novo-setor"' } : null);
    box.querySelector("#arv-novo-setor")?.addEventListener("click", () =>
      abrirEditor("setores", null, { valoresIniciais: { unidade_id: unidadeId }, aoSalvar: recarregar }));
    return;
  }

  const locaisPorSetor = await Promise.all(setores.map(s =>
    buscar("locais", [["setor_id", "==", s.id]], null, 300).then(r => r.dados.sort(porNome))));

  const todosLocais = locaisPorSetor.flat();
  const [contSetores, contLocais] = await Promise.all([
    Promise.all(setores.map(s => contar("ativos", [["setor_id", "==", s.id]]))),
    Promise.all(todosLocais.map(l => contar("ativos", [["local_id", "==", l.id]])))
  ]);
  const mapaLocal = new Map(todosLocais.map((l, i) => [l.id, contLocais[i]]));

  box.innerHTML = setores.map((s, i) => {
    const locais = locaisPorSetor[i];
    return `<div style="padding:11px 0;border-bottom:1px solid var(--borda)">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        ${ico("layers", 16)}
        <b style="font-size:14.5px;color:var(--marinho)">${esc(s.nome)}</b>
        <span class="st st-azul">${num(contSetores[i])} ativo(s)</span>
        ${s.descricao ? `<span style="font-size:12px;color:var(--texto-2)">${esc(s.descricao)}</span>` : ""}
        <div style="margin-left:auto;display:flex;gap:6px">
          ${editar ? `<button class="btn sm" data-novo-local="${esc(s.id)}">${ico("plus", 13)}Novo local</button>
            <button class="btn sm" data-ed-setor="${esc(s.id)}" title="Editar setor">${ico("edit", 13)}</button>
            <button class="btn sm" data-ex-setor="${esc(s.id)}" title="Excluir setor">${ico("trash", 13)}</button>` : ""}
        </div>
      </div>
      <div style="margin:7px 0 0 26px">
        ${locais.length ? locais.map(l => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;flex-wrap:wrap">
            ${ico("door", 14)}
            <span style="font-size:13.4px">${esc(l.nome)}</span>
            ${l.andar ? `<span style="font-size:11.8px;color:var(--texto-2)">${esc(l.andar)}</span>` : ""}
            <span class="st st-cinza">${num(mapaLocal.get(l.id) || 0)}</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn sm" data-ir="#/ativos?local_id=${esc(l.id)}" title="Ver ativos">${ico("eye", 13)}</button>
              ${editar ? `<button class="btn sm" data-ed-local="${esc(l.id)}" title="Editar local">${ico("edit", 13)}</button>
                <button class="btn sm" data-ex-local="${esc(l.id)}" title="Excluir local">${ico("trash", 13)}</button>` : ""}
            </div>
          </div>`).join("")
        : `<div style="font-size:12.5px;color:var(--texto-2);padding:4px 0">Nenhum local cadastrado neste setor.</div>`}
      </div>
    </div>`;
  }).join("");

  const nomeSetor = sid => setores.find(s => s.id === sid)?.nome || "setor";
  const nomeLocal = lid => todosLocais.find(l => l.id === lid)?.nome || "local";

  box.querySelectorAll("[data-novo-local]").forEach(b => b.onclick = () =>
    abrirEditor("locais", null, { valoresIniciais: { setor_id: b.dataset.novoLocal }, aoSalvar: recarregar }));
  box.querySelectorAll("[data-ed-setor]").forEach(b => b.onclick = () =>
    abrirEditor("setores", b.dataset.edSetor, { aoSalvar: recarregar }));
  box.querySelectorAll("[data-ed-local]").forEach(b => b.onclick = () =>
    abrirEditor("locais", b.dataset.edLocal, { aoSalvar: recarregar }));
  box.querySelectorAll("[data-ex-setor]").forEach(b => b.onclick = () =>
    apagar("setores", b.dataset.exSetor, `o setor ${nomeSetor(b.dataset.exSetor)}`, recarregar));
  box.querySelectorAll("[data-ex-local]").forEach(b => b.onclick = () =>
    apagar("locais", b.dataset.exLocal, `o local ${nomeLocal(b.dataset.exLocal)}`, recarregar));
}
