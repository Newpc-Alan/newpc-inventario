# NEWPC INVENTÁRIO
**Gestão Inteligente de Ativos de TI** — NEWPC Tecnologia

Aplicação web para controlar o ciclo de vida completo dos equipamentos administrados pela NEWPC:
próprios, locados de terceiros e em comodato, distribuídos entre clientes, municípios e unidades.

Stack: HTML + CSS + JavaScript puro (ES modules) · Firebase Authentication · Cloud Firestore · Cloud Storage
Hospedagem: GitHub Pages ou Firebase Hosting. Sem build, sem npm, sem framework.

---

## 1. Por que não é arquivo único

Você costuma pedir aplicação em arquivo único e isso funciona muito bem para ferramentas de uma tela.
Aqui são 18 módulos, ~7.500 linhas e 20 coleções de banco. Em arquivo único você teria três problemas:

1. **Carregamento**: o técnico no celular, em rede de escola, baixaria 500 KB para escanear um QR Code.
   Com módulos, o navegador carrega só a tela que ele abriu.
2. **Manutenção**: achar a função de divergência dentro de 7.500 linhas custa caro.
3. **Conflito de edição**: quando você começar a mexer, cada alteração toca um arquivo, não o arquivo.

Continua sendo HTML/CSS/JS puro no GitHub Pages — só está organizado em pastas. Nenhuma etapa de build.

---

## 2. Estrutura

```
index.html                     login + layout (única página)
manifest.json                  PWA — instalável no celular
icone-192.png / icone-512.png
css/newpc.css                  identidade visual NEWPC
js/
  config.js                    ⚙️ credenciais do Firebase + domínios de negócio
  schema.js                    definição declarativa das entidades (dirige os formulários)
  firebase.js                  inicialização única do SDK
  store.js                     camada de dados: CRUD, auditoria, histórico, códigos, duplicidade
  auth.js                      autenticação e sessão
  ui.js                        componentes: modal, toast, formulários, tabelas, badges
  router.js                    rotas por hash + menu por perfil
  app.js                       bootstrap, busca global, alertas
  views/
    lista.js                   CRUD genérico reaproveitado por todos os cadastros
    scanner.js                 leitura de QR pela câmera + gerador de QR para etiquetas
    inventario.js              ⭐ sessão de inventário, fluxo por exceção, finalização
    ativos.js                  listagem + ficha do ativo com 11 abas
    cadastros.js               clientes, unidades, municípios, fornecedores
    contratos.js               contratos com clientes + locações de terceiros
    movimentacoes.js           transferências e recolhimentos
    pendencias.js              divergências, não localizados, defeitos, manutenção
    dashboard.js               dashboards geral, saúde, origem, cliente, município
    home.js                    tela inicial do técnico e da gestão
    importacao.js              importador Excel/CSV com mapeamento de colunas
    relatorios.js              21 relatórios com exportação
    admin.js                   usuários, parâmetros, categorias, auditoria, integridade
firestore.rules                🔒 segurança real, no servidor
storage.rules                  🔒 regras de upload
firestore.indexes.json         índices compostos
firebase.json                  configuração de deploy
MODELO_IMPORTACAO_NEWPC.xlsx   planilha para levantamento em campo
docs/CONTRATO-API.md           especificação interna (para quem for dar manutenção)
```

---

## 3. Instalação passo a passo

### 3.1 Criar o projeto no Firebase
1. Acesse console.firebase.google.com → **Adicionar projeto** → nome `newpc-inventario`.
2. Menu **Criação → Authentication** → Começar → aba **Sign-in method** → habilite **E-mail/senha**.
3. Menu **Criação → Firestore Database** → Criar banco → **modo de produção** → região `southamerica-east1` (São Paulo).
4. Menu **Criação → Storage** → Começar → mesma região.
5. Engrenagem → **Configurações do projeto** → role até **Seus apps** → ícone `</>` → registre o app web.
   Copie o objeto `firebaseConfig`.

### 3.2 Configurar a aplicação
Abra `js/config.js` e substitua o bloco `FIREBASE_CONFIG` pelos dados copiados:

```js
export const FIREBASE_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "newpc-inventario.firebaseapp.com",
  projectId:         "newpc-inventario",
  storageBucket:     "newpc-inventario.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId:             "1:123456789012:web:abc123"
};
```

> Essa chave é pública por natureza (fica no navegador de qualquer usuário). Quem protege
> os dados são as regras do Firestore, não a chave. Por isso o passo 3.3 não é opcional.

### 3.3 Publicar as regras de segurança
Com o Firebase CLI (`npm install -g firebase-tools`):

