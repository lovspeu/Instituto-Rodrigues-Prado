# DIAGNÓSTICO DE REPAGINAÇÃO E REFATORAÇÃO
## Sistema Instituto Rodrigues Prado

> **Documento da FASE 1 — Auditoria Completa**
> Data da auditoria: 2026-07-13
> Commit auditado: `5cf0f9e` (branch `main`)
> Branch de trabalho: `refatoracao-completa`
> Tag de rollback: `backup-pre-refatoracao-2026-07-13`

Este documento registra **todos os problemas identificados** na leitura integral do
sistema, com: descrição, gravidade, módulo afetado, causa provável, solução planejada,
risco, impacto, forma de testar e status. Nenhum código foi alterado antes desta auditoria.

**Legenda de gravidade:** 🔴 Crítico · 🟠 Alto · 🟡 Médio · 🔵 Baixo · 🟢 Melhoria
**Legenda de status:** ⬜ Pendente · 🟨 Em andamento · ✅ Concluído · ⏸️ Requer ação do usuário

---

## 0. VISÃO GERAL DA ARQUITETURA ATUAL

| Item | Situação encontrada |
|------|---------------------|
| **Backend** | `server.js` único, **3.043 linhas**, sem separação em camadas |
| **Frontend** | `app.js` (**~2.900 linhas / 101 KB**), `index.html` (1.420 linhas), `style.css` (61 KB) |
| **Banco de dados** | **Duas fontes simultâneas**: SQLite (`database.db`) e Supabase (PostgreSQL) |
| **Fonte real dos dados** | **Supabase** — 100% das rotas da API usam `supabase.from(...)` |
| **SQLite** | **Código morto** — cria tabelas e semeia usuários, mas nenhuma rota lê dele |
| **WhatsApp** | Baileys (`@whiskeysockets/baileys`) com `auth_info_baileys/` |
| **Pasta `.wwebjs_auth/`** | **Legado morto** do antigo `whatsapp-web.js` (não é mais usado) |
| **Pagamentos** | PagBank (PagSeguro) — geração de boletos, ambiente `sandbox` |
| **Tempo real** | Socket.IO com evento único genérico `atualizarSistema` |
| **Relatórios** | Duplicados: **PDFKit no backend** + **jsPDF no frontend** |
| **Deploy** | Render (deploy automático via push no GitHub) |
| **Autenticação** | Inexistente no servidor; frontend confia em `localStorage` |

### Mapa de funcionalidades (todas preservadas na refatoração)
Login · Primeiro acesso · Troca de senha · Dashboard · Responsáveis (clientes) ·
Alunos · Financeiro · Mensalidades · Cobranças (central) · Boletos (PagBank + importação manual) ·
WhatsApp (conexão, QR, envio, fila em massa) · Relatórios (financeiro, alunos, mensalidades) ·
Configurações · Modo censura · Atualização em tempo real · Uploads · Migração de boletos.

---

## 1. SEGURANÇA 🔴

### SEG-01 — Segredos versionados e enviados ao GitHub 🔴 ⏸️
- **Descrição:** `.env` (token PagBank), sessão completa do WhatsApp (`.wwebjs_auth/`, 246 arquivos), `database.db` (2 cópias) e 64 PDFs (boletos/relatórios com dados pessoais) estão **commitados e publicados** em `origin/main`.
- **Módulo:** repositório Git inteiro.
- **Causa provável:** `.gitignore` gravado em **UTF-16** (ilegível pelo Git) + typo `.webjs_auth/` em vez de `.wwebjs_auth/`.
- **Solução planejada:** (1) reescrever `.gitignore` em UTF-8; (2) `git rm --cached` dos arquivos sensíveis; (3) **reescrever o histórico** (git filter-repo/BFG) para expurgar segredos; (4) **rotacionar credenciais** e **invalidar a sessão do WhatsApp**.
- **Risco:** Alto — reescrita de histórico exige `--force` e coordenação com o Render. Requer ação manual do usuário para rotacionar tokens.
- **Impacto:** Elimina vazamento ativo de credenciais e dados pessoais (LGPD).
- **Como testar:** `git ls-files` não deve listar `.env`, `.wwebjs_auth`, `database.db`, `*.pdf`; verificar no GitHub que os arquivos sumiram do histórico.
- **Status:** ⏸️ Requer decisão/ação do usuário (ver `GUIA_DE_SEGURANCA.md`).

