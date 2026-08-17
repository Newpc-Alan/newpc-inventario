/* NEWPC INVENTÁRIO — Administração: usuários, parâmetros, categorias, auditoria e integridade.
 * Auditoria (item 44) é somente leitura: o sistema nunca edita nem apaga esses registros.
 */
import { SCHEMA } from "../schema.js";
import { paginaLista, abrirEditor } from "./lista.js";
import {
  buscar, contar, criar, listaRef, parametros, salvarParametros, rotuloDeId, limparCache
} from "../store.js";
import {
  ico, esc, toast, modal, confirmar, cabecalhoPagina, carregando, vazio,
  kpi, baixarCSV, dataBR, num
} from "../ui.js";
import { sessao, pode, recuperarSenha } from "../auth.js";
import * as C from "../config.js";

/* ============================================================
 * Tradução das permissões para linguagem de gente
 * ============================================================ */
const TRADUCAO_PERMISSAO = {
  "*": "Acesso total ao sistema, inclusive configurações e usuários",
  "dashboard.ver": "Ver o painel gerencial",
  "dashboard.tecnico": "Ver o painel de campo do técnico",
  "ativo.ver": "Consultar equipamentos",
  "ativo.criar": "Cadastrar equipamentos",
  "ativo.editar": "Editar equipamentos",
  "cliente.ver": "Consultar clientes",
  "cliente.criar": "Cadastrar clientes",
  "cliente.editar": "Editar clientes",
  "unidade.ver": "Consultar unidades",
  "unidade.criar": "Cadastrar unidades",
  "unidade.editar": "Editar unidades",
  "fornecedor.ver": "Consultar fornecedores",
  "fornecedor.editar": "Editar fornecedores",
  "contrato.ver": "Consultar contratos",
  "contrato.editar": "Editar contratos",
  "contrato.ver_financeiro": "Ver valores financeiros dos contratos",
  "inventario.ver": "Consultar inventários",
  "inventario.executar": "Executar inventário em campo",
  "inventario.validar": "Validar e encerrar inventários",
  "movimentacao.ver": "Consultar movimentações",
  "movimentacao.criar": "Registrar movimentações",
  "movimentacao.aprovar": "Aprovar movimentações",
  "recolhimento.ver": "Consultar recolhimentos",
  "recolhimento.criar": "Abrir recolhimentos",
  "recolhimento.aprovar": "Aprovar recolhimentos",
  "pendencia.ver": "Consultar pendências",
  "pendencia.resolver": "Resolver pendências",
  "manutencao.ver": "Consultar manutenções",
  "manutencao.editar": "Registrar e alterar manutenções",
  "relatorio.ver": "Ver relatórios",
  "relatorio.exportar": "Exportar relatórios",
  "importacao.executar": "Importar planilhas",
  "auditoria.ver": "Consultar a trilha de auditoria",
  "usuario.ver": "Consultar usuários",
  "usuario.editar": "Cadastrar e editar usuários",
  "config.editar": "Alterar configurações do sistema",
  "aventis.ver": "Ver o painel da operação Aventis"
};
const traduzir = p => TRADUCAO_PERMISSAO[p] || p;

/* ============================================================
 * USUÁRIOS
 * ============================================================ */
