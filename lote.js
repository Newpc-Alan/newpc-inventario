/* ENTRADA DE LOTE — recebimento em massa de equipamentos idênticos.
 *
 * O caso real: chega uma carreta com 300 OptiPlex iguais. Cadastrar um a um é
 * inviável. Aqui você descreve o equipamento UMA vez, informa a quantidade, e o
 * sistema reserva a faixa de patrimônio, bipa os seriais e gera as etiquetas.
 *
 * A numeração é atômica: dois almoxarifes dando entrada ao mesmo tempo nunca
 * recebem o mesmo número, porque a faixa é reservada numa transação única.
 */
import {
  criar, atualizar, obter, buscar, lote as gravarLote, listaRef, rotulo, rotuloDeId,
  parametros, reservarFaixaPatrimonio, ultimoPatrimonio, conflitosNaFaixa,
  registrarHistorico, proximoCodigo, serverTimestamp
} from "../store.js";
import {
  ico, esc, toast, modal, confirmar, cabecalhoPagina, vazio, carregando, kpi,
  barraProgresso, num, dataBR, baixarCSV
} from "../ui.js";
import { sessao, pode } from "../auth.js";
import { irPara } from "../router.js";
import { qrSVG } from "./scanner.js";
import * as C from "../config.js";

export async function lotes(alvo, ctx) {
  if (ctx.id === "novo")  return telaNovo(alvo);
  if (ctx.id === "etiquetas") return telaEtiquetas(alvo, ctx.params || {});
  return telaLista(alvo);
}

/* ============================================================
   LISTA DE ENTRADAS
   ============================================================ */