### SEG-02 — Senhas em texto puro 🔴
- **Descrição:** Login compara `senha` diretamente no banco (`.eq('senha', senha)`); usuários semeados com senha `1234`. Sem hash.
- **Módulo:** `server.js` (`POST /api/login`, `PATCH /api/usuarios/senha`), tabela `usuarios`.
- **Causa:** Ausência de camada de segurança de credenciais.
- **Solução:** Migrar para **bcrypt** (hash + verify), com migração segura dos usuários atuais e política mínima de senha. Fluxo de primeiro acesso preservado.
- **Risco:** Médio — exige migração cuidadosa para não travar login existente.
- **Impacto:** Senhas deixam de ser legíveis mesmo com acesso ao banco.
- **Como testar:** login correto/incorreto; conferir que `usuarios.senha` guarda hash `$2b$...`.
- **Status:** ⬜ Pendente.

### SEG-03 — Login retorna o objeto inteiro do usuário (inclui `senha`) 🔴
- **Descrição:** `res.json({ usuario: { ...usuarioEncontrado } })` devolve o hash/senha ao frontend, que o grava em `localStorage`.
- **Módulo:** `server.js:668`, `app.js:408`.
- **Solução:** Retornar apenas campos públicos (`usuario`, `nome`, `primeiroAcesso`). Nunca serializar senha.
- **Risco:** Baixo.
- **Impacto:** Remove exposição de credencial no cliente.
- **Como testar:** inspecionar resposta de `/api/login` e `localStorage`.
- **Status:** ⬜ Pendente.

### SEG-04 — Autenticação apenas no `localStorage` 🔴
- **Descrição:** Frontend considera logado se `localStorage.logado === 'true'`. Qualquer um define isso no DevTools e "entra".
- **Módulo:** `app.js:331-436, 3738`.
- **Solução:** Sessão real via **JWT em cookie `HttpOnly` + `Secure` + `SameSite`**; `verificarLogin` passa a consultar `GET /api/auth/me`.
- **Risco:** Médio.
- **Impacto:** Autenticação real.
- **Como testar:** limpar cookies → sistema bloqueia; manipular localStorage não concede acesso.
- **Status:** ⬜ Pendente.

### SEG-05 — Nenhuma rota da API é protegida 🔴
- **Descrição:** Todas as rotas (`/api/clientes`, `/api/financeiro`, `/api/boletos`, `/api/admin/*`, etc.) são **públicas**. Sem middleware de auth.
- **Módulo:** `server.js` (todas as rotas).
- **Solução:** Middleware `requireAuth` em todas as rotas privadas; separar públicas (`/api/login`, `/ping`) de privadas e administrativas (`requireAdmin` para `/api/admin/*`, reset de envios, configurações críticas).
- **Risco:** Médio — precisa cobrir 100% das rotas sem quebrar o frontend.
- **Impacto:** Impede leitura/escrita anônima de todos os dados.
- **Como testar:** chamar rotas sem cookie → 401.
- **Status:** ⬜ Pendente.

### SEG-06 — Senha do modo censura fixa no frontend 🔴
- **Descrição:** `const senhaCorreta = 'institutocensurado';` no `app.js:68`. Visível a qualquer um.
- **Módulo:** `app.js:66-108`.
- **Solução:** Controlar modo censura por **sessão/permissão no servidor**; remover senha do cliente.
- **Risco:** Baixo.
- **Impacto:** Censura deixa de ser burlável.
- **Como testar:** censura só alterna com sessão autorizada.
- **Status:** ⬜ Pendente.

### SEG-07 — CORS e Socket.IO aceitam qualquer origem 🟠
- **Descrição:** `app.use(cors())` (aberto) e `io = new Server(server, { cors:{ origin:'*' } })`.
- **Módulo:** `server.js:25-31`.
- **Solução:** Restringir a `ALLOWED_ORIGINS` (env); autenticar handshake do Socket.IO por cookie de sessão.
- **Risco:** Baixo (atenção para não bloquear o domínio do Render).
- **Impacto:** Reduz superfície de CSRF/abuso.
- **Status:** ⬜ Pendente.

### SEG-08 — Sem Helmet / cabeçalhos de segurança 🟠
- **Descrição:** Nenhum header de segurança (CSP, X-Frame-Options, HSTS, etc.).
- **Módulo:** `server.js` (bootstrap Express).
- **Solução:** Adicionar `helmet` com CSP compatível com os CDNs usados (ou self-host dos assets).
- **Risco:** Médio — CSP mal configurada quebra CDNs (jsPDF, FontAwesome).
- **Status:** ⬜ Pendente.