export async function usuarios(alvo, ctx) {
  if (!pode("usuario.ver") && !pode("*")) {
    alvo.innerHTML = cabecalhoPagina("Usuários") +
      `<div class="aviso warn"><div><b>Somente administradores gerenciam usuários.</b></div></div>`;
    return;
  }

  alvo.innerHTML = `
    <div class="aviso info" style="margin-bottom:14px"><div>
      <b>Como funciona o acesso ao sistema</b>
      Cadastrar a pessoa aqui define <b>o que ela pode fazer</b>. Para conseguir entrar, ela também
      precisa existir no <b>Firebase Authentication</b> com o mesmo e-mail. O ideal é que o documento
      do usuário tenha como identificador o UID do Firebase Authentication — quando isso não acontece,
      o sistema faz a vinculação sozinho no primeiro login, pelo e-mail.
    </div></div>
    <div id="usr-lista"></div>
    <div id="usr-perfis" style="margin-top:22px"></div>`;

  /* --- card de perfis e permissões --- */
  const perfis = alvo.querySelector("#usr-perfis");
  perfis.innerHTML = `<div class="card">
    <div class="card-tit">${ico("shield", 18)}<h3>Perfis e permissões</h3></div>
    <div class="card-pad">
      <p style="font-size:13px;color:var(--texto-2);margin-bottom:13px">
        Estes são os quatro perfis do sistema e o que cada um pode fazer. Os botões da tela seguem esta
        lista, e as mesmas regras estão gravadas no banco — ninguém contorna pelo navegador.</p>
      <div class="grade g2">
        ${Object.keys(C.PERFIS).map(p => {
          const lista = C.PERMISSOES[p] || [];
          return `<div class="card card-pad" style="box-shadow:none">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span class="st st-azul">${esc(C.PERFIL_LABEL[p])}</span>
              <span style="font-size:11.5px;color:var(--texto-2)">
                ${lista.includes("*") ? "todas as permissões" : `${lista.length} permissões`}</span>
            </div>
            <ul style="list-style:none;display:flex;flex-direction:column;gap:5px">
              ${lista.map(x => `<li style="font-size:12.8px;display:flex;gap:7px;align-items:flex-start">
                <span style="color:var(--verde);flex:0 0 auto;margin-top:2px">${ico("check", 13)}</span>
                <span>${esc(traduzir(x))}</span></li>`).join("")}
            </ul></div>`;
        }).join("")}
      </div>
    </div></div>`;

  /* --- listagem --- */
  await paginaLista(alvo.querySelector("#usr-lista"), "usuarios", {
    titulo: "Usuários",
    subtitulo: "Quem acessa o sistema e com qual nível de permissão.",
    filtrosUI: ["perfil"],
    ordem: ["nome", "asc"],
    aoClicarLinha: d => fichaUsuario(d)
  });

  function fichaUsuario(d) {
    const podeEditar = pode("usuario.editar") || pode("*");
    const m = modal({
      titulo: d.nome || "Usuário",
      tamanho: "p",
      corpo: `
        <div class="dado"><div class="r">E-mail</div><div class="v">${esc(d.email || "—")}</div></div>
        <div class="dado"><div class="r">Perfil</div><div class="v">
          <span class="st st-azul">${esc(C.PERFIL_LABEL[d.perfil] || d.perfil || "—")}</span></div></div>
        <div class="dado"><div class="r">Cargo</div><div class="v">${esc(d.cargo || "—")}</div></div>
        <div class="dado"><div class="r">Telefone</div><div class="v">${esc(d.telefone || "—")}</div></div>
        <div class="dado"><div class="r">Último acesso</div><div class="v">${dataBR(d.ultimo_acesso, true)}</div></div>
        <div class="dado"><div class="r">Situação</div><div class="v">
          ${d.ativo === false ? '<span class="st st-cinza">Inativo</span>' : '<span class="st st-verde">Ativo</span>'}</div></div>
        <div class="dado"><div class="r">Identificador do documento</div>
          <div class="v"><span class="mono">${esc(d.id)}</span></div></div>`,
      acoes: [
        { texto: "Fechar" },
        ...(podeEditar ? [{
          texto: "Enviar redefinição de senha", icone: "bell", aoClicar: async () => {
            if (!d.email) { toast("Este usuário não tem e-mail cadastrado.", "warn"); return false; }
            try {
              await recuperarSenha(d.email);
              toast(`Enviamos um link de redefinição para ${d.email}.`, "ok");
            } catch (e) {
              console.error(e);
              toast("Não foi possível enviar o e-mail. Confira se este endereço existe no Firebase Authentication.", "err");
              return false;
            }
          }
        }, {
          texto: "Editar", classe: "p", icone: "edit", aoClicar: () => {
            m.fechar();
            abrirEditor("usuarios", d.id, { aoSalvar: () => usuarios(alvo, ctx) });
          }
        }] : [])
      ]
    });
  }
}

/* ============================================================
 * CONFIGURAÇÕES
 * ============================================================ */