async function telaLista(alvo) {
  const ultimo = await ultimoPatrimonio();
  const p = await parametros();

  alvo.innerHTML = cabecalhoPagina("Entrada de Lote",
    "Recebimento em massa de equipamentos idênticos com geração de patrimônio e etiquetas",
    `${pode("ativo.criar") ? `<button class="btn v lg" id="lt-novo">${ico("plus", 18)}NOVA ENTRADA</button>` : ""}`)
    + `<div class="grade g3" style="margin-bottom:18px">
        ${kpi("Último patrimônio gerado", ultimo < p.patrimonioInicial ? "—" : String(ultimo),
              { cor: "azul", sub: "Sequência NEWPC" })}
        ${kpi("Próximo a ser usado", String(Math.max(ultimo + 1, p.patrimonioInicial)),
              { cor: "verde", sub: "Sugerido na próxima entrada" })}
        ${kpi("Etiqueta configurada", `${p.etiquetaLargura} x ${p.etiquetaAltura} mm`,
              { sub: "Ajustável em Configurações" })}
       </div>
       <div id="lt-corpo">${carregando()}</div>`;

  alvo.querySelector("#lt-novo")?.addEventListener("click", () => irPara("lotes", "novo"));

  const { dados } = await buscar("entradas_lote", [], ["criado_em", "desc"], 30);
  const corpo = alvo.querySelector("#lt-corpo");

  if (!dados.length) {
    corpo.innerHTML = vazio("Nenhuma entrada registrada",
      "Quando chegar um lote de equipamentos, registre aqui: o sistema numera, cria os ativos e gera as etiquetas.");
    return;
  }

  corpo.innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr>
      <th>Código</th><th>Data</th><th>Equipamento</th><th>Faixa de patrimônio</th>
      <th class="num">Qtd.</th><th>Origem</th><th>Responsável</th><th></th>
    </tr></thead><tbody>
    ${dados.map(l => `<tr>
      <td><span class="mono">${esc(l.codigo)}</span></td>
      <td>${dataBR(l.criado_em)}</td>
      <td>${esc([l.fabricante, l.modelo].filter(Boolean).join(" "))}</td>
      <td><span class="mono">${esc(l.patrimonio_inicio)} – ${esc(l.patrimonio_fim)}</span></td>
      <td class="num">${num(l.quantidade)}</td>
      <td>${esc(C.labelDe(C.ORIGEM_ATIVO, l.origem_ativo))}
        ${l.fornecedor_id ? `<br><small style="color:var(--texto-2)">${esc(rotuloDeId("fornecedores", l.fornecedor_id))}</small>` : ""}</td>
      <td>${esc(l.criado_por_nome || "—")}</td>
      <td><div class="acoes">
        <button class="btn sm" data-etq="${l.id}" title="Imprimir etiquetas">${ico("print", 14)}</button>
        <button class="btn sm" data-ver="${l.id}" title="Ver ativos">${ico("eye", 14)}</button>
      </div></td>
    </tr>`).join("")}</tbody></table></div>`;

  corpo.querySelectorAll("[data-etq]").forEach(b => b.onclick = () => irPara("lotes", "etiquetas", { lote: b.dataset.etq }));
  corpo.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => {
    const l = dados.find(x => x.id === b.dataset.ver);
    irPara("ativos", "", { patrimonio_de: l.patrimonio_inicio, patrimonio_ate: l.patrimonio_fim });
  });
}

/* ============================================================
   NOVA ENTRADA — assistente de 3 passos
   ============================================================ */
async function telaNovo(alvo) {
  const p = await parametros();
  const ultimo = await ultimoPatrimonio();
  const [categorias, fornecedores, contratosF, clientes] = await Promise.all(
    ["categorias", "fornecedores", "contratos_fornecedor", "clientes"].map(listaRef));

  /* Estado do assistente. Fica em memória; nada é gravado até o passo 3. */
  const E = {
    passo: 1,
    dados: {},
    quantidade: 0,
    inicio: Math.max(ultimo + 1, p.patrimonioInicial),
    itens: [],          // [{ patrimonio, serial }]
    posicao: 0,
    params: p
  };

  alvo.innerHTML = cabecalhoPagina("Nova entrada de lote", "", `
    <button class="btn" id="lt-voltar">${ico("x", 15)}Cancelar</button>`)
    + `<div class="card card-pad" style="margin-bottom:16px">
        <div class="abas" style="margin:0;border:0" id="lt-passos">
          <div class="aba on" data-p="1">1. Equipamento</div>
          <div class="aba" data-p="2">2. Seriais</div>
          <div class="aba" data-p="3">3. Confirmação</div>
        </div>
       </div>
       <div id="lt-painel"></div>`;

  alvo.querySelector("#lt-voltar").onclick = () => irPara("lotes");
  const painel = alvo.querySelector("#lt-painel");

  function marcarPasso(n) {
    E.passo = n;
    alvo.querySelectorAll("#lt-passos .aba").forEach(a =>
      a.classList.toggle("on", Number(a.dataset.p) === n));
  }

  /* ---------- PASSO 1: descrição do equipamento ---------- */
  function passo1() {
    marcarPasso(1);
    painel.innerHTML = `
      <div class="card card-pad">
        <div class="aviso info" style="margin-bottom:15px">${ico("box", 18)}<div>
          Descreva o equipamento <b>uma vez</b>. Todos os itens do lote nascem iguais —
          o que muda entre eles é o patrimônio e o número de série.</div></div>

        <h3 style="font-size:14px;color:var(--marinho);margin-bottom:11px">Equipamento</h3>
        <div class="form-grade">
          <div class="campo"><label>Categoria <span class="req">*</span></label>
            <select class="inp" id="e-cat"><option value="">—</option>
              ${categorias.filter(c => c.ativo !== false).map(c =>
                `<option value="${c.id}">${esc(c.nome)}</option>`).join("")}</select></div>
          <div class="campo"><label>Fabricante <span class="req">*</span></label>
            <input class="inp" id="e-fab" placeholder="Dell" list="l-fab">
            <datalist id="l-fab"><option>Dell</option><option>HP</option><option>Lenovo</option>
              <option>Positivo</option><option>Samsung</option><option>Acer</option>
              <option>Multilaser</option><option>Epson</option><option>Brother</option></datalist></div>
          <div class="campo w2"><label>Modelo <span class="req">*</span></label>
            <input class="inp" id="e-mod" placeholder="OptiPlex 3080"></div>
          <div class="campo"><label>Processador</label><input class="inp" id="e-proc" placeholder="Intel Core i5-10500"></div>
          <div class="campo"><label>Memória RAM</label><input class="inp" id="e-ram" placeholder="8 GB"></div>
          <div class="campo"><label>Armazenamento</label><input class="inp" id="e-arm" placeholder="SSD 240 GB"></div>
          <div class="campo"><label>Sistema operacional</label><input class="inp" id="e-so" placeholder="Windows 11 Pro"></div>
          <div class="campo"><label>Tamanho da tela</label><input class="inp" id="e-tela" placeholder='21,5"'></div>
          <div class="campo"><label>Condição</label>
            <select class="inp" id="e-cond">${C.CONDICAO_ATIVO.map(c =>
              `<option value="${c.v}" ${c.v === "NOVO" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
        </div>

        <h3 style="font-size:14px;color:var(--marinho);margin:20px 0 11px">Propriedade</h3>
        <div class="form-grade">
          <div class="campo"><label>Origem <span class="req">*</span></label>
            <select class="inp" id="e-orig">${C.ORIGEM_ATIVO.map(o =>
              `<option value="${o.v}">${esc(o.label)}</option>`).join("")}</select></div>
          <div class="campo"><label>Fornecedor <span id="e-req-f"></span></label>
            <select class="inp" id="e-forn"><option value="">—</option>
              ${fornecedores.map(f => `<option value="${f.id}">${esc(rotulo("fornecedores", f))}</option>`).join("")}</select></div>
          <div class="campo w2"><label>Contrato / operação de origem <span id="e-req-c"></span></label>
            <select class="inp" id="e-ctr" disabled><option value="">— selecione o fornecedor —</option></select>
            <span class="hint">Nunca misture operações. Um lote pertence a um contrato só.</span></div>
        </div>

        <h3 style="font-size:14px;color:var(--marinho);margin:20px 0 11px">Numeração e quantidade</h3>
        <div class="form-grade">
          <div class="campo"><label>Quantidade <span class="req">*</span></label>
            <input class="inp" type="number" id="e-qtd" min="1" max="2000" value="300"></div>
          <div class="campo"><label>Patrimônio inicial <span class="req">*</span></label>
            <input class="inp mono" type="number" id="e-ini" value="${E.inicio}">
            <span class="hint">Sugerido a partir do último gerado. Só altere se souber o que está fazendo.</span></div>
          <div class="campo w2"><div id="e-previa"></div></div>
          <div class="campo w2"><label>Nota fiscal / documento de entrada</label>
            <input class="inp" id="e-nf" placeholder="NF 12345 · Pedido 987"></div>
          <div class="campo w2"><label>Observações do lote</label>
            <textarea class="inp" id="e-obs"></textarea></div>
        </div>

        <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap">
          <button class="btn p lg" id="e-avancar">Avançar para os seriais ${ico("arrows", 16)}</button>
        </div>
      </div>`;

    const $ = s => painel.querySelector(s);
    const orig = $("#e-orig"), forn = $("#e-forn"), ctr = $("#e-ctr");

    const aplicarOrigem = () => {
      const exige = ["LOCADO", "COMODATO"].includes(orig.value);
      $("#e-req-f").innerHTML = exige ? '<span class="req">*</span>' : "";
      $("#e-req-c").innerHTML = exige ? '<span class="req">*</span>' : "";
    };
    orig.onchange = aplicarOrigem; aplicarOrigem();

    forn.onchange = () => {
      const l = contratosF.filter(c => c.fornecedor_id === forn.value);
      ctr.innerHTML = `<option value="">—</option>` + l.map(c =>
        `<option value="${c.id}">${esc(rotulo("contratos_fornecedor", c))}</option>`).join("");
      ctr.disabled = !forn.value;
    };

    const previa = () => {
      const q = Number($("#e-qtd").value || 0), i = Number($("#e-ini").value || 0);
      if (!q || !i) { $("#e-previa").innerHTML = ""; return; }
      $("#e-previa").innerHTML = `<div class="aviso ok">${ico("tag", 18)}<div>
        Serão gerados <b>${num(q)}</b> patrimônios, de
        <b class="mono">${i}</b> até <b class="mono">${i + q - 1}</b>.</div></div>`;
    };
    $("#e-qtd").oninput = previa; $("#e-ini").oninput = previa; previa();

    $("#e-avancar").onclick = async () => {
      const d = {
        categoria: $("#e-cat").value, fabricante: $("#e-fab").value.trim(),
        modelo: $("#e-mod").value.trim(), processador: $("#e-proc").value.trim() || null,
        memoria_ram: $("#e-ram").value.trim() || null, armazenamento: $("#e-arm").value.trim() || null,
        sistema_operacional: $("#e-so").value.trim() || null, tamanho_tela: $("#e-tela").value.trim() || null,
        condicao: $("#e-cond").value, origem_ativo: orig.value,
        fornecedor_id: forn.value || null, contrato_fornecedor_id: ctr.value || null,
        nota_fiscal: $("#e-nf").value.trim() || null, observacoes: $("#e-obs").value.trim() || null
      };
      const q = Number($("#e-qtd").value), i = Number($("#e-ini").value);

      if (!d.categoria || !d.fabricante || !d.modelo) return toast("Preencha categoria, fabricante e modelo.", "warn");
      if (!q || q < 1) return toast("Informe a quantidade.", "warn");
      if (q > 2000) return toast("Máximo de 2.000 itens por entrada. Divida em lotes menores.", "warn");
      if (!i || i < 1) return toast("Informe o patrimônio inicial.", "warn");
      /* Regras 9 e 10: equipamento de terceiro exige fornecedor E contrato. */
      if (["LOCADO", "COMODATO"].includes(d.origem_ativo) && (!d.fornecedor_id || !d.contrato_fornecedor_id))
        return toast("Equipamento locado exige fornecedor e contrato de origem.", "warn");

      const btn = $("#e-avancar"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
      try {
        const conflitos = await conflitosNaFaixa(i, i + q - 1);
        if (conflitos.length) {
          btn.disabled = false; btn.innerHTML = `Avançar para os seriais ${ico("arrows", 16)}`;
          return modal({
            titulo: "Faixa de patrimônio já utilizada", tamanho: "g",
            corpo: `<div class="aviso err">${ico("alert", 18)}<div>
                <b>${conflitos.length} patrimônio(s) desta faixa já existem no sistema.</b>
                Escolher outra faixa evita dois equipamentos com o mesmo número.</div></div>
              <div class="tab-wrap" style="margin-top:13px"><table class="tab"><thead><tr>
                <th>Patrimônio</th><th>Equipamento</th><th>Status</th></tr></thead><tbody>
                ${conflitos.slice(0, 20).map(a => `<tr>
                  <td><span class="mono">${esc(a.patrimonio_newpc)}</span></td>
                  <td>${esc([a.fabricante, a.modelo].filter(Boolean).join(" "))}</td>
                  <td>${esc(C.labelDe(C.STATUS_ATIVO, a.status))}</td></tr>`).join("")}
              </tbody></table></div>`,
            acoes: [{ texto: "Escolher outra faixa", classe: "p" }]
          });
        }
        E.dados = d; E.quantidade = q; E.inicio = i;
        E.itens = Array.from({ length: q }, (_, k) => ({ patrimonio: String(i + k), serial: "" }));
        E.posicao = 0;
        passo2();
      } catch (e) {
        console.error(e); toast(e.message || "Erro ao validar a faixa.", "err");
        btn.disabled = false; btn.innerHTML = `Avançar para os seriais ${ico("arrows", 16)}`;
      }
    };
  }

  /* ---------- PASSO 2: bipagem dos seriais ---------- */
  function passo2() {
    marcarPasso(2);
    painel.innerHTML = `
      <div class="grade" style="grid-template-columns:1fr 340px;gap:16px" id="lt-g2">
        <div class="card card-pad">
          <div class="aviso info" style="margin-bottom:15px">${ico("scan", 18)}<div>
            Posicione o cursor no campo abaixo e <b>bipe o código de barras do número de série</b>
            de cada equipamento. O leitor envia Enter no final e o sistema avança sozinho.</div></div>

          <div style="text-align:center;padding:14px 0 18px;border-bottom:1px solid var(--borda);margin-bottom:16px">
            <div style="font-size:12px;color:var(--texto-2);font-weight:650;text-transform:uppercase;letter-spacing:.5px">
              Patrimônio atual</div>
            <div class="mono" id="b-pat" style="font-size:48px;font-weight:800;color:var(--marinho);line-height:1.1"></div>
            <div style="font-size:13.5px;color:var(--texto-2)">${esc(E.dados.fabricante)} ${esc(E.dados.modelo)}</div>
          </div>

          <div class="campo">
            <label>Número de série <span class="hint">(bipe ou digite e tecle Enter)</span></label>
            <input class="inp mono" id="b-serial" autocomplete="off" autocapitalize="characters"
                   style="height:52px;font-size:19px;text-align:center" placeholder="aguardando leitura…">
          </div>

          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn" id="b-pular">Pular este ${ico("arrows", 14)}</button>
            <button class="btn" id="b-anterior">${ico("arrows", 14)}Anterior</button>
            <button class="btn" id="b-pular-todos" style="margin-left:auto">Deixar todos sem série</button>
          </div>

          <div style="margin-top:18px">
            ${barraProgresso(0, true)}
            <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--texto-2);margin-top:6px">
              <span id="b-cont"></span>
              <span id="b-falta"></span>
            </div>
          </div>

          <div style="display:flex;gap:9px;justify-content:space-between;margin-top:20px;flex-wrap:wrap">
            <button class="btn" id="b-voltar">Voltar ao passo 1</button>
            <button class="btn v lg" id="b-concluir">Revisar e concluir ${ico("check", 16)}</button>
          </div>
        </div>

        <div class="card" style="align-self:start;max-height:70vh;display:flex;flex-direction:column">
          <div class="card-tit"><h3>Lidos</h3><span class="dir" id="b-lidos-n"></span></div>
          <div style="overflow-y:auto;padding:4px 0" id="b-lista"></div>
        </div>
      </div>`;

    const $ = s => painel.querySelector(s);
    const inp = $("#b-serial");

    function atualizar() {
      const lidos = E.itens.filter(i => i.serial).length;
      const atual = E.itens[E.posicao];
      $("#b-pat").textContent = atual ? atual.patrimonio : "—";
      inp.value = atual?.serial || "";
      $("#b-cont").textContent = `${E.posicao + 1} de ${E.quantidade}`;
      $("#b-falta").textContent = `${lidos} serial(is) lido(s)`;
      painel.querySelector(".barra > i").style.width = `${Math.round((lidos / E.quantidade) * 100)}%`;
      $("#b-lidos-n").textContent = `${lidos}/${E.quantidade}`;
      $("#b-anterior").disabled = E.posicao === 0;

      $("#b-lista").innerHTML = E.itens.filter(i => i.serial).slice(-40).reverse().map(i => `
        <div style="display:flex;gap:10px;padding:6px 14px;border-bottom:1px solid var(--borda);font-size:12.5px">
          <span class="mono" style="font-weight:700;color:var(--marinho)">${esc(i.patrimonio)}</span>
          <span class="mono" style="color:var(--texto-2);margin-left:auto">${esc(i.serial)}</span>
        </div>`).join("") ||
        `<div style="padding:22px;text-align:center;color:var(--texto-2);font-size:13px">
          Nenhum serial lido ainda.</div>`;
      inp.focus(); inp.select();
    }

    function registrar(valor) {
      const v = String(valor || "").trim().toUpperCase();
      if (v) {
        /* Serial repetido dentro do próprio lote quase sempre é bipagem dupla. */
        const dup = E.itens.find((i, k) => i.serial === v && k !== E.posicao);
        if (dup) {
          toast(`Este serial já foi lido no patrimônio ${dup.patrimonio}.`, "warn");
          inp.select(); return;
        }
        E.itens[E.posicao].serial = v;
      }
      if (E.posicao < E.quantidade - 1) E.posicao++;
      else toast("Último item do lote. Clique em Revisar e concluir.", "info");
      atualizar();
    }

    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); registrar(inp.value); }
    });
    $("#b-pular").onclick = () => { if (E.posicao < E.quantidade - 1) E.posicao++; atualizar(); };
    $("#b-anterior").onclick = () => { if (E.posicao > 0) E.posicao--; atualizar(); };
    $("#b-pular-todos").onclick = async () => {
      if (await confirmar("Deixar todos sem número de série?",
        "Os ativos serão criados só com patrimônio, marca e modelo. Você pode preencher os seriais depois, no inventário ou na implantação.",
        "Continuar sem série")) passo3();
    };
    $("#b-voltar").onclick = () => passo1();
    $("#b-concluir").onclick = () => passo3();

    atualizar();
  }

  /* ---------- PASSO 3: confirmação e gravação ---------- */
  function passo3() {
    marcarPasso(3);
    const comSerial = E.itens.filter(i => i.serial).length;
    const semSerial = E.quantidade - comSerial;

    painel.innerHTML = `
      <div class="card card-pad">
        <div class="grade g4" style="margin-bottom:17px">
          ${kpi("Equipamentos", E.quantidade, { cor: "azul" })}
          ${kpi("Com número de série", comSerial, { cor: comSerial ? "verde" : "" })}
          ${kpi("Sem série", semSerial, { cor: semSerial ? "amarelo" : "" })}
          ${kpi("Faixa", `${E.inicio} – ${E.inicio + E.quantidade - 1}`)}
        </div>

        <div class="grade g2" style="margin-bottom:16px">
          <div>
            <div class="dado"><div class="r">Equipamento</div>
              <div class="v">${esc(E.dados.fabricante)} ${esc(E.dados.modelo)}</div></div>
            <div class="dado"><div class="r">Categoria</div>
              <div class="v">${esc(rotuloDeId("categorias", E.dados.categoria))}</div></div>
            <div class="dado"><div class="r">Configuração</div>
              <div class="v">${esc([E.dados.processador, E.dados.memoria_ram, E.dados.armazenamento,
                E.dados.sistema_operacional].filter(Boolean).join(" · ") || "—")}</div></div>
          </div>
          <div>
            <div class="dado"><div class="r">Origem</div>
              <div class="v">${esc(C.labelDe(C.ORIGEM_ATIVO, E.dados.origem_ativo))}</div></div>
            <div class="dado"><div class="r">Proprietário</div>
              <div class="v ${E.dados.fornecedor_id ? "" : "vazio-v"}">
                ${esc(E.dados.fornecedor_id ? rotuloDeId("fornecedores", E.dados.fornecedor_id) : "NEWPC")}</div></div>
            <div class="dado"><div class="r">Contrato de origem</div>
              <div class="v ${E.dados.contrato_fornecedor_id ? "" : "vazio-v"}">
                ${esc(E.dados.contrato_fornecedor_id ? rotuloDeId("contratos_fornecedor", E.dados.contrato_fornecedor_id) : "—")}</div></div>
            <div class="dado"><div class="r">Nota fiscal</div>
              <div class="v ${E.dados.nota_fiscal ? "" : "vazio-v"}">${esc(E.dados.nota_fiscal || "—")}</div></div>
          </div>
        </div>

        <div class="aviso info" style="margin-bottom:16px">${ico("box", 18)}<div>
          Os ${num(E.quantidade)} equipamentos entram como <b>Em Estoque</b>, sem cliente.
          A alocação acontece depois, na implantação.</div></div>

        ${semSerial ? `<div class="aviso warn" style="margin-bottom:16px">${ico("alert", 18)}<div>
          <b>${num(semSerial)} equipamento(s) ficarão sem número de série.</b>
          Dá para preencher depois, mas até lá o rastreio por serial não funciona para eles.</div></div>` : ""}

        <div id="lt-progresso"></div>

        <div style="display:flex;gap:9px;justify-content:space-between;margin-top:18px;flex-wrap:wrap">
          <button class="btn" id="c-voltar">Voltar aos seriais</button>
          <button class="btn v lg" id="c-gravar">${ico("check", 17)}Confirmar entrada de ${num(E.quantidade)} equipamentos</button>
        </div>
      </div>`;

    painel.querySelector("#c-voltar").onclick = () => passo2();
    painel.querySelector("#c-gravar").onclick = gravar;
  }

  async function gravar() {
    const btn = painel.querySelector("#c-gravar");
    const prog = painel.querySelector("#lt-progresso");
    btn.disabled = true;
    painel.querySelector("#c-voltar").disabled = true;
    prog.innerHTML = `<div class="aviso info"><div><b>Gravando…</b> Não feche a página.</div>
      ${barraProgresso(0, true)}</div>`;
    const barra = prog.querySelector(".barra > i");

    try {
      /* Reserva a faixa de forma atômica antes de criar qualquer ativo. */
      const faixa = await reservarFaixaPatrimonio(E.quantidade, E.inicio);
      const codigo = await proximoCodigo("entradas_lote").catch(() => `LOT-${Date.now()}`);

      const base = {
        ...E.dados,
        status: "EM_ESTOQUE",
        cliente_id: null, contrato_cliente_id: null,
        municipio_id: null, unidade_id: null, setor_id: null, local_id: null,
        entrada_lote_codigo: codigo,
        criado_em: serverTimestamp(), atualizado_em: serverTimestamp(),
        criado_por: sessao.usuario.id, criado_por_nome: sessao.usuario.nome
      };
      delete base.nota_fiscal;

      const operacoes = E.itens.map(i => ({
        colecao: "ativos",
        dados: { ...base, patrimonio_newpc: i.patrimonio, numero_serie: i.serial || null,
                 nota_fiscal: E.dados.nota_fiscal || null }
      }));

      /* Grava em blocos para poder mostrar progresso real e não estourar o limite de lote. */
      const BLOCO = 200;
      for (let k = 0; k < operacoes.length; k += BLOCO) {
        await gravarLote(operacoes.slice(k, k + BLOCO));
        barra.style.width = `${Math.round(Math.min(100, ((k + BLOCO) / operacoes.length) * 100))}%`;
      }

      await criar("entradas_lote", {
        codigo, ...E.dados, quantidade: E.quantidade,
        patrimonio_inicio: String(faixa.inicio), patrimonio_fim: String(faixa.fim),
        seriais_lidos: E.itens.filter(i => i.serial).length,
        itens: E.itens.map(i => ({ p: i.patrimonio, s: i.serial || null })),
        criado_em: serverTimestamp()
      });

      toast(`${num(E.quantidade)} equipamentos cadastrados.`, "ok", "Entrada concluída");
      irPara("lotes", "etiquetas", { inicio: faixa.inicio, fim: faixa.fim });
    } catch (e) {
      console.error(e);
      prog.innerHTML = `<div class="aviso err">${ico("alert", 18)}<div>
        <b>A gravação falhou.</b> ${esc(e.message || "")}
        <br>Parte dos equipamentos pode ter sido criada. Confira em Ativos antes de repetir a entrada,
        para não duplicar.</div></div>`;
      btn.disabled = false;
      painel.querySelector("#c-voltar").disabled = false;
    }
  }

  passo1();
}