### SEG-09 — Boletos em bucket **público** do Supabase 🟠
- **Descrição:** `createBucket('Boletos', { public:true })`; URLs públicas de boletos com dados pessoais.
- **Módulo:** `server.js:188-219`.
- **Solução:** Avaliar bucket privado + URLs assinadas de curta duração. **Preservar compatibilidade** com boletos já emitidos.
- **Risco:** Alto — mudar acesso pode quebrar links já enviados por WhatsApp.
- **Status:** ⬜ Pendente (migração compatível).

### SEG-10 — Logs vazam dados sensíveis 🟠
- **Descrição:** `console.log` do payload PagBank (nome, CPF, e-mail), início do token (`TOKEN INICIO`), resposta bruta do PagBank, QR.
- **Módulo:** `server.js:56,634-637,1806-1824,2823...`.
- **Solução:** Logger estruturado (pino) com níveis; **nunca** logar CPF/token/payload; mascarar dados pessoais.
- **Risco:** Baixo.
- **Status:** ⬜ Pendente.

### SEG-11 — Sem rate limit, sem limites de JSON/upload, sem validação de MIME real 🟠
- **Descrição:** Login sem rate limit (brute force). `express.json()` sem `limit`. Upload de boleto (`multer`) sem validar tamanho/MIME/extensão de forma robusta.
- **Módulo:** `server.js:32-33,185,500`.
- **Solução:** `express-rate-limit` no login e rotas sensíveis; `limit:'1mb'` no JSON; validar MIME + extensão + tamanho e sanitizar nomes de arquivo.
- **Risco:** Baixo.
- **Status:** ⬜ Pendente.

### SEG-12 — Rota administrativa destrutiva sem proteção 🟠
- **Descrição:** `PATCH /api/cobrancas/reset-whatsapp` com `.neq('id',0)` **zera o envio de todas as cobranças**; `POST /api/admin/migrar-boletos` também é aberta.
- **Módulo:** `server.js:1573,1650`.
- **Solução:** Exigir `requireAdmin`; confirmar operação.
- **Status:** ⬜ Pendente.

---

## 2. BANCO DE DADOS 🟠

### DB-01 — SQLite e Supabase coexistindo sem separação 🟠
- **Descrição:** `server.js` inicializa SQLite (`new sqlite3.Database`), cria 9 tabelas e semeia `usuarios`, mas **nenhuma rota consulta o SQLite** — tudo é Supabase. Helpers `all()`/`run()` definidos e nunca usados.
- **Módulo:** `server.js:13,50,59-180,221-237`; dep `sqlite3`.
- **Causa:** Migração incompleta de SQLite → Supabase.
- **Solução:** Confirmar (grep) que nada lê do SQLite, remover inicialização, helpers, `database.db`, `database/database.db` e a dependência `sqlite3`. **Supabase é a fonte oficial.**
- **Risco:** Baixo — é código morto; validar antes de remover.
- **Como testar:** sistema sobe e funciona sem `sqlite3`.
- **Status:** ⬜ Pendente (Fase 6).

### DB-02 — `.select('*')` em todas as consultas 🟡
- **Descrição:** Todas as rotas usam `select('*')`, inclusive `usuarios` (traz senha) e tabelas grandes.
- **Solução:** Selecionar apenas campos necessários por consulta.
- **Status:** ⬜ Pendente.

### DB-03 — Sem filtro/paginação no servidor 🟡
- **Descrição:** `/api/financeiro`, `/api/cobrancas`, `/api/pagamentosMensais`, etc. retornam a tabela inteira; filtragem/cálculo acontece no navegador.
- **Solução:** Filtrar por mês/ano/status/responsável no servidor; paginação em listas grandes; endpoint específico de indicadores para o Dashboard.
- **Status:** ⬜ Pendente (Fases 6–7).

### DB-04 — Índices ausentes em campos muito consultados 🟡
- **Descrição:** Consultas frequentes por `referencia`, `alunoid`, `responsavel_id`, `mes`, `ano`, `status`, `whatsapp_enviado`, `cpf`, `telefone` sem índice conhecido.
- **Solução:** Criar índices **após analisar as consultas reais** (migração Supabase documentada, não destrutiva).
- **Status:** ⬜ Pendente.