```bash
firebase login
firebase use --add            # escolha o projeto criado
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Sem CLI: cole o conteúdo de `firestore.rules` em **Firestore → Regras** e o de `storage.rules`
em **Storage → Regras**, e crie os índices manualmente (o próprio Firebase gera o link quando faltar um).

### 3.4 Criar o primeiro usuário
1. Firebase Console → **Authentication → Users → Adicionar usuário**.
2. Informe seu e-mail (`alan@newpc.com.br`) e uma senha.
3. Abra a aplicação e faça login. Como ainda não existe nenhum usuário no banco, o sistema
   mostra a tela **Primeira configuração**: você informa nome e cargo e vira o **Administrador**.
   Só as categorias padrão de equipamento são gravadas. **Nenhum dado fictício é criado.**

### 3.5 Publicar no GitHub Pages
```bash
git init
git add .
git commit -m "NEWPC Inventário — versão inicial"
git branch -M main
git remote add origin https://github.com/Newpc-Alan/newpc-inventario.git
git push -u origin main
```
No GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

Depois, em **Firebase → Authentication → Settings → Domínios autorizados**, adicione
`newpc-alan.github.io` e o domínio próprio, se houver.

> **A câmera exige HTTPS.** GitHub Pages já serve em HTTPS. Se testar por `file://` ou HTTP,
> o scanner não abre — use a busca manual por patrimônio.

---

## 4. Primeiros passos com o sistema vazio

A base nasce zerada. A ordem que evita retrabalho:

| # | O que cadastrar | Onde | Por quê |
|---|---|---|---|
| 1 | Municípios | Cadastros → Municípios | Clientes e unidades dependem deles |
| 2 | Fornecedores (ex.: Aventis) | Cadastros → Fornecedores | Dono dos equipamentos locados |
| 3 | Contratos de locação (Aventis 01, 02, 03) | Locações de Terceiros | Separa as operações |
| 4 | Clientes | Cadastros → Clientes | Órgãos atendidos |
| 5 | Contratos comerciais | Cadastros → Contratos | Contratos da NEWPC com os clientes |
| 6 | Unidades, setores e locais | Ficha do cliente / da unidade | Onde os equipamentos ficam |
| 7 | Ativos | Importações (planilha) ou Ativos → Novo | O parque |
| 8 | Usuários | Usuários | Técnicos, analistas, diretoria |

Para o passo 7, distribua `MODELO_IMPORTACAO_NEWPC.xlsx` para a equipe de campo.
Ela tem instruções, listas suspensas e comentários explicativos em cada coluna.

---

## 5. O conceito que mais gera erro

O sistema separa três coisas que costumam virar uma só nas planilhas:

```
PROPRIETÁRIO          Aventis                    (fornecedor_id)
CONTRATO DE ORIGEM    Aventis 02                 (contrato_fornecedor_id)
        ↓ a NEWPC loca da Aventis e disponibiliza ao cliente ↓
CLIENTE               Prefeitura Municipal de X  (cliente_id)
CONTRATO COMERCIAL    Pregão 045/2025            (contrato_cliente_id)
LOCALIZAÇÃO           Escola Y / Laboratório / Sala 05
```

São campos distintos no banco e blocos distintos na tela. Um equipamento da Aventis instalado
numa prefeitura tem **proprietário Aventis** e **cliente Prefeitura** — nunca os dois no mesmo campo.

---

## 6. Perfis de acesso

| | Administrador | Diretoria | Analista | Técnico |
|---|---|---|---|---|
| Dashboards e relatórios | ✅ | ✅ | ✅ | — |
| Valores de contrato | ✅ | ✅ | — | — |
| Cadastrar fornecedor / contrato | ✅ | — | — | — |
| Cadastrar cliente / unidade / setor | ✅ | — | ✅ | — |
| Cadastrar e editar ativo | ✅ | — | ✅ | — |
| Executar inventário | ✅ | — | ✅ | ✅ |
| Validar divergência | ✅ | — | ✅ | — |
| Aprovar movimentação | ✅ | — | ✅ | — |
| Solicitar transferência / recolhimento | ✅ | — | ✅ | ✅ |
| Importar planilha | ✅ | — | ✅ | — |
| Gerenciar usuários e parâmetros | ✅ | — | — | — |
| Ver auditoria | ✅ | ✅ | — | — |

Isso vale **nos dados**, não só na tela: um técnico que tente gravar em `contratos_cliente`
pelo console do navegador recebe `permission-denied` do Firestore.

Para cadastrar um usuário: crie no **Firebase Authentication** e depois em **Usuários** com o
mesmo e-mail. O sistema vincula os dois no primeiro login.

---

## 7. Como o inventário funciona em campo

O princípio é **trabalhar por exceção**. Equipamento no lugar certo não gera formulário.