export async function configuracoes(alvo, ctx) {
  if (!pode("config.editar") && !pode("*")) {
    alvo.innerHTML = cabecalhoPagina("Configurações") +
      `<div class="aviso warn"><div><b>Área restrita</b>
      Só quem tem permissão para alterar configurações pode abrir esta tela.</div></div>`;
    return;
  }

  const ABAS = [
    { id: "parametros", l: "Parâmetros" },
    { id: "categorias", l: "Categorias" },
    { id: "auditoria", l: "Auditoria" },
    { id: "sistema", l: "Sistema" }
  ];
  const inicial = ABAS.some(a => a.id === ctx?.sub) ? ctx.sub : (ABAS.some(a => a.id === ctx?.id) ? ctx.id : "parametros");

  alvo.innerHTML = cabecalhoPagina("Configurações", "Ajustes do sistema, categorias, trilha de auditoria e verificação de integridade.")
    + `<div class="abas">${ABAS.map(a =>
        `<div class="aba ${a.id === inicial ? "on" : ""}" data-aba="${a.id}">${esc(a.l)}</div>`).join("")}</div>
       <div id="cfg-corpo"></div>`;

  const corpo = alvo.querySelector("#cfg-corpo");
  alvo.querySelectorAll("[data-aba]").forEach(t => t.onclick = () => {
    alvo.querySelectorAll("[data-aba]").forEach(x => x.classList.toggle("on", x === t));
    abrirAba(t.dataset.aba);
  });

  function abrirAba(id) {
    if (id === "parametros") abaParametros(corpo);
    else if (id === "categorias") abaCategorias(corpo);
    else if (id === "auditoria") abaAuditoria(corpo);
    else abaSistema(corpo);
  }
  abrirAba(inicial);
}

/* ------------------------------------------------------------
 * Aba: Parâmetros
 * ------------------------------------------------------------ */
const CAMPOS_PARAMETRO = [
  { n: "diasInventarioVencido", l: "Dias para considerar o inventário vencido", t: "int",
    hint: "Depois desse tempo sem conferência, o equipamento aparece como pendente de inventário." },
  { n: "diasAlertaContrato", l: "Dias de antecedência para alertar sobre contratos", t: "int",
    hint: "Contratos que vencem dentro desse prazo aparecem como próximos do vencimento." },
  { n: "exigirAprovacaoDivergencia", l: "Exigir aprovação quando o técnico apontar divergência", t: "bool",
    hint: "Ligado: o técnico registra a divergência, mas a localização só muda depois que alguém aprova." },
  { n: "exigirGPS", l: "Exigir localização (GPS) no inventário de campo", t: "bool",
    hint: "Ligado: o aplicativo pede a posição do celular ao registrar a conferência." },
  { n: "qualidadeFoto", l: "Qualidade das fotos enviadas (de 0,3 a 1,0)", t: "number", passo: "0.01",
    hint: "Quanto menor, mais leve a foto e mais rápido o envio em rede fraca. 0,72 costuma ser suficiente." },
  { n: "larguraMaxFoto", l: "Largura máxima da foto (pixels)", t: "int",
    hint: "As fotos são reduzidas até essa largura antes de subir, para economizar dados." },
  { n: "paginaTamanho", l: "Registros por página nas listagens", t: "int",
    hint: "Quantidade de linhas carregadas por vez nas telas de listagem." }
];

