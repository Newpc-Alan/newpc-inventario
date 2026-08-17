/* Leitura de QR Code pela câmera + resolução de código para ativo.
 * Biblioteca html5-qrcode carregada sob demanda (só quando o scanner abre). */
import { buscar } from "../store.js";
import { ico, esc, toast, modal } from "../ui.js";
import { APP } from "../config.js";

let libPronta = null;
function carregarLib() {
  if (libPronta) return libPronta;
  libPronta = new Promise((ok, err) => {
    if (window.Html5Qrcode) return ok();
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
    s.onload = () => ok();
    s.onerror = () => err(new Error("Não foi possível carregar o leitor de QR Code."));
    document.head.appendChild(s);
  });
  return libPronta;
}

/** Normaliza o conteúdo lido: aceita "NEWPC-000123", url com ?a=NEWPC-000123 ou o código puro. */
export function normalizarCodigo(txt) {
  let t = String(txt || "").trim();
  try { const u = new URL(t); t = u.searchParams.get("a") || u.hash.replace(/^#\/?ativos\//, "") || t; } catch {}
  return t.toUpperCase().replace(/\s+/g, "");
}

/** Resolve um código em ativo, tentando os identificadores em ordem de prioridade. */
export async function acharAtivoPorCodigo(codigo) {
  const cod = normalizarCodigo(codigo);
  if (!cod) return null;
  const campos = ["patrimonio_newpc", "numero_serie", "service_tag", "patrimonio_fornecedor", "patrimonio_cliente"];
  for (const campo of campos) {
    try {
      const { dados } = await buscar("ativos", [[campo, "==", cod]], null, 1);
      if (dados.length) return dados[0];
    } catch {}
  }
  return null;
}

/**
 * abrirScanner({ titulo, aoLer(codigo, fechar), permitirManual, textoAjuda })
 * aoLer pode ser assíncrono. Retorne false para manter o scanner aberto (leitura contínua).
 */
export async function abrirScanner({ titulo = "Escanear QR Code", aoLer, permitirManual = true, textoAjuda = "" } = {}) {
  const corpo = document.createElement("div");
  corpo.innerHTML = `
    <div class="scanner-box"><div id="leitor-qr"></div><div class="scanner-mira"></div>
      <div class="scanner-dica">Aponte para o QR Code do equipamento</div></div>
    <div id="sc-status" style="margin-top:11px"></div>
    ${permitirManual ? `<div style="margin-top:13px">
      <div class="campo"><label>Ou digite o identificador</label>
        <div style="display:flex;gap:8px">
          <input class="inp mono" id="sc-manual" placeholder="${esc(APP.prefixoQR)}000123 · serial · service tag"
                 autocapitalize="characters" autocomplete="off">
          <button class="btn p" id="sc-ok" style="flex:0 0 auto">${ico("search", 15)}Buscar</button>
        </div></div></div>` : ""}
    ${textoAjuda ? `<p class="hint" style="margin-top:9px">${esc(textoAjuda)}</p>` : ""}`;

  const m = modal({ titulo, corpo, tamanho: "", aoFechar: parar });
  const status = corpo.querySelector("#sc-status");
  let leitor = null, processando = false;

  async function processar(codigo) {
    if (processando) return;
    processando = true;
    status.innerHTML = `<div class="aviso info"><span class="spin"></span><div>Consultando ${esc(codigo)}…</div></div>`;
    try {
      const manter = await aoLer(normalizarCodigo(codigo), m.fechar);
      if (manter === false) { setTimeout(() => { processando = false; status.innerHTML = ""; }, 900); }
      else { await parar(); m.fechar(); }
    } catch (e) {
      console.error(e);
      status.innerHTML = `<div class="aviso err"><div>${esc(e.message || "Erro ao processar a leitura.")}</div></div>`;
      setTimeout(() => { processando = false; }, 1200);
    }
  }

  async function parar() {
    try { if (leitor?.isScanning) await leitor.stop(); leitor?.clear(); } catch {}
    leitor = null;
  }

  corpo.querySelector("#sc-ok")?.addEventListener("click", () => {
    const v = corpo.querySelector("#sc-manual").value.trim();
    if (v) processar(v);
  });
  corpo.querySelector("#sc-manual")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); corpo.querySelector("#sc-ok").click(); }
  });

  try {
    await carregarLib();
    leitor = new window.Html5Qrcode("leitor-qr", { verbose: false });
    await leitor.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.333 },
      txt => processar(txt),
      () => {}
    );
  } catch (e) {
    console.warn("[scanner]", e);
    corpo.querySelector(".scanner-box").outerHTML =
      `<div class="aviso warn"><div><b>Câmera indisponível</b>
        ${/permission|NotAllowed/i.test(e.message || e) ?
          "Permita o acesso à câmera nas configurações do navegador. Em iPhone, o site precisa estar em HTTPS."
          : "Use o campo abaixo para digitar o identificador do equipamento."}</div></div>`;
    corpo.querySelector("#sc-manual")?.focus();
  }
  return m;
}

/** Gera o SVG de um QR Code sem dependência externa (modelo 2, nível M, modo byte). */
export function qrSVG(texto, tamanho = 120) {
  const m = gerarMatriz(String(texto));
  const n = m.length, esc = 4, total = n + esc * 2, cel = tamanho / total;
  let path = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x])
    path += `M${((x + esc) * cel).toFixed(2)} ${((y + esc) * cel).toFixed(2)}h${cel.toFixed(2)}v${cel.toFixed(2)}h-${cel.toFixed(2)}z`;
  return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${tamanho}" height="${tamanho}" fill="#fff"/><path d="${path}" fill="#0F2C4A"/></svg>`;
}

