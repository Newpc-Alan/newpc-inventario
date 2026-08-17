/* NEWPC INVENTÁRIO — Configuração central e domínios de negócio
 * Toda constante de negócio vive aqui. Nenhuma view inventa valores próprios.
 */

/* ============ FIREBASE ============
 * Substitua pelos dados do seu projeto: Firebase Console > Configurações do projeto > Seus apps > Web
 * O projeto sugerido é o mesmo padrão do Hub Interno: portal-do-educador-interno
 */
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC7eUwdcfiMhzFT-GRCmUDawFfhKNPhkwc",
  authDomain:        "newpc-inventario.firebaseapp.com",
  projectId:         "newpc-inventario",
  storageBucket:     "newpc-inventario.firebasestorage.app",
  messagingSenderId: "786159112108",
  appId:             "1:786159112108:web:94fb36356f327fb2023409"
};

export const APP = {
  nome: "NEWPC INVENTÁRIO",
  subtitulo: "Gestão Inteligente de Ativos de TI",
  versao: "1.0.0",
  prefixoQR: "NEWPC-"
};

/* ============ PERFIS E PERMISSÕES ============
 * Espelha exatamente firestore.rules. Se mudar aqui, mude lá.
 * A UI usa isto para esconder botões; o Firestore usa as rules para bloquear de verdade.
 */
export const PERFIS = {
  ADMINISTRADOR: "ADMINISTRADOR",
  DIRETORIA:     "DIRETORIA",
  ANALISTA:      "ANALISTA",
  TECNICO:       "TECNICO"
};

export const PERFIL_LABEL = {
  ADMINISTRADOR: "Administrador",
  DIRETORIA:     "Diretoria",
  ANALISTA:      "Analista",
  TECNICO:       "Técnico"
};

/* Permissões atômicas. Nomeadas por recurso.ação para facilitar auditoria. */
export const PERMISSOES = {
  ADMINISTRADOR: ["*"],
  DIRETORIA: [
    "dashboard.ver", "ativo.ver", "cliente.ver", "unidade.ver", "fornecedor.ver",
    "contrato.ver", "contrato.ver_financeiro", "inventario.ver", "movimentacao.ver",
    "recolhimento.ver", "pendencia.ver", "relatorio.ver", "relatorio.exportar",
    "auditoria.ver", "aventis.ver"
  ],
  ANALISTA: [
    "dashboard.ver", "ativo.ver", "ativo.editar", "ativo.criar",
    "cliente.ver", "cliente.editar", "cliente.criar",
    "unidade.ver", "unidade.editar", "unidade.criar",
    "fornecedor.ver", "contrato.ver",
    "inventario.ver", "inventario.executar", "inventario.validar",
    "movimentacao.ver", "movimentacao.criar", "movimentacao.aprovar",
    "recolhimento.ver", "recolhimento.criar", "recolhimento.aprovar",
    "pendencia.ver", "pendencia.resolver",
    "manutencao.ver", "manutencao.editar",
    "relatorio.ver", "relatorio.exportar", "importacao.executar", "aventis.ver"
  ],
  TECNICO: [
    "dashboard.tecnico", "ativo.ver",
    "inventario.ver", "inventario.executar",
    "movimentacao.ver", "movimentacao.criar",
    "recolhimento.ver", "recolhimento.criar",
    "pendencia.ver", "unidade.ver", "cliente.ver"
  ]
};

export function podeFazer(perfil, permissao) {
  const lista = PERMISSOES[perfil] || [];
  return lista.includes("*") || lista.includes(permissao);
}

/* ============ ORIGEM / PROPRIEDADE DO ATIVO ============
 * Conceito crítico: PROPRIETÁRIO ≠ CLIENTE ONDE ESTÁ INSTALADO.
 */
