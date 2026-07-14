# Migrações e revisão do Supabase — Fase 6

> Ações para você rodar no **Supabase → SQL Editor**. Nenhuma delas apaga dados.
> São **não destrutivas** (CREATE INDEX IF NOT EXISTS / revisões).

O Supabase é a **fonte oficial** dos dados. O SQLite foi removido do sistema (era código morto).

---

## 1. Índices recomendados (baseados nas consultas reais do código)

> Regra seguida: **só índices para colunas realmente filtradas/ordenadas** nas queries.
> Para o volume atual (instituto pequeno) o ganho é modesto, mas ajuda conforme os dados crescem
> e é boa prática. Chaves primárias (`id`) e `UNIQUE` (`usuarios.usuario`, `configuracoes.chave`)
> já são indexadas automaticamente — não precisam de índice extra.

```sql
-- Ordenações por nome (listagens de responsáveis e alunos)
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes (nome);
CREATE INDEX IF NOT EXISTS idx_alunos_nome   ON alunos (nome);

-- pagamentosmensais: filtrado por alunoid+referencia (rotas) e por referencia (relatórios)
CREATE INDEX IF NOT EXISTS idx_pagamentos_aluno_ref ON pagamentosmensais (alunoid, referencia);
CREATE INDEX IF NOT EXISTS idx_pagamentos_referencia ON pagamentosmensais (referencia);

-- mensalidadesresolvidas: mesmo padrão
CREATE INDEX IF NOT EXISTS idx_resolvidas_aluno_ref ON mensalidadesresolvidas (alunoid, referencia);
CREATE INDEX IF NOT EXISTS idx_resolvidas_referencia ON mensalidadesresolvidas (referencia);

-- boletosmensais: filtrado por alunoid+referencia
CREATE INDEX IF NOT EXISTS idx_boletos_aluno_ref ON boletosmensais (alunoid, referencia);

-- cobrancas: filtrado por referencia e por responsavel_id
CREATE INDEX IF NOT EXISTS idx_cobrancas_referencia ON cobrancas (referencia);
CREATE INDEX IF NOT EXISTS idx_cobrancas_responsavel ON cobrancas (responsavel_id);
```

> **Não** criei índices para `financeiro(mes,ano)`, `cpf`, `telefone`, `status`, `data` porque
> o código **não filtra por essas colunas no servidor** hoje (a filtragem é feita no navegador).
> Se as otimizações da seção 3 forem aplicadas (filtrar no servidor), aí sim adicione:
> ```sql
> CREATE INDEX IF NOT EXISTS idx_financeiro_mes_ano ON financeiro (ano, mes);
> ```

---

## 2. Revisão de schema (checklist no painel do Supabase)

Verifique no **Table Editor** / **Database**:

- [ ] **Chaves primárias**: todas as tabelas com `id` como PK (ou `chave` em `configuracoes`).
- [ ] **Chaves estrangeiras** (hoje provavelmente ausentes — os vínculos são por valor):
      - `alunos.responsavel` referencia `clientes.nome` (vínculo **por nome**, frágil — o ideal
        seria `alunos.responsavel_id → clientes.id`, mas isso é uma migração de dados maior;
        documentado como melhoria futura, **não** alterar sem migrar os dados existentes).
      - `pagamentosmensais.alunoid`, `boletosmensais.alunoid`, `mensalidadesresolvidas.alunoid`
        → `alunos.id`.
      - `cobrancas.responsavel_id` → `clientes.id`.
- [ ] **Tipos**: `valor`/`mensalidade`/`valor_total` como `numeric`; `mes`/`ano`/`vencimento`
      como `integer`; `whatsapp_enviado` como `integer`/`boolean` consistente.
- [ ] **Defaults**: `cobrancas.status='pendente'`, `cobrancas.origem='manual'`,
      `cobrancas.whatsapp_enviado=0`, `usuarios.primeiroacesso=1`.
- [ ] **Campos de auditoria** (melhoria): adicionar `created_at timestamptz default now()` e
      `updated_at` nas tabelas principais (não obrigatório; hoje há `criadoem` textual em algumas).
- [ ] **Duplicidades**: conferir se há responsáveis/alunos duplicados por nome.

### RLS (Row Level Security) — importante
- [ ] Confirme a política de acesso das tabelas. Como o backend usa a **chave de serviço**
      (server-side) e o frontend **nunca** fala direto com o Supabase (a função que fazia isso foi
      removida), o acesso é sempre mediado pela API autenticada. Ainda assim:
- [ ] Se a chave usada for a `anon`, **habilite RLS** e crie políticas restritivas (senão a base
      fica aberta a quem tiver a URL+anon key). Se for a `service_role`, mantenha-a **apenas** no
      servidor (env var), nunca no frontend. Ver `GUIA_DE_SEGURANCA.md`.

### Storage
- [ ] Bucket **`Boletos`** está `public: true` (SEG-09). Avaliar torná-lo privado + URLs assinadas
      de curta duração, preservando compatibilidade com links já enviados. (Melhoria de segurança.)

---

## 3. Otimização de consultas (recomendada, exige teste)

Estas melhorias **não foram aplicadas ainda** porque exigem mudanças coordenadas no frontend
(que hoje baixa a tabela inteira e filtra no navegador) e **teste com dados reais**. Documentadas
para uma próxima rodada validada:

1. **`.select('*')` → seleção explícita** das colunas usadas — em `financeiro`, `cobrancas`,
   `pagamentosmensais`, etc. Ganho real só quando reduz colunas; priorize onde há muitas colunas.
2. **Filtrar no servidor** (em vez de baixar tudo e filtrar no front):
   - `financeiro`: aceitar `?mes=&ano=&status=&tipo=` e aplicar `.eq(...)`.
   - `cobrancas`: aceitar `?referencia=` e filtrar por mês.
   - `pagamentosmensais`/`mensalidadesresolvidas`: já poderiam receber `?referencia=`.
3. **Paginação** (`.range(inicio, fim)`) nas listagens grandes (financeiro, cobranças).
4. **Endpoint de indicadores do Dashboard**: hoje o Dashboard baixa várias tabelas inteiras e
   calcula no navegador. Criar `GET /api/dashboard?mes=&ano=` que retorna só os totais calculados
   no servidor.

> Para o volume atual (instituto pequeno) o sistema funciona bem sem isso; estas mudanças importam
> conforme os dados crescem e devem ser feitas com o frontend em conjunto e testadas na Render.

---

## 4. Status da Fase 6
- ✅ SQLite removido do sistema (código + dependência + arquivos `database.db`).
- ✅ Índices recomendados a partir das consultas reais (seção 1) — **rodar no SQL Editor**.
- ✅ Checklist de revisão de schema/RLS/Storage (seção 2).
- ⏳ Otimização de queries/paginação/Dashboard (seção 3) — recomendada, exige frontend + teste.
