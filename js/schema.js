/* NEWPC INVENTÁRIO — Schema declarativo das entidades
 * O CRUD é dirigido por este arquivo. Adicionar um campo aqui já o faz aparecer
 * no formulário, na listagem, na exportação e na auditoria. Sem duplicar código de tela.
 *
 * Tipos: text | textarea | number | money | int | date | select | ref | bool | cnpj | tel | email | uf
 * ref: { ref: "colecao", refLabel: "campo_exibido", filtroPor: "campo_pai" }
 */
import * as C from "./config.js";

const opt = lista => lista.map(x => (typeof x === "string" ? { v: x, label: x } : x));

export const SCHEMA = {

  /* ---------------- FORNECEDORES ---------------- */
  fornecedores: {
    label: "Fornecedor", plural: "Fornecedores", icone: "truck",
    permVer: "fornecedor.ver", permEditar: "fornecedor.editar",
    rotulo: d => d.nome_fantasia || d.razao_social,
    busca: ["razao_social", "nome_fantasia", "cnpj"],
    colunas: ["razao_social", "nome_fantasia", "cnpj", "cidade", "uf", "ativo"],
    campos: [
      { n: "razao_social",  l: "Razão Social",  t: "text", req: true, grid: 2 },
      { n: "nome_fantasia", l: "Nome Fantasia", t: "text", req: true },
      { n: "cnpj",          l: "CNPJ",          t: "cnpj" },
      { n: "contato",       l: "Contato",       t: "text" },
      { n: "telefone",      l: "Telefone",      t: "tel" },
      { n: "email",         l: "E-mail",        t: "email" },
      { n: "endereco",      l: "Endereço",      t: "text", grid: 2 },
      { n: "cidade",        l: "Cidade",        t: "text" },
      { n: "uf",            l: "UF",            t: "uf" },
      { n: "observacoes",   l: "Observações",   t: "textarea", grid: 2 },
      { n: "ativo",         l: "Ativo",         t: "bool", def: true }
    ]
  },

  /* ---------------- CONTRATOS DE FORNECEDOR (locações de terceiros) ---------------- */
  contratos_fornecedor: {
    label: "Contrato de Fornecedor", plural: "Locações de Terceiros", icone: "file-lock",
    permVer: "contrato.ver", permEditar: "contrato.editar",
    rotulo: d => d.codigo_interno || d.numero_contrato,
    busca: ["codigo_interno", "numero_contrato", "descricao"],
    colunas: ["codigo_interno", "fornecedor_id", "numero_contrato", "data_fim", "quantidade_prevista", "status"],
    campos: [
      { n: "fornecedor_id",  l: "Fornecedor", t: "ref", ref: "fornecedores", req: true },
      { n: "codigo_interno", l: "Código interno (ex.: Aventis 01)", t: "text", req: true,
        hint: "Identificação da operação. Nunca misture equipamentos de operações distintas." },
      { n: "numero_contrato", l: "Número do contrato", t: "text" },
      { n: "descricao",      l: "Descrição",      t: "textarea", grid: 2 },
      { n: "data_inicio",    l: "Data inicial",   t: "date", req: true },
      { n: "data_fim",       l: "Data final",     t: "date" },
      { n: "prazo_meses",    l: "Prazo (meses)",  t: "int" },
      { n: "valor_mensal",   l: "Valor mensal total", t: "money", financeiro: true },
      { n: "quantidade_prevista", l: "Qtd. prevista de equipamentos", t: "int" },
      { n: "status",         l: "Status", t: "select", opcoes: C.STATUS_CONTRATO_FORNECEDOR, req: true, def: "ATIVO" },
      { n: "observacoes",    l: "Observações", t: "textarea", grid: 2 }
    ]
  },

  /* ---------------- CLIENTES ---------------- */
  clientes: {
    label: "Cliente", plural: "Clientes", icone: "building",
    permVer: "cliente.ver", permEditar: "cliente.editar",
    rotulo: d => d.nome_fantasia || d.razao_social,
    busca: ["razao_social", "nome_fantasia", "cnpj"],
    colunas: ["razao_social", "tipo", "municipio_nome", "uf", "responsavel", "ativo"],
    campos: [
      { n: "razao_social",  l: "Razão Social",  t: "text", req: true, grid: 2 },
      { n: "nome_fantasia", l: "Nome Fantasia", t: "text" },
      { n: "cnpj",          l: "CNPJ",          t: "cnpj" },
      { n: "tipo",          l: "Tipo de cliente", t: "select", opcoes: opt(C.TIPO_CLIENTE), req: true },
      { n: "esfera",        l: "Esfera",        t: "select", opcoes: opt(C.ESFERA) },
      { n: "municipio_id",  l: "Município",     t: "ref", ref: "municipios", req: true },
      { n: "endereco",      l: "Endereço",      t: "text", grid: 2 },
      { n: "uf",            l: "UF",            t: "uf" },
      { n: "responsavel",   l: "Responsável",   t: "text" },
      { n: "telefone",      l: "Telefone",      t: "tel" },
      { n: "email",         l: "E-mail",        t: "email" },
      { n: "observacoes",   l: "Observações",   t: "textarea", grid: 2 },
      { n: "ativo",         l: "Ativo",         t: "bool", def: true }
    ]
  },

  /* ---------------- MUNICÍPIOS ---------------- */
  municipios: {
    label: "Município", plural: "Municípios", icone: "map",
    permVer: "cliente.ver", permEditar: "cliente.editar",
    rotulo: d => `${d.nome}/${d.uf}`,
    busca: ["nome", "uf"],
    colunas: ["nome", "uf", "ativo"],
    campos: [
      { n: "nome",  l: "Nome", t: "text", req: true },
      { n: "uf",    l: "UF",   t: "uf",   req: true },
      { n: "ativo", l: "Ativo", t: "bool", def: true }
    ]
  },

  /* ---------------- UNIDADES ---------------- */
  unidades: {
    label: "Unidade", plural: "Unidades", icone: "school",
    permVer: "unidade.ver", permEditar: "unidade.editar",
    rotulo: d => d.nome,
    busca: ["nome", "bairro", "endereco"],
    colunas: ["nome", "cliente_id", "municipio_id", "tipo", "responsavel", "ativo"],
    campos: [
      { n: "cliente_id",   l: "Cliente",    t: "ref", ref: "clientes",   req: true },
      { n: "municipio_id", l: "Município",  t: "ref", ref: "municipios", req: true },
      { n: "nome",         l: "Nome da unidade", t: "text", req: true, grid: 2 },
      { n: "tipo",         l: "Tipo",       t: "select", opcoes: opt(C.TIPO_UNIDADE) },
      { n: "endereco",     l: "Endereço",   t: "text", grid: 2 },
      { n: "bairro",       l: "Bairro",     t: "text" },
      { n: "cep",          l: "CEP",        t: "text" },
      { n: "responsavel",  l: "Responsável", t: "text" },
      { n: "telefone",     l: "Telefone",   t: "tel" },
      { n: "latitude",     l: "Latitude",   t: "number" },
      { n: "longitude",    l: "Longitude",  t: "number" },
      { n: "observacoes",  l: "Observações", t: "textarea", grid: 2 },
      { n: "ativo",        l: "Ativo",      t: "bool", def: true }
    ]
  },

  /* ---------------- SETORES ---------------- */
  setores: {
    label: "Setor", plural: "Setores", icone: "layers",
    permVer: "unidade.ver", permEditar: "unidade.editar",
    rotulo: d => d.nome,
    busca: ["nome"],
    colunas: ["nome", "unidade_id", "descricao"],
    campos: [
      { n: "unidade_id", l: "Unidade",  t: "ref", ref: "unidades", req: true },
      { n: "nome",       l: "Nome",     t: "text", req: true },
      { n: "descricao",  l: "Descrição", t: "text", grid: 2 }
    ]
  },

  /* ---------------- LOCAIS (sala/ambiente) ---------------- */
  locais: {
    label: "Local", plural: "Locais", icone: "door",
    permVer: "unidade.ver", permEditar: "unidade.editar",
    rotulo: d => d.nome,
    busca: ["nome"],
    colunas: ["nome", "setor_id", "andar", "descricao"],
    campos: [
      { n: "setor_id",  l: "Setor",    t: "ref", ref: "setores", req: true },
      { n: "nome",      l: "Nome",     t: "text", req: true },
      { n: "andar",     l: "Andar",    t: "text" },
      { n: "descricao", l: "Descrição", t: "text", grid: 2 }
    ]
  },

  /* ---------------- CONTRATOS COM CLIENTES ---------------- */
  contratos_cliente: {
    label: "Contrato com Cliente", plural: "Contratos", icone: "file-signature",
    permVer: "contrato.ver", permEditar: "contrato.editar",
    rotulo: d => d.numero_contrato,
    busca: ["numero_contrato", "objeto"],
    colunas: ["numero_contrato", "cliente_id", "modalidade", "data_fim", "quantidade_prevista", "status"],
    campos: [
      { n: "cliente_id",      l: "Cliente", t: "ref", ref: "clientes", req: true },
      { n: "numero_contrato", l: "Número do contrato", t: "text", req: true },
      { n: "objeto",          l: "Objeto", t: "textarea", grid: 2 },
      { n: "modalidade",      l: "Modalidade", t: "select", opcoes: opt([
          "Pregão Eletrônico","Pregão Presencial","Concorrência","Dispensa","Inexigibilidade",
          "Adesão a Ata","Credenciamento","Contrato Privado","Outro"]) },
      { n: "data_inicio",     l: "Data início", t: "date", req: true },
      { n: "data_fim",        l: "Data fim",    t: "date" },
      { n: "valor_global",    l: "Valor global",  t: "money", financeiro: true },
      { n: "valor_mensal",    l: "Valor mensal",  t: "money", financeiro: true },
      { n: "quantidade_prevista", l: "Qtd. prevista", t: "int" },
      { n: "gestor_contrato", l: "Gestor do contrato", t: "text" },
      { n: "fiscal_contrato", l: "Fiscal do contrato", t: "text" },
      { n: "status",          l: "Status", t: "select", opcoes: C.STATUS_CONTRATO_CLIENTE, req: true, def: "ATIVO" },
      { n: "observacoes",     l: "Observações", t: "textarea", grid: 2 }
    ]
  },

  /* ---------------- ATIVOS ---------------- */
  ativos: {
    label: "Ativo", plural: "Ativos", icone: "cpu",
    permVer: "ativo.ver", permEditar: "ativo.editar",
    rotulo: d => d.patrimonio_newpc,
    busca: ["patrimonio_newpc", "numero_serie", "service_tag", "patrimonio_fornecedor", "patrimonio_cliente", "modelo", "fabricante"],
    unicos: ["patrimonio_newpc", "numero_serie"],
    colunas: ["patrimonio_newpc", "categoria", "fabricante", "modelo", "numero_serie", "cliente_id", "unidade_id", "status"],
    grupos: [
      { titulo: "Identificação", campos: ["patrimonio_newpc","categoria","subcategoria","fabricante","modelo","numero_serie","service_tag","patrimonio_fornecedor","patrimonio_cliente","descricao"] },
      { titulo: "Configuração",  campos: ["processador","memoria_ram","armazenamento","sistema_operacional","tamanho_tela","especificacoes_adicionais"] },
      { titulo: "Propriedade",   campos: ["origem_ativo","fornecedor_id","contrato_fornecedor_id"] },
      { titulo: "Alocação comercial", campos: ["cliente_id","contrato_cliente_id"] },
      { titulo: "Localização",   campos: ["municipio_id","unidade_id","setor_id","local_id"] },
      { titulo: "Situação",      campos: ["status","condicao","data_implantacao","observacoes"] }
    ],
    campos: [
      { n: "patrimonio_newpc", l: "Patrimônio NEWPC", t: "text", req: true, unico: true,
        hint: "Identificador único. Também é o conteúdo do QR Code." },
      { n: "categoria",   l: "Categoria", t: "ref", ref: "categorias", refLabel: "nome", req: true },
      { n: "subcategoria",l: "Subcategoria", t: "text" },
      { n: "fabricante",  l: "Fabricante", t: "text", req: true },
      { n: "modelo",      l: "Modelo",     t: "text", req: true },
      { n: "numero_serie",l: "Número de série", t: "text", unico: true },
      { n: "service_tag", l: "Service Tag", t: "text" },
      { n: "patrimonio_fornecedor", l: "Patrimônio do fornecedor", t: "text" },
      { n: "patrimonio_cliente",    l: "Patrimônio do cliente",    t: "text" },
      { n: "descricao",   l: "Descrição", t: "textarea", grid: 2 },

      { n: "processador", l: "Processador", t: "text" },
      { n: "memoria_ram", l: "Memória RAM", t: "text" },
      { n: "armazenamento", l: "Armazenamento", t: "text" },
      { n: "sistema_operacional", l: "Sistema operacional", t: "text" },
      { n: "tamanho_tela", l: "Tamanho da tela", t: "text" },
      { n: "especificacoes_adicionais", l: "Especificações adicionais", t: "textarea", grid: 2 },

      { n: "origem_ativo", l: "Origem / Propriedade", t: "select", opcoes: C.ORIGEM_ATIVO, req: true, def: "PROPRIO",
        hint: "Quem é DONO do equipamento. Não confundir com o cliente onde ele está instalado." },
      { n: "fornecedor_id", l: "Proprietário (fornecedor)", t: "ref", ref: "fornecedores",
        reqSe: d => ["LOCADO","COMODATO"].includes(d.origem_ativo) },
      { n: "contrato_fornecedor_id", l: "Contrato/operação de origem", t: "ref", ref: "contratos_fornecedor",
        filtroPor: "fornecedor_id",
        reqSe: d => ["LOCADO","COMODATO"].includes(d.origem_ativo) },

      { n: "cliente_id",  l: "Cliente onde está instalado", t: "ref", ref: "clientes" },
      { n: "contrato_cliente_id", l: "Contrato comercial", t: "ref", ref: "contratos_cliente", filtroPor: "cliente_id" },

      { n: "municipio_id", l: "Município", t: "ref", ref: "municipios" },
      { n: "unidade_id",   l: "Unidade",   t: "ref", ref: "unidades", filtroPor: "cliente_id" },
      { n: "setor_id",     l: "Setor",     t: "ref", ref: "setores",  filtroPor: "unidade_id" },
      { n: "local_id",     l: "Local/Sala", t: "ref", ref: "locais",  filtroPor: "setor_id" },

      { n: "status",    l: "Status",   t: "select", opcoes: C.STATUS_ATIVO,   req: true, def: "EM_ESTOQUE" },
      { n: "condicao",  l: "Condição", t: "select", opcoes: C.CONDICAO_ATIVO, def: "BOM" },
      { n: "data_implantacao", l: "Data de implantação", t: "date" },
      { n: "observacoes", l: "Observações", t: "textarea", grid: 2 }
    ]
  },

  /* ---------------- CATEGORIAS ---------------- */
  categorias: {
    label: "Categoria", plural: "Categorias", icone: "tag",
    permVer: "ativo.ver", permEditar: "config.editar",
    rotulo: d => d.nome,
    busca: ["nome"],
    colunas: ["nome", "ativo"],
    campos: [
      { n: "nome",  l: "Nome", t: "text", req: true },
      { n: "ativo", l: "Ativo", t: "bool", def: true }
    ]
  },

  /* ---------------- USUÁRIOS ---------------- */
  usuarios: {
    label: "Usuário", plural: "Usuários", icone: "users",
    permVer: "usuario.ver", permEditar: "usuario.editar",
    rotulo: d => d.nome,
    busca: ["nome", "email"],
    colunas: ["nome", "email", "cargo", "perfil", "ultimo_acesso", "ativo"],
    campos: [
      { n: "nome",     l: "Nome",     t: "text", req: true, grid: 2 },
      { n: "email",    l: "E-mail",   t: "email", req: true,
        hint: "Deve ser o mesmo e-mail cadastrado no Firebase Authentication." },
      { n: "telefone", l: "Telefone", t: "tel" },
      { n: "cargo",    l: "Cargo",    t: "text" },
      { n: "perfil",   l: "Perfil de acesso", t: "select", req: true, def: "TECNICO",
        opcoes: Object.keys(C.PERFIS).map(p => ({ v: p, label: C.PERFIL_LABEL[p] })) },
      { n: "ativo",    l: "Ativo",    t: "bool", def: true }
    ]
  }
};

/* Coleções que existem mas não têm CRUD genérico (fluxo próprio) */
export const COLECOES_FLUXO = [
  "inventarios", "inventario_itens", "movimentacoes", "recolhimentos",
  "pendencias", "ocorrencias", "historico", "auditoria", "anexos",
  "importacoes", "contadores", "parametros"
];

/* Campos financeiros: ocultos para TECNICO e ANALISTA */
export function campoVisivel(campo, perfil) {
  if (!campo.financeiro) return true;
  return ["ADMINISTRADOR", "DIRETORIA"].includes(perfil);
}

export function camposDe(entidade) { return SCHEMA[entidade]?.campos || []; }
export function campoDe(entidade, nome) { return camposDe(entidade).find(c => c.n === nome); }