### DB-05 — Inconsistência camelCase (API) × lowercase (Postgres) 🟡
- **Descrição:** Cada rota remapeia manualmente `alunoid→alunoId`, `mesmatricula→mesMatricula`, `criadoem→criadoEm`, etc. Frágil e repetitivo.
- **Solução:** Centralizar mapeamento em repositories/serializers.
- **Status:** ⬜ Pendente.

### DB-06 — IDs gerados por `Date.now()` no cliente/servidor 🟡
- **Descrição:** `id: Date.now()` para clientes, alunos, cobranças, boletos. Risco de colisão e de IDs previsíveis.
- **Solução:** Avaliar `identity`/`uuid` no Postgres (migração compatível, sem quebrar dados atuais).
- **Status:** ⬜ Pendente (avaliar risco).

---

## 3. BACKEND / ARQUITETURA 🟠

### BE-01 — `server.js` monolítico (3.043 linhas) 🟠
- **Descrição:** Rotas, regras de negócio, PDF, WhatsApp, PagBank, Socket.IO e bootstrap num só arquivo.
- **Solução:** Modularizar em `src/` (config, middlewares, routes, controllers, services, repositories, validators, utils) conforme Fase 5.
- **Risco:** Alto — refatoração ampla; fazer incremental preservando comportamento.
- **Status:** ⬜ Pendente (Fase 5).

### BE-02 — Funções duplicadas 🟡
- **Descrição:** `statusMensalidadeServidor` e `verificarAtrasoServidor` **definidas duas vezes** (`server.js:2007/2370` e `2023/2386`). A 2ª redefinição prevalece.
- **Solução:** Manter uma única versão em `utils/mensalidades`.
- **Status:** ⬜ Pendente.

### BE-03 — Robô do WhatsApp (`processador`) desativado — código morto 🟡
- **Descrição:** `processador`/`gerenciadorContexto` são `null`; handler `messages.upsert` sempre retorna. Funções `menuSistema`, `responderStatusSistema`, `gerarRelatorio*Sistema` ficam órfãs.
- **Módulo:** `server.js:2701-2777, 1911-2000, 2412-2699`.
- **Solução:** Decidir: remover (recomendado, já que está desligado) **ou** reativar de forma segura. Documentar antes de remover.
- **Status:** ⬜ Pendente (confirmar com usuário).

### BE-04 — Tratamento de erro repetitivo e não padronizado 🟡
- **Descrição:** Cada rota tem `try/catch` com `console.error` + `res.status(500)`. Sem handler global, sem formato de resposta padrão.
- **Solução:** `error-handler` global + respostas padronizadas `{ sucesso, dados|erro }`.
- **Status:** ⬜ Pendente.

### BE-05 — Sem timeout/retry/idempotência em integrações externas 🟡
- **Descrição:** `fetch` ao PagBank e baixa de PDF do Supabase sem timeout; sem idempotência na geração de boleto/envio de cobrança (risco de duplicar).
- **Solução:** Timeout + retry seguro + chaves de idempotência; prevenção de boleto/cobrança duplicados.
- **Status:** ⬜ Pendente.

### BE-06 — Endereço do pagador fixo (hardcode) no boleto 🟡
- **Descrição:** `holder.address` fixo (Av. Santos Dumont, Fortaleza) para todos os boletos.
- **Módulo:** `server.js:1789-1798`.
- **Solução:** Documentar regra atual; avaliar tornar configurável. **Não alterar regra financeira sem validação.**
- **Status:** ⬜ Pendente (documentar antes).

### BE-07 — `app.get('*')` sobrepõe API 404 🔵
- **Descrição:** Catch-all serve `index.html` para qualquer rota, incluindo `/api/*` inexistente (dificulta debug).
- **Solução:** Catch-all só para não-API; 404 JSON para `/api/*`.
- **Status:** ⬜ Pendente.

---

## 4. DESEMPENHO / TEMPO REAL 🟠

### PERF-01 — `carregarDados()` carrega o sistema inteiro em sequência 🟠
- **Descrição:** 9 `await apiGet(...)` **sequenciais** baixam todas as tabelas no login e a cada evento de socket.
- **Módulo:** `app.js:652-699`.
- **Solução:** Carregar só o essencial no início; carregar por aba; `Promise.all` para chamadas independentes; cache com invalidação.
- **Status:** ⬜ Pendente (Fase 7).

