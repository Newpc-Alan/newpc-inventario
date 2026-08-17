/* Bootstrap: login, layout, busca global, scanner global, alertas e roteamento. */
import { iniciarAuth, entrar, sair, recuperarSenha, sessao, pode, ehTecnico, perfilLabel, MSG_AUTH } from "./auth.js";
import { registrar, despachar, montarMenu, irPara, parseHash } from "./router.js";
import { preAquecerReferencias, buscar, contar, listaRef, criar, obter, parametros } from "./store.js";
import { ico, esc, iniciais, toast, modal, badgeStatusAtivo, rotuloColuna, dataBR } from "./ui.js";
import { rotuloDeId } from "./store.js";
import { abrirScanner } from "./views/scanner.js";
import { APP } from "./config.js";

const $ = s => document.querySelector(s);
const conteudo = $("#conteudo");

/* ---------------- registro das rotas ---------------- */
const modulos = {
  home:          () => import("./views/home.js"),
  dashboard:     () => import("./views/dashboard.js"),
  inventario:    () => import("./views/inventario.js"),
  ativos:        () => import("./views/ativos.js"),
  clientes:      () => import("./views/cadastros.js"),
  unidades:      () => import("./views/cadastros.js"),
  municipios:    () => import("./views/cadastros.js"),
  fornecedores:  () => import("./views/cadastros.js"),
  contratos:     () => import("./views/contratos.js"),
  locacoes:      () => import("./views/contratos.js"),
  movimentacoes: () => import("./views/movimentacoes.js"),
  recolhimentos: () => import("./views/movimentacoes.js"),
  pendencias:    () => import("./views/pendencias.js"),
  manutencao:    () => import("./views/pendencias.js"),
  relatorios:    () => import("./views/relatorios.js"),
  importacao:    () => import("./views/importacao.js"),
  usuarios:      () => import("./views/admin.js"),
  configuracoes: () => import("./views/admin.js")
};
for (const [rota, carregar] of Object.entries(modulos)) {
  registrar(rota, async (alvo, ctx) => {
    const m = await carregar();
    const fn = m[rota] || m.render;
    if (!fn) throw new Error(`Módulo da rota "${rota}" não expõe função.`);
    await fn(alvo, ctx);
  });
}