export const ORIGEM_ATIVO = [
  { v: "PROPRIO",   label: "Próprio NEWPC",     exigeFornecedor: false },
  { v: "LOCADO",    label: "Locado de Terceiro", exigeFornecedor: true  },
  { v: "COMODATO",  label: "Comodato",           exigeFornecedor: true  },
  { v: "CLIENTE",   label: "Cliente",            exigeFornecedor: false },
  { v: "OUTRO",     label: "Outro",              exigeFornecedor: false }
];

/* ============ STATUS DOS ATIVOS ============ */
export const STATUS_ATIVO = [
  { v: "DISPONIVEL",             label: "Disponível",              cor: "verde"    },
  { v: "EM_ESTOQUE",             label: "Em Estoque",              cor: "azul"     },
  { v: "EM_IMPLANTACAO",         label: "Em Implantação",          cor: "azul"     },
  { v: "EM_USO",                 label: "Em Uso",                  cor: "verde"    },
  { v: "EM_TRANSFERENCIA",       label: "Em Transferência",        cor: "amarelo"  },
  { v: "EM_MANUTENCAO",          label: "Em Manutenção",           cor: "laranja"  },
  { v: "AGUARDANDO_PECA",        label: "Aguardando Peça",         cor: "laranja"  },
  { v: "RESERVA",                label: "Equipamento Reserva",     cor: "azul"     },
  { v: "AGUARDANDO_RECOLHIMENTO",label: "Aguardando Recolhimento", cor: "amarelo"  },
  { v: "EM_RECOLHIMENTO",        label: "Em Recolhimento",         cor: "amarelo"  },
  { v: "EM_TRANSITO",            label: "Em Trânsito",             cor: "amarelo"  },
  { v: "RECEBIDO_NEWPC",         label: "Recebido na NEWPC",       cor: "azul"     },
  { v: "NAO_LOCALIZADO",         label: "Não Localizado",          cor: "vermelho" },
  { v: "DEVOLVIDO_FORNECEDOR",   label: "Devolvido ao Fornecedor", cor: "cinza"    },
  { v: "BAIXADO",                label: "Baixado",                 cor: "cinza"    },
  { v: "INATIVO",                label: "Inativo",                 cor: "cinza"    }
];

/* Status que NÃO podem coexistir com alocação operacional em cliente (regra 5 e 6) */
export const STATUS_FORA_DE_OPERACAO = ["DEVOLVIDO_FORNECEDOR", "BAIXADO", "INATIVO"];
export const STATUS_BLOQUEIA_MOVIMENTACAO = ["BAIXADO"];

export const CONDICAO_ATIVO = [
  { v: "NOVO",      label: "Novo",      cor: "verde"    },
  { v: "BOM",       label: "Bom",       cor: "verde"    },
  { v: "REGULAR",   label: "Regular",   cor: "amarelo"  },
  { v: "RUIM",      label: "Ruim",      cor: "laranja"  },
  { v: "INSERVIVEL",label: "Inservível",cor: "vermelho" }
];

/* ============ CATEGORIAS (semente — administrável em Configurações) ============ */
export const CATEGORIAS_PADRAO = [
  "Desktop","Notebook","Monitor","Multifuncional","Impressora","Scanner","Tablet",
  "Chromebook","Lousa Interativa","Totem","Servidor","Switch","Roteador","Access Point",
  "Nobreak","Projetor","Carrinho de Recarga","Webcam","Headset","Teclado","Mouse","Outros"
];

/* ============ CONTRATOS ============ */
export const STATUS_CONTRATO_FORNECEDOR = [
  { v: "PLANEJAMENTO",   label: "Planejamento",         cor: "cinza"   },
  { v: "ATIVO",          label: "Ativo",                cor: "verde"   },
  { v: "PROXIMO_VENC",   label: "Próximo do vencimento",cor: "laranja" },
  { v: "ENCERRADO",      label: "Encerrado",            cor: "cinza"   },
  { v: "RENOVADO",       label: "Renovado",             cor: "azul"    },
  { v: "EM_DEVOLUCAO",   label: "Em devolução",         cor: "amarelo" }
];