```
ESCANEAR QR  →  card com os dados  →  ENCONTRADO E CORRETO  →  próximo
```

Isso leva poucos segundos e grava automaticamente data, hora, usuário, unidade, setor,
local, resultado e GPS (quando o técnico autoriza). Nenhum campo é digitado.

Os outros cinco botões só aparecem para as exceções:

- **LOCAL DIFERENTE** — compara o local cadastrado com o encontrado, pede justificativa e foto.
  Dependendo do parâmetro *Exigir aprovação de divergência*, o técnico registra a divergência
  e o analista decide, ou a localização é atualizada na hora.
- **COM DEFEITO** — 15 tipos pré-definidos, criticidade, foto. Abre ocorrência e pendência.
- **TRANSFERIDO** — o equipamento saiu daqui e o técnico sabe para onde foi.
- **SEM USO** — está no local mas parado.
- **RECOLHER** — entra na fila de recolhimento.

Na finalização, o sistema lista **um a um** os equipamentos não escaneados. O técnico pode
desmarcar os que ainda vai procurar. Os confirmados viram *não localizados neste inventário* —
**não** viram perda. Classificar como perda definitiva é ato exclusivo do administrador,
com justificativa e dupla confirmação.

---

## 8. Rastreabilidade

Nada é sobrescrito sem deixar rastro:

- **Histórico do ativo** (`/historico`) — linha do tempo de cadastro, inventários, mudanças de
  localização e status, defeitos, recolhimentos. Append-only.
- **Auditoria** (`/auditoria`) — campo a campo, valor anterior e novo, para patrimônio, série,
  propriedade, fornecedor, contrato, cliente, localização, status e exclusões. Imutável,
  inclusive para o administrador — as regras negam `update` e `delete`.
- **Exclusão física de ativo é proibida.** Registros com histórico vinculado só podem ser inativados.

---

## 9. Manutenção e escala

- **Paginação em tudo.** Nenhuma tela carrega a coleção de ativos inteira.
- **Coleções referenciais em cache** (2 min) — clientes, unidades, fornecedores. Milhares de
  ativos, centenas de referências: o custo fica nas referências, que são poucas.
- **Contagens via `getCountFromServer`** — o Firestore conta no servidor e devolve o número,
  sem trafegar documentos. É o que permite o dashboard responder rápido com 40 mil ativos.
- **Índices**: `firestore.indexes.json` cobre as consultas conhecidas. Se aparecer erro de índice
  ausente, a tela mostra um aviso e o console do navegador traz o link direto para criá-lo.
- **Custo estimado no plano Blaze**: com ~10 mil ativos e uso diário de 10 técnicos, a operação
  fica na casa de poucos dólares/mês. As leituras de dashboard são o item mais caro — se crescer,
  o caminho é gravar contadores agregados via Cloud Function, não otimizar as telas.

---

## 10. Limitações conhecidas

Ditas com clareza para não virar surpresa:

1. **Não funciona offline.** O Firestore tem cache de sessão, mas não implementamos fila de
   sincronização. Numa escola sem sinal, o técnico não consegue gravar. A estrutura está pronta
   para receber isso depois (todo item de inventário é um documento independente e idempotente),
   mas **hoje não existe** — e preferi dizer isso a fingir que funciona.
2. **Busca por prefixo.** O Firestore não faz busca "contém". A busca global encontra por início
   do patrimônio, série ou service tag. Para busca textual completa seria preciso Algolia ou
   Typesense — vale a pena só se virar necessidade real.
3. **A ficha do ativo não recebe atualização em tempo real** de outros usuários; é preciso recarregar.
4. **Exclusão de usuário** remove só o documento de permissões. A conta no Firebase Authentication
   precisa ser removida no console. Inativar o usuário já bloqueia o acesso.

---

## 11. Roadmap sugerido

**Fase 1 — Colocar em produção (agora)**
Configurar Firebase, publicar regras, cadastrar a estrutura, levantar o parque Aventis pela planilha,
imprimir etiquetas com QR, treinar dois técnicos numa unidade piloto.

**Fase 2 — Ajuste fino (após o piloto)**
Corrigir os atritos que aparecerem em campo. É aqui que se descobre o que a especificação não previu.

**Fase 3 — Offline real**
Service worker + IndexedDB com fila de sincronização. Só depois que o fluxo online estiver estável.

**Fase 4 — Integrações**
Chamados técnicos (a coleção `ocorrencias` já está preparada), notificações por e-mail via Cloud
Functions, e a ponte com o Portal do Educador.

---

## 12. Suporte

Dúvidas sobre a arquitetura interna: `docs/CONTRATO-API.md` documenta todas as funções disponíveis
para quem for dar manutenção ou estender o sistema.

NEWPC Tecnologia · Campo Grande/MS