### PERF-02 — Evento único `atualizarSistema` re-renderiza tudo 🟠
- **Descrição:** Qualquer mutação emite `atualizarSistema` → frontend recarrega **todos os dados** e re-renderiza **todas as telas**.
- **Módulo:** `server.js:239-243`, `app.js:15-30`.
- **Solução:** Eventos por domínio `{ recurso, acao, id }`; atualizar só a tela afetada; não renderizar telas fechadas.
- **Status:** ⬜ Pendente (Fase 7).

### PERF-03 — Polling fixo de 15s na fila de cobranças 🟡
- **Descrição:** `setInterval(atualizarStatusFilaCobrancas, 15000)` roda sempre, mesmo sem fila ativa.
- **Módulo:** `app.js:3587`.
- **Solução:** Usar eventos Socket.IO (`fila-cobrancas-status`) já emitidos pelo servidor; polling só enquanto houver fila.
- **Status:** ⬜ Pendente.

### PERF-04 — Logos de ~2 MB e PDFs pesados servidos ao navegador 🟡
- **Descrição:** `assets/instituto.png` (1,9 MB), `assets/logo.png` (1,8 MB), `logo.ico` (370 KB) e vários PDFs no bundle.
- **Solução:** Converter logos para WebP redimensionado; remover PDFs de teste do frontend; carregamento eficiente.
- **Status:** ⬜ Pendente (Fase 4).

### PERF-05 — `innerHTML +=` e re-render total das listas 🟡
- **Descrição:** Renderização reconstrói o DOM inteiro por lista; uso de `innerHTML +=` com dados do usuário.
- **Solução:** Render incremental, `textContent`/templates, sanitização.
- **Status:** ⬜ Pendente (Fase 8).

---

## 5. FRONTEND 🟠

### FE-01 — `app.js` monolítico e variáveis globais 🟠
- **Descrição:** ~2.900 linhas, estado global mutável (`clientes`, `alunos`, `modoCensura`, etc.), lógica de todas as telas junta.
- **Solução:** Modularizar em `js/` (api, auth, state, socket, utils, pages) conforme Fase 8.
- **Status:** ⬜ Pendente (Fase 8).

### FE-02 — `supabase.from()` no navegador sem inicialização (código quebrado) 🟠
- **Descrição:** `gerarRelatorioWhatsapp(jid)` usa `supabase.from(...)`, mas `index.html` **não carrega** `@supabase/supabase-js` → `supabase is not defined`. Função órfã (recebe `jid`, conceito de servidor).
- **Módulo:** `app.js:3591-3600`.
- **Solução:** Remover função morta; relatórios ficam 100% no backend.
- **Status:** ⬜ Pendente.

### FE-03 — `onclick` inline por toda parte 🟡
- **Descrição:** Dezenas de `onclick="..."` no `index.html` e HTML gerado.
- **Solução:** Listeners registrados nos módulos; delegação de eventos.
- **Status:** ⬜ Pendente (Fase 8).

### FE-04 — `alert`/`confirm`/`prompt` como UI 🟡
- **Descrição:** Fluxos usam `prompt`/`alert`/`confirm` (inclusive senha da censura).
- **Solução:** Componente central de toasts + modais de confirmação.
- **Status:** ⬜ Pendente (Fases 8, 10).

### FE-05 — Risco de XSS via `innerHTML` com dados do usuário 🟠
- **Descrição:** Nomes/descrições/e-mails inseridos via template string em `innerHTML` sem sanitização.
- **Solução:** `textContent`/sanitização; formatação centralizada em utils.
- **Status:** ⬜ Pendente.

### FE-06 — Comentário/versão enganosa ("VERSÃO SQLITE + PAGBANK") 🔵
- **Descrição:** Cabeçalho do `app.js` diz SQLite, mas o sistema usa Supabase.
- **Solução:** Corrigir documentação/cabeçalhos.
- **Status:** ⬜ Pendente.

---

## 6. RELATÓRIOS 🟡

### REL-01 — Geração duplicada (PDFKit backend + jsPDF frontend) 🟡
- **Descrição:** Relatórios existem em dois lugares: `server.js` (PDFKit, para download/WhatsApp) e `app.js` (jsPDF, linhas 3095/3303/3357).
- **Solução:** Centralizar **no backend**; frontend só envia filtros e recebe o PDF. Remover jsPDF do bundle.
- **Status:** ⬜ Pendente (Fase 9).

### REL-02 — Duas versões do relatório financeiro no backend 🟡
- **Descrição:** `gerarRelatorioFinanceiroPremium` (landscape, cards, gráficos) e `gerarRelatorioFinanceiroSistema` (retrato, simples). Lógica de status/atraso repetida.
- **Solução:** Unificar em um serviço de relatórios reutilizável.
- **Status:** ⬜ Pendente.