/* ---------------- login ---------------- */
$("#form-login").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#li-btn"), err = $("#li-erro");
  err.classList.add("oculto");
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
  try {
    await entrar($("#li-email").value, $("#li-senha").value);
  } catch (ex) {
    err.textContent = MSG_AUTH[ex.code] || "Não foi possível entrar. Verifique os dados e tente novamente.";
    err.classList.remove("oculto");
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

$("#li-esqueci").addEventListener("click", async () => {
  const email = $("#li-email").value.trim();
  if (!email) return toast("Informe seu e-mail primeiro.", "warn");
  try { await recuperarSenha(email); toast("Enviamos um link de redefinição para seu e-mail.", "ok"); }
  catch { toast("Não foi possível enviar o e-mail de redefinição.", "err"); }
});

/* ---------------- ciclo de autenticação ---------------- */
iniciarAuth(async u => {
  if (!u) return mostrarLogin();
  if (u.erro === "INATIVO") { mostrarLogin("Seu usuário está desativado. Procure o administrador."); return; }
  if (u.erro === "SEM_CADASTRO") return telaPrimeiroAcesso(u);
  await iniciarApp();
});

function mostrarLogin(msg) {
  $("#app").classList.remove("ativo");
  $("#tela-login").style.display = "grid";
  const b = $("#li-btn"); b.disabled = false; b.textContent = "Entrar";
  $("#li-senha").value = "";
  if (msg) { const e = $("#li-erro"); e.textContent = msg; e.classList.remove("oculto"); }
}

/* Primeiro acesso: autenticou no Firebase mas não existe documento em /usuarios.
   Se a base estiver vazia, este usuário vira o ADMINISTRADOR inicial. */
async function telaPrimeiroAcesso(info) {
  $("#tela-login").style.display = "grid";
  const caixa = document.querySelector(".login-caixa");
  let baseVazia = false;
  try { baseVazia = (await contar("usuarios")) === 0; } catch { baseVazia = false; }

  if (!baseVazia) {
    caixa.innerHTML = `<div class="aviso warn"><div><b>Acesso ainda não liberado</b>
      Sua conta (${esc(info.email)}) autenticou, mas não possui cadastro no sistema.
      Solicite ao administrador que cadastre seu usuário em <b>Usuários</b>.</div></div>
      <button class="btn bloco" style="margin-top:14px" id="pa-sair">Sair</button>`;
    $("#pa-sair").onclick = () => sair();
    return;
  }

  caixa.innerHTML = `
    <div class="login-marca"><h1>PRIMEIRA CONFIGURAÇÃO</h1>
      <p>Nenhum usuário cadastrado. Você será o administrador inicial.</p></div>
    <div class="campo" style="margin-bottom:12px"><label>Seu nome completo</label>
      <input class="inp" id="pa-nome" placeholder="Nome e sobrenome"></div>
    <div class="campo" style="margin-bottom:12px"><label>Cargo</label>
      <input class="inp" id="pa-cargo" placeholder="Ex.: Diretor de Tecnologia"></div>
    <div class="campo" style="margin-bottom:16px"><label>Telefone</label>
      <input class="inp" id="pa-tel" placeholder="(67) 99999-9999"></div>
    <div class="aviso info" style="margin-bottom:14px"><div>
      A base será criada <b>vazia</b>. Serão gravadas apenas as categorias padrão de equipamentos,
      que você pode editar em Configurações.</div></div>
    <button class="btn p bloco lg" id="pa-ok">Criar administrador e entrar</button>
    <button class="btn bloco" id="pa-sair" style="margin-top:8px;border:0;background:transparent">Sair</button>`;

  $("#pa-sair").onclick = () => sair();
  $("#pa-ok").onclick = async () => {
    const nome = $("#pa-nome").value.trim();
    if (!nome) return toast("Informe seu nome.", "warn");
    const btn = $("#pa-ok"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
    try {
      const { setDoc, doc, db, serverTimestamp } = await import("./firebase.js");
      await setDoc(doc(db, "usuarios", info.uid), {
        nome, email: info.email, cargo: $("#pa-cargo").value.trim() || null,
        telefone: $("#pa-tel").value.trim() || null, perfil: "ADMINISTRADOR", ativo: true,
        criado_em: serverTimestamp(), atualizado_em: serverTimestamp()
      });
      const { CATEGORIAS_PADRAO } = await import("./config.js");
      const { lote } = await import("./store.js");
      await lote(CATEGORIAS_PADRAO.map(n => ({ colecao: "categorias", dados: { nome: n, ativo: true } })));
      location.reload();
    } catch (e) {
      console.error(e);
      toast("Falha ao criar o administrador. Verifique as regras do Firestore.", "err");
      btn.disabled = false; btn.textContent = "Criar administrador e entrar";
    }
  };
}

/* ---------------- app ---------------- */
let appIniciado = false;
async function iniciarApp() {
  $("#tela-login").style.display = "none";
  $("#app").classList.add("ativo");
  $("#user-nome").textContent = sessao.usuario.nome;
  $("#user-perfil").textContent = perfilLabel();
  $("#user-ini").textContent = iniciais(sessao.usuario.nome);

  if (!appIniciado) {
    appIniciado = true;
    await preAquecerReferencias();
    montarMenu($("#lateral"), {});
    ligarEventos();
    atualizarAlertas();
    setInterval(atualizarAlertas, 180000);
  }
  if (!location.hash) location.hash = "#/home";
  await despachar(conteudo);
}

function ligarEventos() {
  window.addEventListener("hashchange", () => { fecharLateral(); despachar(conteudo); });

  $("#btn-menu").onclick = () => {
    $("#lateral").classList.toggle("on");
    $("#velo").classList.toggle("on");
  };
  $("#velo").onclick = fecharLateral;

  $("#btn-scan").onclick = () => abrirScanner({
    aoLer: cod => irPara("ativos", "qr:" + cod),
    titulo: "Escanear equipamento"
  });

  $("#btn-alertas").onclick = () => irPara("pendencias");

  $("#btn-user").onclick = () => modal({
    titulo: sessao.usuario.nome, tamanho: "p",
    corpo: `<div class="dado"><div class="r">E-mail</div><div class="v">${esc(sessao.usuario.email)}</div></div>
      <div class="dado"><div class="r">Perfil</div><div class="v">${esc(perfilLabel())}</div></div>
      <div class="dado"><div class="r">Cargo</div><div class="v">${esc(sessao.usuario.cargo || "—")}</div></div>
      <div class="dado"><div class="r">Versão</div><div class="v">${APP.versao}</div></div>`,
    acoes: [
      { texto: "Fechar" },
      { texto: "Sair", classe: "d", icone: "logout", aoClicar: () => sair() }
    ]
  });

  ligarBuscaGlobal();
}

function fecharLateral() {
  $("#lateral").classList.remove("on");
  $("#velo").classList.remove("on");
}

/* ---------------- busca global (item 37) ---------------- */
function ligarBuscaGlobal() {
  const inp = $("#inp-busca"), box = $("#busca-res");
  let timer, ultimo = "";

  const fechar = () => box.classList.add("oculto");
  document.addEventListener("click", e => { if (!e.target.closest("#busca-global")) fechar(); });

  inp.addEventListener("input", () => {
    clearTimeout(timer);
    const t = inp.value.trim();
    if (t.length < 2) return fechar();
    timer = setTimeout(() => executar(t), 260);
  });
  inp.addEventListener("focus", () => { if (inp.value.trim().length >= 2) box.classList.remove("oculto"); });

  async function executar(termo) {
    if (termo === ultimo && !box.classList.contains("oculto")) return;
    ultimo = termo;
    box.classList.remove("oculto");
    box.innerHTML = `<div class="vazio" style="padding:18px"><span class="spin"></span></div>`;

    /* Firestore não faz LIKE. Usamos prefix match (>= termo, <= termo+) nos campos indexados
       e complementamos com filtro em memória sobre as referências já em cache. */
    const campos = ["patrimonio_newpc", "numero_serie", "service_tag", "patrimonio_fornecedor"];
    const alvo = termo.toUpperCase();
    const vistos = new Set(); const achados = [];

    await Promise.all(campos.map(async campo => {
      try {
        const { dados } = await buscar("ativos", [[campo, ">=", alvo], [campo, "<=", alvo + ""]], [campo], 6);
        dados.forEach(a => { if (!vistos.has(a.id)) { vistos.add(a.id); achados.push(a); } });
      } catch { /* índice ausente para o campo — ignora silenciosamente */ }
    }));

    if (achados.length < 6) {
      try {
        const { dados } = await buscar("ativos", [["modelo", ">=", termo], ["modelo", "<=", termo + ""]], ["modelo"], 6);
        dados.forEach(a => { if (!vistos.has(a.id)) { vistos.add(a.id); achados.push(a); } });
      } catch {}
    }

    /* referências (clientes/unidades) filtradas em memória */
    const refs = [];
    for (const col of ["clientes", "unidades"]) {
      const lista = await listaRef(col);
      lista.filter(x => (x.nome || x.razao_social || "").toLowerCase().includes(termo.toLowerCase()))
        .slice(0, 3).forEach(x => refs.push({ col, x }));
    }

    if (!achados.length && !refs.length) {
      box.innerHTML = `<div class="vazio">Nada encontrado para "<b>${esc(termo)}</b>".</div>`;
      return;
    }
    box.innerHTML =
      achados.slice(0, 8).map(a => `<div class="item" data-ativo="${a.id}">
        <div><b>${esc(a.patrimonio_newpc)}</b> <small>${esc(a.fabricante || "")} ${esc(a.modelo || "")}</small>
          <br><small>${esc(rotuloDeId("clientes", a.cliente_id))} · ${esc(rotuloDeId("unidades", a.unidade_id))}</small></div>
        <div>${badgeStatusAtivo(a.status)}</div></div>`).join("") +
      refs.map(r => `<div class="item" data-ref="${r.col}/${r.x.id}">
        <div><b>${esc(r.x.nome || r.x.razao_social)}</b><br><small>${r.col === "clientes" ? "Cliente" : "Unidade"}</small></div>
        <div>${ico("arrows", 15)}</div></div>`).join("");

    box.querySelectorAll("[data-ativo]").forEach(el => el.onclick = () => {
      fechar(); inp.value = ""; irPara("ativos", el.dataset.ativo);
    });
    box.querySelectorAll("[data-ref]").forEach(el => el.onclick = () => {
      const [col, id] = el.dataset.ref.split("/");
      fechar(); inp.value = ""; irPara(col, id);
    });
  }
}

/* ---------------- alertas (item 49) ---------------- */
async function atualizarAlertas() {
  if (!pode("pendencia.ver")) return;
  try {
    const n = await contar("pendencias", [["status", "in", ["ABERTA", "EM_ANALISE"]]]);
    const b = $("#badge-alertas");
    b.textContent = n > 99 ? "99+" : n;
    b.classList.toggle("oculto", n === 0);
    montarMenu($("#lateral"), { pendencias: n });
    const { rota } = parseHash();
    document.querySelectorAll(".nav-item").forEach(x => x.classList.toggle("on", x.dataset.rota === rota));
  } catch (e) { /* sem permissão ou índice */ }
}
window.NEWPC_atualizarAlertas = atualizarAlertas;