/* ---- gerador QR mínimo (byte mode, ECC M, versões 1..10) ---- */
function gerarMatriz(txt) {
  const dadosBytes = new TextEncoder().encode(txt);
  const CAP_M = [null,14,26,42,62,84,106,122,152,180,213];
  let ver = 0;
  for (let v = 1; v <= 10; v++) if (dadosBytes.length + 2 <= CAP_M[v]) { ver = v; break; }
  if (!ver) throw new Error("Texto longo demais para o QR Code.");
  const TAM = 17 + ver * 4;
  const ECC = [null,10,16,26,18,24,16,18,22,22,26];
  const BLOCOS = [null,1,1,1,2,2,4,4,4,5,5];
  const totalCw = CAP_M[ver] + ECC[ver] * BLOCOS[ver];

  /* bitstream */
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(4, 4);
  push(dadosBytes.length, ver < 10 ? 8 : 16);
  dadosBytes.forEach(b => push(b, 8));
  const capBits = CAP_M[ver] * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const dc = [];
  for (let i = 0; i < bits.length; i += 8) dc.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const PAD = [0xEC, 0x11];
  let k = 0; while (dc.length < CAP_M[ver]) dc.push(PAD[k++ % 2]);

  /* Reed-Solomon */
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  function rs(dados, nEc) {
    let g = [1];
    for (let i = 0; i < nEc; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    const r = new Array(nEc).fill(0);
    dados.forEach(d => {
      const f = d ^ r[0];
      r.shift(); r.push(0);
      for (let j = 0; j < nEc; j++) r[j] ^= mul(g[j + 1], f);
    });
    return r;
  }

  /* blocos */
  const nb = BLOCOS[ver], nEc = ECC[ver];
  const base = Math.floor(CAP_M[ver] / nb), resto = CAP_M[ver] % nb;
  const dBlocos = [], eBlocos = [];
  let p = 0;
  for (let i = 0; i < nb; i++) {
    const t = base + (i >= nb - resto ? 1 : 0);
    const b = dc.slice(p, p + t); p += t;
    dBlocos.push(b); eBlocos.push(rs(b, nEc));
  }
  const finais = [];
  for (let i = 0; i < Math.max(...dBlocos.map(b => b.length)); i++)
    dBlocos.forEach(b => { if (i < b.length) finais.push(b[i]); });
  for (let i = 0; i < nEc; i++) eBlocos.forEach(b => finais.push(b[i]));

  /* matriz */
  const M = Array.from({ length: TAM }, () => new Array(TAM).fill(null));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < TAM && y < TAM) M[y][x] = v; };
  const finder = (cx, cy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= TAM || y >= TAM) continue;
      const b = (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) &&
        (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(x, y, b ? 1 : 0);
    }
  };
  finder(0, 0); finder(TAM - 7, 0); finder(0, TAM - 7);
  for (let i = 8; i < TAM - 8; i++) { if (M[6][i] === null) set(i, 6, i % 2 === 0 ? 1 : 0);
                                      if (M[i][6] === null) set(6, i, i % 2 === 0 ? 1 : 0); }
  if (ver > 1) {
    const POS = [null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]][ver];
    POS.forEach(cy => POS.forEach(cx => {
      if ((cx < 8 && cy < 8) || (cx < 8 && cy > TAM - 9) || (cx > TAM - 9 && cy < 8)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        set(cx + dx, cy + dy, (Math.abs(dx) === 2 || Math.abs(dy) === 2 || (dx === 0 && dy === 0)) ? 1 : 0);
    }));
  }
  set(8, TAM - 8, 1);
  const reservaFormato = [];
  for (let i = 0; i < 9; i++) { if (M[8][i] === null) reservaFormato.push([i, 8]); if (M[i][8] === null) reservaFormato.push([8, i]); }
  for (let i = TAM - 8; i < TAM; i++) { if (M[8][i] === null) reservaFormato.push([i, 8]); if (M[i][8] === null) reservaFormato.push([8, i]); }
  reservaFormato.forEach(([x, y]) => set(x, y, 0));

  /* preenchimento zig-zag com máscara 0 */
  let bi = 0, up = true;
  const bitsFinais = [];
  finais.forEach(b => { for (let i = 7; i >= 0; i--) bitsFinais.push((b >> i) & 1); });
  for (let col = TAM - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let r = 0; r < TAM; r++) {
      const y = up ? TAM - 1 - r : r;
      for (const x of [col, col - 1]) {
        if (M[y][x] !== null) continue;
        let v = bi < bitsFinais.length ? bitsFinais[bi++] : 0;
        if ((y + x) % 2 === 0) v ^= 1;              // máscara 0
        M[y][x] = v;
      }
    }
    up = !up;
  }
  /* formato: ECC M (00) + máscara 000 */
  let fmt = 0b00 << 3 | 0;
  let rem = fmt;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
  const fbits = ((fmt << 10) | rem) ^ 0x5412;
  const posFmt = [[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]];
  for (let i = 0; i < 15; i++) {
    const b = (fbits >> i) & 1;
    const [x, y] = posFmt[i]; set(x, y, b);
    if (i < 8) set(TAM - 1 - i, 8, b); else set(8, TAM - 15 + i, b);
  }
  return M.map(r => r.map(v => v || 0));
}