export const STATUS_CONTRATO_CLIENTE = [
  { v: "PLANEJAMENTO", label: "Planejamento",          cor: "cinza"   },
  { v: "IMPLANTACAO",  label: "Implantação",           cor: "azul"    },
  { v: "ATIVO",        label: "Ativo",                 cor: "verde"   },
  { v: "SUSPENSO",     label: "Suspenso",              cor: "amarelo" },
  { v: "PROXIMO_VENC", label: "Próximo do vencimento", cor: "laranja" },
  { v: "ENCERRADO",    label: "Encerrado",             cor: "cinza"   },
  { v: "RENOVADO",     label: "Renovado",              cor: "azul"    }
];

export const TIPO_CLIENTE = ["Prefeitura","Câmara","Secretaria","Tribunal","Autarquia","Empresa privada","Escola","Outro"];
export const ESFERA = ["Municipal","Estadual","Federal","Privada"];
export const TIPO_UNIDADE = ["Escola","Secretaria","Paço Municipal","UBS","Hospital","Almoxarifado","CRAS","Creche","Biblioteca","Outro"];

/* ============ INVENTÁRIO ============ */
export const STATUS_INVENTARIO = [
  { v: "NAO_INICIADO", label: "Não iniciado", cor: "cinza"   },
  { v: "EM_ANDAMENTO", label: "Em andamento", cor: "azul"    },
  { v: "PAUSADO",      label: "Pausado",      cor: "amarelo" },
  { v: "FINALIZADO",   label: "Finalizado",   cor: "verde"   },
  { v: "EM_REVISAO",   label: "Em revisão",   cor: "laranja" },
  { v: "VALIDADO",     label: "Validado",     cor: "verde"   }
];

export const RESULTADO_ITEM = [
  { v: "CORRETO",           label: "Correto",           cor: "verde"    },
  { v: "LOCAL_DIVERGENTE",  label: "Local divergente",  cor: "laranja"  },
  { v: "DEFEITO",           label: "Defeito",           cor: "vermelho" },
  { v: "NAO_LOCALIZADO",    label: "Não localizado",    cor: "vermelho" },
  { v: "ENCONTRADO_EXTRA",  label: "Encontrado extra",  cor: "azul"     },
  { v: "CADASTRO_PENDENTE", label: "Cadastro pendente", cor: "amarelo"  },
  { v: "RECOLHIMENTO",      label: "Recolhimento necessário", cor: "amarelo" }
];

export const TIPOS_DEFEITO = [
  "Não liga","Sem vídeo","Tela quebrada","Impressão ruim","Papel atolando","Teclado",
  "Mouse","Bateria","Carregador","Rede","Wi-Fi","Dano físico","Ruído","Superaquecimento","Outro"
];

export const CRITICIDADE = [
  { v: "BAIXA",   label: "Baixa",   cor: "azul"     },
  { v: "MEDIA",   label: "Média",   cor: "amarelo"  },
  { v: "ALTA",    label: "Alta",    cor: "laranja"  },
  { v: "CRITICA", label: "Crítica", cor: "vermelho" }
];

/* ============ MOVIMENTAÇÕES ============ */
export const TIPO_MOVIMENTACAO = [
  { v: "IMPLANTACAO",       label: "Implantação"           },
  { v: "TRANSFERENCIA",     label: "Transferência"         },
  { v: "SUBSTITUICAO",      label: "Substituição"          },
  { v: "RECOLHIMENTO",      label: "Recolhimento"          },
  { v: "ENTRADA_ESTOQUE",   label: "Entrada em estoque"    },
  { v: "SAIDA_ESTOQUE",     label: "Saída de estoque"      },
  { v: "ENVIO_MANUTENCAO",  label: "Envio para manutenção" },
  { v: "RETORNO_MANUTENCAO",label: "Retorno de manutenção" },
  { v: "DEVOLUCAO_FORNEC",  label: "Devolução ao fornecedor" },
  { v: "BAIXA",             label: "Baixa"                 }
];