async function abaParametros(corpo) {
  corpo.innerHTML = carregando();
  const p = await parametros();

  corpo.innerHTML = `<div class="card">
    <div class="card-tit">${ico("gear", 18)}<h3>Parâmetros operacionais</h3></div>
    <div class="card-pad">
      <p style="font-size:13px;color:var(--texto-2);margin-bottom:15px">
        Estes ajustes valem para todo o sistema e passam a fazer efeito assim que você salvar.</p>
      <div class="form-grade" id="cfg-form">
        ${CAMPOS_PARAMETRO.map(c => c.t === "bool"
          ? `<div class="campo w2"><label class="check">
              <input type="checkbox" data-p="${c.n}" ${p[c.n] ? "checked" : ""}><span>${esc(c.l)}</span></label>
              <span class="hint">${esc(c.hint)}</span></div>`
          : `<div class="campo"><label>${esc(c.l)}</label>
              <input class="inp" type="number" ${c.passo ? `step="${c.passo}"` : 'step="1"'}
                data-p="${c.n}" value="${esc(p[c.n] ?? "")}">
              <span class="hint">${esc(c.hint)}</span></div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
        <button class="btn p" id="cfg-salvar">${ico("check", 15)}Salvar parâmetros</button>
        <button class="btn" id="cfg-padrao">Restaurar valores padrão</button>
      </div>
    </div></div>`;

  corpo.querySelector("#cfg-salvar").onclick = async () => {
    const novo = {};
    let invalido = null;
    CAMPOS_PARAMETRO.forEach(c => {
      const el = corpo.querySelector(`[data-p="${c.n}"]`);
      if (c.t === "bool") { novo[c.n] = el.checked; return; }
      const v = Number(el.value);
      if (el.value === "" || isNaN(v) || v <= 0) invalido = invalido || c.l;
      else novo[c.n] = v;
    });
    if (invalido) return toast(`Informe um número válido em “${invalido}”.`, "warn");
    if (novo.qualidadeFoto > 1 || novo.qualidadeFoto < 0.3)
      return toast("A qualidade da foto deve ficar entre 0,3 e 1,0.", "warn");
    await salvarParametros(novo);
    toast("Parâmetros salvos.", "ok");
  };

  corpo.querySelector("#cfg-padrao").onclick = async () => {
    if (!await confirmar("Restaurar valores padrão?",
      "Os parâmetros voltam à configuração de fábrica. Você ainda precisa clicar em Salvar.", "Restaurar")) return;
    CAMPOS_PARAMETRO.forEach(c => {
      const el = corpo.querySelector(`[data-p="${c.n}"]`);
      if (c.t === "bool") el.checked = !!C.PARAMETROS_PADRAO[c.n];
      else el.value = C.PARAMETROS_PADRAO[c.n];
    });
    toast("Valores padrão carregados no formulário. Clique em Salvar para confirmar.", "info");
  };
}

/* ------------------------------------------------------------
 * Aba: Categorias
 * ------------------------------------------------------------ */
async function abaCategorias(corpo) {
  corpo.innerHTML = `
    <div class="aviso info" style="margin-bottom:14px"><div>
      Categorias organizam o parque de equipamentos e aparecem em todos os filtros e relatórios.
      Uma categoria em uso por algum equipamento não pode ser excluída — nesse caso, inative-a.</div></div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn" id="cat-padrao">${ico("plus", 15)}Restaurar categorias padrão</button>
    </div>
    <div id="cat-lista"></div>`;

  const alvoLista = corpo.querySelector("#cat-lista");
  const desenhar = () => paginaLista(alvoLista, "categorias", {
    titulo: "Categorias de equipamento",
    subtitulo: "Tipos de equipamento aceitos no cadastro de ativos.",
    ordem: ["nome", "asc"]
  });
  await desenhar();

  corpo.querySelector("#cat-padrao").onclick = async () => {
    const existentes = await listaRef("categorias");
    const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const jaTem = new Set(existentes.map(c => norm(c.nome)));
    const faltando = C.CATEGORIAS_PADRAO.filter(n => !jaTem.has(norm(n)));

    if (!faltando.length) return toast("Todas as categorias padrão já estão cadastradas.", "info");
    if (!await confirmar("Restaurar categorias padrão?",
      `Serão criadas <b>${faltando.length}</b> categoria(s) que ainda não existem:
       ${esc(faltando.join(", "))}. Nada é duplicado e nada existente é alterado.`, "Criar")) return;

    let n = 0;
    for (const nome of faltando) {
      await criar("categorias", { nome, ativo: true }, { ignorarDuplicidade: true });
      n++;
    }
    limparCache("categorias");
    toast(`${n} categoria(s) criada(s).`, "ok");
    await desenhar();
  };
}

/* ------------------------------------------------------------
 * Aba: Auditoria (item 44)
 * ------------------------------------------------------------ */
const ENTIDADES_AUDITAVEIS = [
  ...Object.keys(SCHEMA).map(k => ({ v: k, label: SCHEMA[k].plural })),
  { v: "parametros", label: "Parâmetros do sistema" }
];
const OPERACOES = [
  { v: "CREATE", label: "Criação", cor: "verde" },
  { v: "UPDATE", label: "Alteração", cor: "azul" },
  { v: "DELETE", label: "Exclusão", cor: "vermelho" }
];

async function abaAuditoria(corpo) {
  const p = await parametros();
  const tam = p.paginaTamanho || 25;
  const estado = { pagina: 0, cursores: [null], entidade: "", operacao: "", de: "", ate: "" };

  corpo.innerHTML = `
    <div class="aviso info" style="margin-bottom:14px"><div>
      <b>Trilha de auditoria</b>
      Cada criação, alteração e exclusão fica registrada aqui com autor, data e o valor de antes e depois.
      Este registro é somente leitura: o sistema não permite editar nem apagar nenhuma linha desta lista.</div></div>

    <div class="filtros"><div class="linha">
      <select class="inp" data-a="entidade"><option value="">Entidade: todas</option>
        ${ENTIDADES_AUDITAVEIS.map(e => `<option value="${esc(e.v)}">${esc(e.label)}</option>`).join("")}</select>
      <select class="inp" data-a="operacao"><option value="">Operação: todas</option>
        ${OPERACOES.map(o => `<option value="${o.v}">${o.label}</option>`).join("")}</select>
      <div class="campo"><label>De</label><input class="inp" type="date" data-a="de"></div>
      <div class="campo"><label>Até</label><input class="inp" type="date" data-a="ate"></div>
    </div>
    <div class="pe"><span class="cont" id="aud-cont"></span>
      <button class="btn sm" id="aud-csv">${ico("down", 14)}Exportar CSV</button>
      <button class="btn sm" id="aud-limpar">Limpar filtros</button></div></div>

    <div id="aud-corpo"></div>`;

  corpo.querySelectorAll("[data-a]").forEach(el => el.onchange = () => {
    estado[el.dataset.a] = el.value;
    estado.pagina = 0; estado.cursores = [null];
    carregar();
  });
  corpo.querySelector("#aud-limpar").onclick = () => {
    corpo.querySelectorAll("[data-a]").forEach(el => el.value = "");
    Object.assign(estado, { entidade: "", operacao: "", de: "", ate: "", pagina: 0, cursores: [null] });
    carregar();
  };
  corpo.querySelector("#aud-csv").onclick = exportar;

  function filtros() {
    const f = [];
    if (estado.entidade) f.push(["entidade", "==", estado.entidade]);
    if (estado.operacao) f.push(["operacao", "==", estado.operacao]);
    return f;
  }

  /* Período é aplicado em memória para não exigir índice composto no banco. */
  function noPeriodo(d) {
    if (!estado.de && !estado.ate) return true;
    const dt = d.criado_em?.toDate ? d.criado_em.toDate() : (d.criado_em ? new Date(d.criado_em) : null);
    if (!dt || isNaN(dt)) return false;
    if (estado.de && dt < new Date(estado.de + "T00:00:00")) return false;
    if (estado.ate && dt > new Date(estado.ate + "T23:59:59")) return false;
    return true;
  }

  const rotuloEntidade = e => SCHEMA[e]?.plural || (e === "parametros" ? "Parâmetros do sistema" : e);
  const rotuloCampo = (entidade, campo) =>
    SCHEMA[entidade]?.campos.find(c => c.n === campo)?.l || campo.replace(/_/g, " ");

  const REF_CAMPO = {
    fornecedor_id: "fornecedores", cliente_id: "clientes", municipio_id: "municipios",
    unidade_id: "unidades", setor_id: "setores", local_id: "locais", categoria: "categorias",
    contrato_fornecedor_id: "contratos_fornecedor", contrato_cliente_id: "contratos_cliente"
  };
  function valorLegivel(campo, v) {
    if (v === null || v === undefined || v === "") return "vazio";
    if (v === true) return "sim";
    if (v === false) return "não";
    if (REF_CAMPO[campo]) return rotuloDeId(REF_CAMPO[campo], v);
    if (campo === "status") return C.labelDe(C.STATUS_ATIVO, v);
    if (campo === "origem_ativo") return C.labelDe(C.ORIGEM_ATIVO, v);
    if (campo === "condicao") return C.labelDe(C.CONDICAO_ATIVO, v);
    if (campo === "perfil") return C.PERFIL_LABEL[v] || v;
    if (v?.toDate) return dataBR(v, true);
    return String(v);
  }

  async function carregar() {
    const caixa = corpo.querySelector("#aud-corpo");
    caixa.innerHTML = carregando("Buscando registros de auditoria…");
    let res;
    try {
      res = await buscar("auditoria", filtros(), ["criado_em", "desc"], tam, estado.cursores[estado.pagina]);
    } catch (e) {
      console.error(e);
      caixa.innerHTML = `<div class="aviso err"><div><b>Consulta bloqueada</b>
        ${/index/i.test(e.message)
          ? "Esta combinação de filtros precisa de um índice no banco. Abra o console do navegador e clique no link que o Firebase gerou para criá-lo."
          : esc(e.message)}</div></div>`;
      return;
    }
    const { ultimo, fim } = res;
    const dados = res.dados.filter(noPeriodo);

    const cont = corpo.querySelector("#aud-cont");
    try { cont.textContent = `${num(await contar("auditoria", filtros()))} registro(s) no filtro`; }
    catch { cont.textContent = `${dados.length} nesta página`; }

    if (!dados.length) {
      caixa.innerHTML = vazio("Nenhum registro de auditoria",
        estado.pagina ? "Não há mais registros nas próximas páginas." : "Ajuste os filtros ou o período escolhido.");
      return;
    }

    caixa.innerHTML = `
      <div class="tab-wrap"><table class="tab"><thead><tr>
        <th style="width:34px"></th><th>Data e hora</th><th>Usuário</th><th>Perfil</th>
        <th>Entidade</th><th>Registro</th><th>Operação</th></tr></thead><tbody>
        ${dados.map((d, i) => {
          const op = OPERACOES.find(o => o.v === d.operacao);
          const temMudancas = (d.mudancas || []).length > 0;
          return `<tr class="${temMudancas ? "click" : ""}" data-exp="${i}">
              <td>${temMudancas ? ico("down", 14) : ""}</td>
              <td>${dataBR(d.criado_em, true)}</td>
              <td>${esc(d.usuario_nome || "sistema")}</td>
              <td>${d.usuario_perfil ? `<span class="st st-azul">${esc(C.PERFIL_LABEL[d.usuario_perfil] || d.usuario_perfil)}</span>` : "—"}</td>
              <td>${esc(rotuloEntidade(d.entidade))}</td>
              <td>${esc(d.registro_rotulo || d.registro_id || "—")}</td>
              <td><span class="st st-${op?.cor || "cinza"}">${esc(op?.label || d.operacao)}</span></td>
            </tr>
            <tr class="oculto" data-det="${i}"><td colspan="7" style="background:var(--cinza-2)">
              ${temMudancas ? `<table class="tab" style="background:transparent"><thead><tr>
                  <th>Campo</th><th>De</th><th>Para</th></tr></thead><tbody>
                  ${d.mudancas.map(m => `<tr>
                    <td><b>${esc(rotuloCampo(d.entidade, m.campo))}</b></td>
                    <td style="color:var(--texto-2)">${esc(valorLegivel(m.campo, m.de))}</td>
                    <td><b>${esc(valorLegivel(m.campo, m.para))}</b></td></tr>`).join("")}
                </tbody></table>`
                : `<div style="padding:9px 13px;font-size:12.5px;color:var(--texto-2)">Sem detalhamento de campos.</div>`}
            </td></tr>`;
        }).join("")}
      </tbody></table></div>

      <div class="lista-cards">
        ${dados.map(d => `<div class="item-card" style="cursor:default">
          <div class="l1"><b>${esc(rotuloEntidade(d.entidade))}</b>
            <span class="st st-${OPERACOES.find(o => o.v === d.operacao)?.cor || "cinza"}">
              ${esc(OPERACOES.find(o => o.v === d.operacao)?.label || d.operacao)}</span></div>
          <div class="l2">${esc(d.registro_rotulo || d.registro_id || "—")}</div>
          <div class="l3">${dataBR(d.criado_em, true)} · ${esc(d.usuario_nome || "sistema")}</div>
          ${(d.mudancas || []).map(m => `<div class="l3">${esc(rotuloCampo(d.entidade, m.campo))}:
            ${esc(valorLegivel(m.campo, m.de))} &rarr; <b>${esc(valorLegivel(m.campo, m.para))}</b></div>`).join("")}
        </div>`).join("")}
      </div>

      <div class="paginacao"><span>Página ${estado.pagina + 1}</span>
        <button class="btn sm" id="aud-ant" ${estado.pagina === 0 ? "disabled" : ""}>Anterior</button>
        <button class="btn sm" id="aud-prox" ${fim ? "disabled" : ""}>Próxima</button></div>`;

    caixa.querySelectorAll("[data-exp]").forEach(tr => tr.onclick = () => {
      caixa.querySelector(`[data-det="${tr.dataset.exp}"]`)?.classList.toggle("oculto");
    });
    caixa.querySelector("#aud-ant").onclick = () => { estado.pagina--; carregar(); };
    caixa.querySelector("#aud-prox").onclick = () => {
      estado.cursores[estado.pagina + 1] = ultimo; estado.pagina++; carregar();
    };
  }

  async function exportar() {
    toast("Preparando exportação…", "info");
    const { dados } = await buscar("auditoria", filtros(), ["criado_em", "desc"], 3000);
    const linhas = [];
    dados.filter(noPeriodo).forEach(d => {
      const base = [dataBR(d.criado_em, true), d.usuario_nome || "sistema",
        C.PERFIL_LABEL[d.usuario_perfil] || d.usuario_perfil || "",
        rotuloEntidade(d.entidade), d.registro_rotulo || d.registro_id || "",
        OPERACOES.find(o => o.v === d.operacao)?.label || d.operacao];
      if (!(d.mudancas || []).length) linhas.push([...base, "", "", ""]);
      else d.mudancas.forEach(m => linhas.push([...base,
        rotuloCampo(d.entidade, m.campo), valorLegivel(m.campo, m.de), valorLegivel(m.campo, m.para)]));
    });
    baixarCSV("auditoria",
      ["Data e hora", "Usuário", "Perfil", "Entidade", "Registro", "Operação", "Campo", "De", "Para"], linhas);
    toast(`${linhas.length} linha(s) exportada(s).`, "ok");
  }

  carregar();
}

/* ------------------------------------------------------------
 * Aba: Sistema
 * ------------------------------------------------------------ */
const COLECOES_CONTAGEM = [
  "ativos", "clientes", "unidades", "setores", "locais", "municipios",
  "fornecedores", "contratos_fornecedor", "contratos_cliente", "categorias",
  "inventarios", "movimentacoes", "recolhimentos", "pendencias", "usuarios", "importacoes"
];

async function abaSistema(corpo) {
  corpo.innerHTML = `
    <div class="grade g2">
      <div class="card"><div class="card-tit">${ico("gear", 18)}<h3>Sobre esta instalação</h3></div>
        <div class="card-pad">
          <div class="dado"><div class="r">Sistema</div><div class="v">${esc(C.APP.nome)} — ${esc(C.APP.subtitulo)}</div></div>
          <div class="dado"><div class="r">Versão</div><div class="v">${esc(C.APP.versao)}</div></div>
          <div class="dado"><div class="r">Projeto no Firebase</div>
            <div class="v"><span class="mono">${esc(C.FIREBASE_CONFIG.projectId)}</span></div></div>
          <div class="dado"><div class="r">Você está conectado como</div>
            <div class="v">${esc(sessao.usuario?.nome || "—")} ·
              ${esc(C.PERFIL_LABEL[sessao.usuario?.perfil] || "—")}</div></div>
        </div></div>

      <div class="card"><div class="card-tit">${ico("shield", 18)}<h3>Verificação de integridade</h3></div>
        <div class="card-pad">
          <p style="font-size:13px;color:var(--texto-2);margin-bottom:12px">
            Procura contradições no cadastro — equipamento de terceiro sem dono, item em uso sem cliente,
            patrimônio repetido e coisas do tipo. <b>Nada é corrigido automaticamente:</b> apontamos o
            problema e você decide o que fazer.</p>
          <button class="btn p" id="sis-check">${ico("check", 15)}Verificar integridade</button>
        </div></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-tit">${ico("chart", 18)}<h3>Quantidade de registros por coleção</h3></div>
      <div class="card-pad" id="sis-cont">${carregando("Contando registros…")}</div>
    </div>

    <div id="sis-result" style="margin-top:14px"></div>`;

  /* contagens reais, uma por coleção */
  const boxCont = corpo.querySelector("#sis-cont");
  const contagens = [];
  for (const col of COLECOES_CONTAGEM) {
    let n = null;
    try { n = await contar(col); } catch (e) { console.error(col, e); }
    contagens.push({ col, n });
  }
  boxCont.innerHTML = `<div class="grade g4">
    ${contagens.map(c => kpi(SCHEMA[c.col]?.plural || nomeColecao(c.col),
      c.n === null ? "—" : c.n, { cor: c.n === null ? "" : "azul" })).join("")}
  </div>`;

  corpo.querySelector("#sis-check").onclick = () => verificarIntegridade(corpo.querySelector("#sis-result"));
}

function nomeColecao(c) {
  return ({ inventarios: "Inventários", movimentacoes: "Movimentações", recolhimentos: "Recolhimentos",
    pendencias: "Pendências", importacoes: "Importações" })[c] || c;
}

async function verificarIntegridade(caixa) {
  caixa.innerHTML = `<div class="card card-pad">${carregando("Analisando o cadastro…")}</div>`;
  const LIMITE = 5000, PAGINA = 500;
  const problemas = [];
  let truncado = false;

  try {
    /* varredura única dos ativos, com teto de segurança */
    const ativos = [];
    let cursor = null;
    while (ativos.length < LIMITE) {
      const { dados, ultimo, fim } = await buscar("ativos", [], null, PAGINA, cursor);
      ativos.push(...dados);
      if (fim || !ultimo) break;
      cursor = ultimo;
      if (ativos.length >= LIMITE) truncado = true;
    }

    const add = (grupo, item) => {
      let g = problemas.find(p => p.grupo === grupo);
      if (!g) { g = { grupo, itens: [] }; problemas.push(g); }
      g.itens.push(item);
    };

    const vistos = new Map();
    ativos.forEach(a => {
      const rot = a.patrimonio_newpc || a.id;

      if (["LOCADO", "COMODATO"].includes(a.origem_ativo)) {
        const org = C.labelDe(C.ORIGEM_ATIVO, a.origem_ativo);
        if (!a.fornecedor_id)
          add("Equipamento de terceiro sem fornecedor proprietário",
            { rotulo: rot, detalhe: `Origem ${org} sem fornecedor informado.`, href: `#/ativos/${a.id}` });
        if (!a.contrato_fornecedor_id)
          add("Equipamento de terceiro sem contrato de origem",
            { rotulo: rot, detalhe: `Origem ${org} sem contrato/operação informado.`, href: `#/ativos/${a.id}` });
      }
      if (a.status === "EM_USO" && !a.cliente_id)
        add("Equipamento em uso sem cliente",
          { rotulo: rot, detalhe: "Está marcado como Em Uso, mas não há cliente onde ele estaria instalado.",
            href: `#/ativos/${a.id}` });

      if (["DEVOLVIDO_FORNECEDOR", "BAIXADO"].includes(a.status) && a.cliente_id)
        add("Equipamento fora de operação ainda vinculado a cliente",
          { rotulo: rot, detalhe: `Status ${C.labelDe(C.STATUS_ATIVO, a.status)} mas continua ligado a ${rotuloDeId("clientes", a.cliente_id)}.`,
            href: `#/ativos/${a.id}` });

      if (a.patrimonio_newpc) {
        if (vistos.has(a.patrimonio_newpc)) {
          add("Patrimônio duplicado",
            { rotulo: a.patrimonio_newpc,
              detalhe: `Aparece em mais de um cadastro. Outro registro: ${vistos.get(a.patrimonio_newpc)}.`,
              href: `#/ativos/${a.id}` });
        } else vistos.set(a.patrimonio_newpc, a.id);
      }
    });

    /* unidades sem cliente */
    (await listaRef("unidades")).forEach(u => {
      if (!u.cliente_id) add("Unidade sem cliente",
        { rotulo: u.nome || u.id, detalhe: "A unidade não está ligada a nenhum cliente.", href: `#/unidades/${u.id}` });
    });

    caixa.innerHTML = `<div class="card">
      <div class="card-tit">${ico("shield", 18)}<h3>Resultado da verificação</h3>
        <div class="dir"><span style="font-size:12.5px;color:var(--texto-2)">
          ${num(ativos.length)} equipamento(s) analisado(s)</span></div></div>
      <div class="card-pad">
        ${truncado ? `<div class="aviso warn" style="margin-bottom:12px"><div>
          A análise parou nos primeiros ${num(LIMITE)} equipamentos para não sobrecarregar o sistema.
          Pode haver mais problemas além desse ponto.</div></div>` : ""}
        ${!problemas.length
          ? `<div class="aviso ok"><div><b>Nenhum problema encontrado</b>
              O cadastro está coerente nas regras verificadas.</div></div>`
          : `<div class="aviso warn" style="margin-bottom:13px"><div>
              <b>${num(problemas.reduce((s, g) => s + g.itens.length, 0))} ponto(s) de atenção em ${problemas.length} tipo(s) de problema</b>
              Nada foi alterado. Abra cada registro e corrija conforme o caso.</div></div>
             ${problemas.map(g => `<details class="card" style="margin-bottom:9px;box-shadow:none">
              <summary style="padding:11px 14px;cursor:pointer;font-weight:700;color:var(--marinho);font-size:13.5px">
                ${esc(g.grupo)} <span class="st st-laranja" style="margin-left:6px">${num(g.itens.length)}</span></summary>
              <div class="tab-wrap" style="border:0;box-shadow:none;border-top:1px solid var(--borda);border-radius:0">
                <table class="tab"><thead><tr><th>Registro</th><th>O que está errado</th><th></th></tr></thead>
                <tbody>${g.itens.slice(0, 200).map(i => `<tr>
                  <td><span class="mono">${esc(i.rotulo)}</span></td>
                  <td>${esc(i.detalhe)}</td>
                  <td><a class="btn sm" href="${esc(i.href)}">${ico("eye", 13)}Abrir</a></td></tr>`).join("")}
                </tbody></table></div>
              ${g.itens.length > 200 ? `<div style="padding:9px 14px;font-size:12.5px;color:var(--texto-2)">
                Mostrando 200 de ${num(g.itens.length)}.</div>` : ""}
             </details>`).join("")}`}
      </div></div>`;
  } catch (e) {
    console.error(e);
    caixa.innerHTML = `<div class="aviso err"><div><b>Não foi possível concluir a verificação</b>
      ${esc(e.message)}</div></div>`;
  }
}