### REL-03 — PDFs de teste versionados em `frontend/assets` 🟡
- **Descrição:** 13 PDFs de relatório (incl. cópias e um de 4 MB) no repositório/bundle.
- **Solução:** Remover do frontend e do Git.
- **Status:** ⬜ Pendente (Fase 4).

### REL-04 — Arquivo temporário em `uploads/` público durante geração 🔵
- **Descrição:** Relatório é escrito em `uploads/` (pasta servida estaticamente) antes do download e só então removido.
- **Solução:** Gerar em diretório temporário fora da pasta pública; remover após uso.
- **Status:** ⬜ Pendente.

---

## 7. LIMPEZA / RESÍDUOS 🟢

| ID | Item | Ação |
|----|------|------|
| CLEAN-01 | `.wwebjs_auth/` (246 arquivos, legado whatsapp-web.js) | Remover do projeto e do Git |
| CLEAN-02 | `database.db` e `database/database.db` | Remover após confirmar SQLite morto |
| CLEAN-03 | 13 PDFs em `frontend/assets` | Remover |
| CLEAN-04 | `uploads/boletos/*.pdf` versionados (60+) | Remover do Git (dados sensíveis) |
| CLEAN-05 | `MELHORIAS_V2.txt`, `README.md` desatualizado, `.bat` (ngrok local) | Atualizar/realocar |
| CLEAN-06 | Arquivo `senha do banco de dados supabase in.txt` (raiz externa) | **Remover — credencial em texto** ⏸️ |
| CLEAN-07 | Dep `sqlite3` no `package.json` | Remover após Fase 6 |
| CLEAN-08 | `node_modules` versionado em outra pasta do repo pai | Não versionar |

---

## 8. RESPONSIVIDADE / ACESSIBILIDADE 🟡
- **A11Y-01:** Tema atual é escuro com textos claros; validar contraste (WCAG AA) em todos os estados.
- **A11Y-02:** Faltam `label`/`aria-label`, foco visível e navegação por teclado consistentes.
- **A11Y-03:** Tabelas largas (financeiro, cobranças, mensalidades) podem quebrar layout em 360–768px.
- **A11Y-04:** Sem suporte explícito a `prefers-reduced-motion`.
- **Status:** ⬜ Pendente (Fase 11).

---

## 9. TESTES / TOOLING 🟡
- **TEST-01:** Sem testes automatizados.
- **TEST-02:** `package.json` só tem `start` (sem `dev`, `test`, `lint`, `audit`).
- **TEST-03:** 12 vulnerabilidades reportadas por `npm audit` (2 baixas, 1 moderada, 9 altas) — analisar **individualmente** (sem `--force`).
- **Status:** ⬜ Pendente (Fase 12).

---

## 10. IDENTIDADE VISUAL — INVENTÁRIO DA PALETA ATUAL 🟢
Extraído de `style.css` (`:root`) — **base para preservar a identidade azul + dourado**:

| Variável atual | Valor | Uso |
|----------------|-------|-----|
| `--bg` | `#020617` | Fundo principal (navy quase preto) |
| `--bg-2` | `#031433` | Fundo secundário (azul escuro) |
| `--card` | `rgba(15,18,28,.72)` | Cartões |
| `--gold` | `#d4af37` | Dourado principal |
| `--gold-2` | `#f5d76e` | Dourado claro (destaques) |
| `--gold-3` | `#b8860b` | Dourado escuro |
| `--blue` | `#2563eb` | Azul de ação |
| `--green` / `--red` / `--orange` | `#22c55e` / `#ef4444` / `#f59e0b` | Semânticas |
| `--text` / `--muted` | `#ffffff` / `#d1d5db` | Textos |