/* ============================================================
   ETIQUETAS — impressora térmica
   ============================================================ */
async function telaEtiquetas(alvo, params) {
  const p = await parametros();
  let ativos = [];

  alvo.innerHTML = cabecalhoPagina("Etiquetas de patrimônio",
    "QR Code e número para impressora térmica") + `<div id="etq">${carregando()}</div>`;
  const box = alvo.querySelector("#etq");

  /* Origem dos dados: um lote inteiro, uma faixa, ou seleção manual. */
  if (params.lote) {
    const l = await obter("entradas_lote", params.lote);
    if (!l) { box.innerHTML = vazio("Lote não encontrado"); return; }
    ativos = (l.itens || []).map(i => ({ patrimonio_newpc: i.p, numero_serie: i.s,
      fabricante: l.fabricante, modelo: l.modelo }));
  } else if (params.inicio && params.fim) {
    const { dados } = await buscar("ativos",
      [["patrimonio_newpc", ">=", String(params.inicio)], ["patrimonio_newpc", "<=", String(params.fim)]],
      ["patrimonio_newpc", "asc"], 2000);
    ativos = dados;
  }

  box.innerHTML = `
    <div class="card card-pad" style="margin-bottom:16px" id="etq-config">
      <div class="form-grade">
        <div class="campo"><label>De (patrimônio)</label>
          <input class="inp mono" id="q-de" value="${esc(params.inicio || ativos[0]?.patrimonio_newpc || "")}"></div>
        <div class="campo"><label>Até (patrimônio)</label>
          <input class="inp mono" id="q-ate" value="${esc(params.fim || ativos[ativos.length-1]?.patrimonio_newpc || "")}"></div>
        <div class="campo"><label>Tamanho da etiqueta</label>
          <select class="inp" id="q-tam">${C.PRESETS_ETIQUETA.map(t =>
            `<option value="${t.v}" data-l="${t.l}" data-a="${t.a}"
             ${t.l === p.etiquetaLargura && t.a === p.etiquetaAltura ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>
        <div class="campo"><label>Medida (mm)</label>
          <div style="display:flex;gap:7px;align-items:center">
            <input class="inp" type="number" id="q-larg" value="${p.etiquetaLargura}" style="width:80px">
            <span style="color:var(--texto-2)">x</span>
            <input class="inp" type="number" id="q-alt" value="${p.etiquetaAltura}" style="width:80px">
          </div></div>
        <div class="campo w2"><label class="check"><input type="checkbox" id="q-modelo" checked>
          <span>Incluir marca e modelo na etiqueta</span></label></div>
      </div>
      <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap">
        <button class="btn" id="q-carregar">${ico("search", 15)}Carregar faixa</button>
        <span style="margin-left:auto;display:flex;gap:9px">
          <button class="btn" id="q-csv">${ico("down", 15)}Exportar lista</button>
          <button class="btn p" id="q-imprimir">${ico("print", 15)}Imprimir etiquetas</button>
        </span>
      </div>
      <div class="aviso info" style="margin-top:13px">${ico("print", 18)}<div>
        Na janela de impressão, selecione a impressora térmica e deixe as margens em
        <b>Nenhuma</b> e a escala em <b>100%</b>. Imprima <b>uma etiqueta de teste</b> antes de
        soltar as 300 — cada modelo de impressora calibra o rolo de um jeito.</div></div>
    </div>
    <div id="etq-previa"></div>
    <div id="etq-folha" class="oculto"></div>`;

  const $ = s => box.querySelector(s);

  $("#q-tam").onchange = () => {
    const o = $("#q-tam").selectedOptions[0];
    if (o.value !== "custom") { $("#q-larg").value = o.dataset.l; $("#q-alt").value = o.dataset.a; }
    render();
  };
  ["#q-larg", "#q-alt"].forEach(s => $(s).oninput = render);
  $("#q-modelo").onchange = render;

  $("#q-carregar").onclick = async () => {
    const de = $("#q-de").value.trim(), ate = $("#q-ate").value.trim();
    if (!de || !ate) return toast("Informe a faixa de patrimônio.", "warn");
    box.querySelector("#etq-previa").innerHTML = carregando();
    const { dados } = await buscar("ativos",
      [["patrimonio_newpc", ">=", de], ["patrimonio_newpc", "<=", ate]], ["patrimonio_newpc", "asc"], 2000);
    ativos = dados;
    if (!ativos.length) toast("Nenhum ativo encontrado nessa faixa.", "warn");
    render();
  };

  $("#q-csv").onclick = () => baixarCSV("etiquetas",
    ["Patrimônio", "Série", "Fabricante", "Modelo"],
    ativos.map(a => [a.patrimonio_newpc, a.numero_serie || "", a.fabricante || "", a.modelo || ""]));

  $("#q-imprimir").onclick = () => {
    if (!ativos.length) return toast("Carregue a faixa primeiro.", "warn");
    imprimir();
  };

  function etiquetaHTML(a, larg, alt, comModelo) {
    const qr = qrSVG(a.patrimonio_newpc, Math.round(alt * 2.6));
    return `<div class="etq-un" style="width:${larg}mm;height:${alt}mm">
      <div class="etq-qr">${qr}</div>
      <div class="etq-txt">
        <div class="etq-marca">NEWPC</div>
        <div class="etq-num">${esc(a.patrimonio_newpc)}</div>
        ${comModelo && (a.fabricante || a.modelo)
          ? `<div class="etq-mod">${esc([a.fabricante, a.modelo].filter(Boolean).join(" ").slice(0, 26))}</div>` : ""}
      </div>
    </div>`;
  }

  function render() {
    const larg = Number($("#q-larg").value) || 50;
    const alt = Number($("#q-alt").value) || 25;
    const comModelo = $("#q-modelo").checked;
    const prev = box.querySelector("#etq-previa");

    if (!ativos.length) {
      prev.innerHTML = vazio("Nenhuma etiqueta carregada",
        "Informe a faixa de patrimônio e clique em Carregar faixa.");
      return;
    }
    prev.innerHTML = `<div class="card card-pad">
      <div class="card-tit" style="border:0;padding:0 0 12px">
        <h3>Pré-visualização</h3>
        <span class="dir" style="font-size:12.5px;color:var(--texto-2)">
          ${num(ativos.length)} etiqueta(s) · ${larg} x ${alt} mm</span></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;background:var(--cinza-2);padding:14px;border-radius:9px">
        ${ativos.slice(0, 6).map(a => etiquetaHTML(a, larg, alt, comModelo)).join("")}
      </div>
      ${ativos.length > 6 ? `<p class="hint" style="margin-top:9px">
        Mostrando as 6 primeiras. A impressão inclui todas as ${num(ativos.length)}.</p>` : ""}
    </div>`;
  }

  function imprimir() {
    const larg = Number($("#q-larg").value) || 50;
    const alt = Number($("#q-alt").value) || 25;
    const comModelo = $("#q-modelo").checked;

    /* Uma etiqueta por página: é assim que a impressora térmica de rolo espera receber. */
    const estilo = `
      @page { size: ${larg}mm ${alt}mm; margin: 0; }
      html,body { margin:0; padding:0; background:#fff; }
      .etq-un { page-break-after: always; break-after: page; }
      .etq-un:last-child { page-break-after: auto; break-after: auto; }`;

    const janela = window.open("", "_blank", "width=520,height=640");
    if (!janela) return toast("O navegador bloqueou a janela de impressão. Permita pop-ups para este site.", "err");
    janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>Etiquetas NEWPC</title>
      <style>
        ${document.querySelector('link[href*="newpc.css"]') ? "" : ""}
        .etq-un{display:flex;align-items:center;gap:1.5mm;padding:1mm;box-sizing:border-box;
          font-family:Arial,Helvetica,sans-serif;overflow:hidden;background:#fff}
        .etq-qr{flex:0 0 auto;line-height:0}
        .etq-qr svg{display:block}
        .etq-txt{flex:1;min-width:0;text-align:center}
        .etq-marca{font-size:2.1mm;font-weight:700;letter-spacing:.5mm;color:#0F2C4A}
        .etq-num{font-size:${Math.max(4, alt * 0.30)}mm;font-weight:800;color:#000;
          font-family:"Courier New",monospace;line-height:1.05;letter-spacing:.2mm}
        .etq-mod{font-size:1.9mm;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        ${estilo}
      </style></head><body>
      ${ativos.map(a => etiquetaHTML(a, larg, alt, comModelo)).join("")}
      </body></html>`);
    janela.document.close();
    janela.focus();
    setTimeout(() => { janela.print(); }, 700);
  }

  render();
}
