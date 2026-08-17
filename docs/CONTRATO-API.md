# CONTRATO DE API INTERNA — NEWPC Inventário
Todas as views obedecem este contrato. Não invente APIs, não fale com o Firestore direto.

## Assinatura de uma view
Arquivo em `js/views/<nome>.js`. Exporta uma função por rota, com o nome da rota:
```js
export async function ativos(alvo, ctx) { alvo.innerHTML = "..." }
```
- `alvo` = elemento `<main id="conteudo">` já limpo.
- `ctx` = `{ id, sub, params }` vindo do hash `#/rota/id/sub?param=valor`.
- Erros lançados são capturados pelo router e viram tela de erro. Não use try/catch cosmético.

## js/store.js (única porta para o banco)
```js
obter(colecao, id) -> objeto|null
buscar(colecao, filtros, ordem, tam, cursor) -> { dados, ultimo, fim }
   // filtros: [["campo","==",valor], ...]  ordem: ["campo","asc"|"desc"]
contar(colecao, filtros) -> number
criar(colecao, dados, {id, ignorarDuplicidade}) -> id      // lança Error("DUPLICIDADE") com e.duplicados
atualizar(colecao, id, dados, {ignorarDuplicidade, semHistorico}) -> id
inativar(colecao, id)
excluir(colecao, id)                                        // lança Error("VINCULADO") com e.detalhe
lote([{colecao, id?, dados, tipo:"set"|"update"}])
listaRef(colecao) -> array completo (coleções referenciais, com cache 2min)
rotulo(colecao, dado) -> string
rotuloDeId(colecao, id) -> string   // síncrono, usa cache pré-aquecido
descreverLocal(ativo) -> "Cliente / Unidade / Setor / Local"
proximoCodigo(colecao) -> "INV-2026-000001"  (inventarios|movimentacoes|recolhimentos|pendencias|importacoes)
registrarHistorico(ativoId, tipo, titulo, detalhe, extra)
historicoDoAtivo(ativoId, tam) -> array
verificarDuplicidade(colecao, dados, idIgnorar) -> [{campo, valor, registro}]
parametros() -> { diasInventarioVencido, diasAlertaContrato, exigirAprovacaoDivergencia, paginaTamanho, ... }
salvarParametros(obj)
limparCache(colecao?)
```
`criar`/`atualizar` já gravam auditoria, histórico do ativo e carimbos de usuário. Não duplique isso.

## js/ui.js
```js
ico(nome, tam, extra) -> svg string
   // nomes: dashboard scan cpu building school file truck arrows box alert wrench chart upload
   //        users gear map layers door tag check x plus search bell logout menu down camera pin
   //        clock hist shield eye edit trash file2 print
esc(s) dataBR(v, comHora) dataISO(v) diasDesde(v) moeda(n) num(n) cnpjFmt(v) iniciais(n) pct(a,b)
badge(listaDominio, valor) badgeStatusAtivo(v) badgeAtivoInativo(v)
toast(msg, "ok"|"err"|"warn"|"info", titulo)
modal({titulo, corpo, acoes:[{texto, classe, icone, aoClicar:async fechar=>{}}], tamanho:""|"g"|"p", semFechar, aoFechar})
   // aoClicar retornando false mantém o modal aberto
confirmar(titulo, texto, textoBotao, perigo) -> Promise<boolean>
montarFormulario(entidade, dados, {campos:[...]}) -> Promise<HTMLFormElement>
lerFormulario(form, entidade) -> {ok:true, dados} | {ok:false, erros}
celula(entidade, campo, dado) -> HTML da célula
rotuloColuna(entidade, campo) -> string
carregando(txt) vazio(titulo, texto, botao) cabecalhoPagina(titulo, sub, acoesHTML)
kpi(rotulo, valor, {cor:"verde|azul|amarelo|laranja|vermelho|ciano", sub, href})
barraProgresso(percentual, grande)
baixarCSV(nome, [colunas], [[linha]])
```
Cores de status: verde=correto/disponível, azul=informação, amarelo=atenção, laranja=divergência,
vermelho=crítico, cinza=inativo. Use sempre `badge()` com a lista de domínio de `config.js`.