> **Observação:** o sistema atual é **escuro (navy) + dourado**. Na Fase 10, esses tons serão
> mantidos e padronizados; inconsistências (azuis/dourados avulsos espalhados no CSS) serão
> unificadas em variáveis. Decisão a confirmar: manter tema escuro atual ou introduzir áreas de
> conteúdo claras (o pedido cita "fundos claros quando melhorar a leitura", mas também "não usar
> paleta completamente escura" — alinhar com o usuário).

---

## RESUMO EXECUTIVO POR GRAVIDADE

| Gravidade | Qtde | IDs |
|-----------|------|-----|
| 🔴 Crítico | 6 | SEG-01, SEG-02, SEG-03, SEG-04, SEG-05, SEG-06 |
| 🟠 Alto | 12 | SEG-07..SEG-12, DB-01, BE-01, PERF-01, PERF-02, FE-01, FE-02, FE-05 |
| 🟡 Médio | ~20 | DB-02..DB-06, BE-02..BE-06, PERF-03..05, FE-03/04, REL-01..03, A11Y, TEST |
| 🔵 Baixo | 3 | BE-07, FE-06, REL-04 |
| 🟢 Melhoria | — | Limpeza, design system, identidade visual |

**Prioridade imediata (ação do usuário):** SEG-01 (rotacionar credenciais + limpar histórico) e CLEAN-06.

---

_Este arquivo é o rastreador mestre da refatoração. O campo **Status** de cada item será
atualizado ao final de cada fase._

---

## CHANGELOG DE EXECUÇÃO

### FASE 2 — Backup ✅ (2026-07-13)
- Tag de rollback `backup-pre-refatoracao-2026-07-13` (commit `5cf0f9e`).
- Branch de trabalho `refatoracao-completa`.
- `.gitignore` recriado em **UTF-8**; `.env.example` criado.

### FASE 3 — Segurança ✅ (2026-07-13)
Implementado em `server.js` + `frontend/app.js`, validado por smoke test HTTP (servidor sobe;
`/api/clientes` sem sessão → 401; rotas públicas → 200; admin → 401; headers Helmet presentes) e
por testes unitários das primitivas (bcrypt/JWT/cookie/política — 12/12 OK).

| Item | Status | O que foi feito |
|------|--------|-----------------|
| SEG-02 | ✅ | Senhas com **bcrypt** + migração transparente no login (sem lockout de usuários legados) |
| SEG-03 | ✅ | Login retorna só campos públicos (`usuario`, `nome`, `primeiroAcesso`) — nunca a senha |
| SEG-04 | ✅ | Sessão real via **JWT em cookie HttpOnly** (`Secure` em produção, `SameSite=lax`); frontend consulta `/api/auth/me` |
| SEG-05 | ✅ | **Guard global** protege todas as rotas `/api/*` exceto allowlist pública |
| SEG-06 | ✅ | Senha fixa da censura **removida** do frontend; toggle controlado por sessão |
| SEG-07 | ✅ | CORS + Socket.IO restringíveis por `ALLOWED_ORIGINS` (opt-in p/ não quebrar deploy); handshake do Socket.IO autenticado por cookie |
| SEG-08 | ✅ | **Helmet** com CSP compatível com os CDNs atuais |
| SEG-10 | ✅ | Logs de token PagBank, payload (CPF/nome/e-mail) e resposta bruta **removidos** |
| SEG-11 | 🟨 | Rate limit no login ✅ + `limit` no JSON/urlencoded ✅ · validação de MIME/tamanho de upload → pendente (Fase 4/5) |
| SEG-12 | ✅ | Rotas admin (`migrar-boletos`, `reset-whatsapp`) exigem **requireAdmin** |
| SEG-01 | ⏸️ | Rotação de credenciais + limpeza de histórico → **aguardando ação do usuário** (ver `GUIA_DE_SEGURANCA.md`) |
| SEG-09 | ⬜ | Bucket público de boletos → adiado (mudança arriscada; preservar links já enviados) |

**Dependências adicionadas:** `bcryptjs`, `jsonwebtoken`, `cookie-parser`, `helmet`, `express-rate-limit`.
**Variáveis novas (definir no Render):** `JWT_SECRET`, `ALLOWED_ORIGINS`, `NODE_ENV=production`, opcional `ADMIN_USERS`.
**Nota de ambiente:** o teste local completo (boot contra o Supabase) não é possível aqui —
Node 20 local + `@supabase/supabase-js` 2.108 exige WebSocket nativo (Node ≥22, como no Render).
Validação local feita com Supabase/qrcode mockados + testes das primitivas de segurança.

### REMOÇÃO DO PAGBANK ✅ (a pedido do usuário)
Removida toda a integração PagBank/PagSeguro. Boletos passam a ser **importados manualmente** (PDF)
na Central de Cobranças; envio por WhatsApp preservado.
- **Backend:** rota `POST /api/boletos` removida; config `PAGBANK_*` e logs removidos; banner e
  default de `origem` ajustados (→ `manual`).
- **Frontend:** funções `gerarBoletoMensalidade` (era código morto) e `gerarBoletoResponsavel`
  removidas; botões "Gerar Boleto PagBank" removidos; toggle "Modo de Cobrança" removido
  (sistema fica sempre em modo manual, box de importação sempre visível); rótulos "Gerado pela
  PagBank" → "Boleto".
- **Config/docs:** `PAGBANK_TOKEN`/`PAGBANK_ENV` removidos de `.env.example`, `render.yaml`,
  `GUIA_DE_DEPLOY.md`, `GUIA_DE_SEGURANCA.md`, `README.md`.
- **Preservado:** importação manual de boletos, envio WhatsApp, central de cobranças e **todos os
  dados no Supabase** (cobranças/boletos já existentes continuam visíveis).
- **Pendências:** revogar o token PagBank exposto (não precisa gerar novo). CSS órfão
  `.modo-cobranca-card` a limpar na fase de CSS. `BE-06` (endereço fixo do boleto) tornou-se obsoleto.

### FASE 4 — Limpeza ✅ (2026-07-13) — commit `6958cc2`
| Item | Status | Ação |
|------|--------|------|
| FE-02 | ✅ | `gerarRelatorioWhatsapp` (usava `supabase`/`PDFDocument`/`fs`/`__dirname` no browser — backend copiado por engano, quebrado, nunca chamado) removido |
| BE-02 | ✅ | Definições duplicadas de `statusMensalidadeServidor` e `verificarAtrasoServidor` no `server.js` — mantida 1 cópia de cada |
| PERF-04 | ✅ | `logo.png` 1,8 MB → **32 KB** (320×320); `instituto.png` 1,9 MB → **`instituto.webp` 74 KB**; CSS atualizado. **~3,6 MB** a menos no login |
| REL-03 | ✅ | PDFs de teste removidos de `frontend/assets` (já estavam fora do repo pelo `.gitignore`) |
| CLEAN-05 | ✅ | `MELHORIAS_V2.txt` (notas obsoletas) removido |
| BE-03 | ✅ | Robô WhatsApp desativado **removido** (decisão do usuário): `menuSistema`, `responderStatusSistema`, `enviarPdfWhatsApp`, 3× `gerarRelatorio*Sistema`, `nomeMesAtual`, vars `processador`/`gerenciadorContexto` e handler `messages.upsert` (−~400 linhas). Conexão/QR/envio de cobranças preservados; helpers do relatório ativo preservados |
| CSS órfão | ⬜ | `.modo-cobranca-card` (6 blocos) → limpar na reestruturação de CSS (Fase 8) |
| CLEAN-07 | ⬜ | `sqlite3` → remover na Fase 6 (Banco) |

**Validado:** `node --check` + smoke test HTTP (boot OK, `/api` 401, públicas 200). Originais das
imagens preservados (git history + backup no scratchpad).

### FASE 5 — Modularização do backend 🟨 EM ANDAMENTO
Técnica: mover código para `src/` e, no `server.js`, trocar a definição inline por `require`
(pontos de chamada preservados → comportamento idêntico), com **boot test a cada extração**.

| Módulo criado | Conteúdo | Commit |
|---------------|----------|--------|
| `src/config/env.js` | env + segurança (JWT, origens, admin) + origemPermitida | `712f7e7` |
| `src/config/supabase.js` | cliente Supabase | `712f7e7` |
| `src/utils/format.js` | formatarMoeda, limparNumero, detect*, referências, telefone | `712f7e7` |
| `src/utils/mensalidades.js` | status/atraso das mensalidades | `712f7e7` |
| `src/middlewares/auth.js` | token/cookie/sessão, requireAuth, requireAdmin, rate-limit | `712f7e7` |
| `src/services/relatorios.js` | desenhar* + gerarRelatorioFinanceiroPremium (PDF) | `aec8edf` |
| `src/services/realtime.js` | io + atualizarSistema | `aec8edf` |
| `src/services/boletos.js` | uploadBoleto, garantirBucket, uploadParaSupabase, encontrarResponsavelPorBoleto | `dc34762` |

**Resultado parcial:** `server.js` 3043 → **1988 linhas** (−35%).
**Falta:** `src/services/whatsapp.js` (Baileys + fila de cobranças — estado compartilhado, mais
arriscado) e split das rotas em `src/routes/*.routes.js` + `src/app.js` + entrypoint. Continuar
em incrementos verificados. Manter `server.js` na raiz (Render roda `node server.js`).