export const STATUS_MOVIMENTACAO = [
  { v: "PENDENTE",  label: "Pendente de aprovação", cor: "amarelo" },
  { v: "APROVADA",  label: "Aprovada",              cor: "verde"   },
  { v: "REJEITADA", label: "Rejeitada",             cor: "vermelho"},
  { v: "EFETIVADA", label: "Efetivada",             cor: "verde"   },
  { v: "CANCELADA", label: "Cancelada",             cor: "cinza"   }
];

/* ============ RECOLHIMENTOS ============ */
export const MOTIVO_RECOLHIMENTO = [
  "Fim de contrato","Substituição","Defeito","Equipamento excedente",
  "Solicitação do cliente","Devolução ao fornecedor","Outro"
];

export const FLUXO_RECOLHIMENTO = [
  { v: "AGUARDANDO", label: "Aguardando Recolhimento", cor: "amarelo" },
  { v: "RECOLHIDO",  label: "Recolhido",               cor: "azul"    },
  { v: "EM_TRANSITO",label: "Em Trânsito",             cor: "azul"    },
  { v: "RECEBIDO",   label: "Recebido NEWPC",          cor: "azul"    },
  { v: "CONFERIDO",  label: "Conferido",               cor: "verde"   }
];

export const DESTINO_POS_RECOLHIMENTO = [
  { v: "DISPONIVEL",           label: "Disponível"            },
  { v: "EM_MANUTENCAO",        label: "Manutenção"            },
  { v: "DEVOLVIDO_FORNECEDOR", label: "Devolução ao fornecedor" },
  { v: "BAIXADO",              label: "Baixa"                 }
];

/* ============ PENDÊNCIAS ============ */
export const TIPO_PENDENCIA = [
  { v: "DIVERGENCIA_LOCAL", label: "Divergência de localização" },
  { v: "DEFEITO",           label: "Defeito registrado"         },
  { v: "NAO_LOCALIZADO",    label: "Equipamento não localizado" },
  { v: "CADASTRO_PENDENTE", label: "Cadastro pendente de validação" },
  { v: "MOVIMENTACAO",      label: "Movimentação aguardando aprovação" },
  { v: "RECOLHIMENTO",      label: "Recolhimento pendente"      }
];

export const STATUS_PENDENCIA = [
  { v: "ABERTA",     label: "Aberta",     cor: "laranja" },
  { v: "EM_ANALISE", label: "Em análise", cor: "amarelo" },
  { v: "RESOLVIDA",  label: "Resolvida",  cor: "verde"   },
  { v: "DESCARTADA", label: "Descartada", cor: "cinza"   }
];

/* ============ ANEXOS ============ */
export const CATEGORIA_FOTO = ["Equipamento","Etiqueta","Número de série","Dano","Localização","Termo","Outros"];

/* ============ PARÂMETROS OPERACIONAIS (editáveis em Configurações) ============ */
export const PARAMETROS_PADRAO = {
  diasInventarioVencido: 90,          // ativo sem inventário há X dias = vencido
  diasAlertaContrato: 60,             // contrato vence em X dias = alerta
  exigirAprovacaoDivergencia: true,   // técnico não altera localização direto
  exigirGPS: false,
  qualidadeFoto: 0.72,
  larguraMaxFoto: 1600,
  paginaTamanho: 25
};

/* Mapa de cor de status -> classe CSS */
export const COR_CLASSE = {
  verde: "st-verde", azul: "st-azul", amarelo: "st-amarelo",
  laranja: "st-laranja", vermelho: "st-vermelho", cinza: "st-cinza"
};

/* Helpers de domínio */
export function labelDe(lista, valor) {
  const i = lista.find(x => (x.v ?? x) === valor);
  return i ? (i.label ?? i) : (valor || "—");
}
export function corDe(lista, valor) {
  const i = lista.find(x => (x.v ?? x) === valor);
  return COR_CLASSE[i?.cor] || "st-cinza";
}