## js/auth.js
```js
sessao.usuario  // {id, nome, email, perfil, cargo, ativo}
pode("ativo.editar") -> boolean   // esconde botões; o bloqueio real está em firestore.rules
ehTecnico() ehAdmin() perfilLabel()
```

## js/config.js
Listas de domínio: `STATUS_ATIVO CONDICAO_ATIVO ORIGEM_ATIVO STATUS_CONTRATO_FORNECEDOR
STATUS_CONTRATO_CLIENTE STATUS_INVENTARIO RESULTADO_ITEM TIPO_DEFEITO CRITICIDADE TIPO_MOVIMENTACAO
STATUS_MOVIMENTACAO MOTIVO_RECOLHIMENTO FLUXO_RECOLHIMENTO DESTINO_POS_RECOLHIMENTO TIPO_PENDENCIA
STATUS_PENDENCIA TIPO_CLIENTE ESFERA TIPO_UNIDADE CATEGORIA_FOTO CATEGORIAS_PADRAO
STATUS_FORA_DE_OPERACAO STATUS_BLOQUEIA_MOVIMENTACAO`
Helpers: `labelDe(lista, v)`, `corDe(lista, v)`, `podeFazer(perfil, perm)`.

## js/schema.js
`SCHEMA[entidade] = { label, plural, icone, rotulo(d), busca[], colunas[], unicos[], grupos[], campos[] }`
Entidades com CRUD genérico: fornecedores, contratos_fornecedor, clientes, municipios, unidades,
setores, locais, contratos_cliente, ativos, categorias, usuarios.

## js/views/lista.js  (CRUD genérico reutilizável — JÁ EXISTE, use sempre que possível)
```js
import { paginaLista, abrirEditor } from "./lista.js";
await paginaLista(alvo, "clientes", {
  titulo, subtitulo,
  colunas: [...],            // sobrepõe SCHEMA.colunas
  filtrosFixos: [["ativo","==",true]],
  filtrosUI: ["status","cliente_id"],   // selects gerados automaticamente
  ordem: ["nome","asc"],
  aoClicarLinha: (dado) => irPara("clientes", dado.id),
  acoesExtra: [{texto, icone, classe, onClick(dado)}],
  cardMobile: (d) => ({titulo, linha2, linha3}),
  semCriar: false
});
await abrirEditor("clientes", idOuNull, { aoSalvar(id){}, valoresIniciais:{} });
```

## js/views/scanner.js
```js
import { abrirScanner } from "./scanner.js";
abrirScanner({ titulo, aoLer: async (codigo, fechar) => {}, permitirManual: true });
// Resolve QR/patrimônio -> ativo:
import { acharAtivoPorCodigo } from "./scanner.js";
const ativo = await acharAtivoPorCodigo("NEWPC-000123"); // busca patrimonio_newpc, serial, service tag, patrim. fornecedor
```

## js/router.js
```js
irPara(rota, id, params)  parseHash() -> {rota,id,sub,params}
```

## Regras inegociáveis
1. Não gerar dados fictícios. Nenhum número inventado em dashboard — tudo consultado.
2. Não carregar coleção `ativos` inteira. Sempre paginar (`parametros().paginaTamanho`).
3. Nunca sobrescrever localização/propriedade sem histórico (o store já faz; não contorne).
4. Não misturar `fornecedor_id` (dono) com `cliente_id` (onde está instalado).
5. Não misturar `contratos_fornecedor` (locação de terceiro) com `contratos_cliente` (contrato comercial).
6. Esconder campos `financeiro:true` de TECNICO e ANALISTA (o form já faz isso).
7. Mobile: usar `.lista-cards` além da tabela; botões de campo com `.btn-campo`.
8. Português do Brasil em toda a interface. Sem jargão técnico em mensagem de usuário.
