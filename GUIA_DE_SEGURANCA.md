# GUIA DE SEGURANÇA — Instituto Rodrigues Prado

> Este guia cobre (1) o novo modelo de autenticação, (2) o que **você** precisa rotacionar
> por causa do vazamento no Git, e (3) como limpar o histórico do repositório.
> **Nenhum valor de credencial é exibido aqui.**

---

## 1. NOVO MODELO DE AUTENTICAÇÃO (implementado na Fase 3)

- **Sessão** via **JWT em cookie `HttpOnly`** (`irp_sessao`), `Secure` em produção, `SameSite=lax`, validade 8h.
- **Senhas** com **bcrypt**. Usuários antigos (senha em texto puro como `1234`) são migrados
  **automaticamente e sem lockout**: no primeiro login correto, a senha é re-hasheada.
- **Login** (`POST /api/login`) retorna apenas `usuario`, `nome`, `primeiroAcesso` — nunca a senha.
- **Guard global**: toda rota `/api/*` exige sessão, exceto: `/api/login`, `/api/auth/me`,
  `/api/auth/logout`, `/api/status`.
- **Rotas administrativas** (`/api/admin/migrar-boletos`, `/api/cobrancas/reset-whatsapp`)
  exigem usuário na lista `ADMIN_USERS`.
- **Socket.IO** autentica o handshake pelo cookie de sessão.
- **Frontend** não usa mais `localStorage` como autenticação; consulta `/api/auth/me`.
- **Modo censura**: senha fixa removida; agora protegido pela sessão.

### Variáveis de ambiente a definir (Render → Environment)
| Variável | Obrigatória | Observação |
|----------|-------------|------------|
| `JWT_SECRET` | **Sim** | Valor aleatório forte (ex.: 64 hex). Sem ele, usa fallback inseguro. |
| `NODE_ENV` | Recomendada | `production` — ativa o cookie `Secure`. |
| `ALLOWED_ORIGINS` | Recomendada | URL(s) do sistema, separadas por vírgula. Ex.: `https://SEU-APP.onrender.com`. Sem isso, CORS/Socket.IO aceitam qualquer origem. |
| `ADMIN_USERS` | Opcional | Padrão: `rosangela,adriana,joao`. |
| `SUPABASE_URL`, `SUPABASE_KEY` | Sim | Já existentes. |
| `PAGBANK_TOKEN`, `PAGBANK_ENV` | Sim | Já existentes. |

> Gere um `JWT_SECRET` com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

---

## 2. CREDENCIAIS QUE PRECISAM SER ROTACIONADAS ⏸️

Os arquivos abaixo foram **commitados e publicados** em `github.com/lovspeu/Instituto-Rodrigues-Prado`.
Mesmo removendo-os agora, **o que já está no histórico continua recuperável** até a limpeza (seção 3).
Portanto, rotacione **antes ou logo após** a limpeza:

| # | Credencial / segredo | Onde estava | Ação |
|---|----------------------|-------------|------|
| 1 | **Token do PagBank** | `.env` (versionado) | Gerar novo token no painel PagBank/PagSeguro e substituir em `.env` local e no Render. Revogar o antigo. |
| 2 | **Chave do Supabase** (`SUPABASE_KEY`) | Render (não no `.env` local) | Se for a chave de serviço/anon exposta em algum lugar, **rotacionar** no painel Supabase (Settings → API). Preferir a chave `anon` no cliente e manter a `service_role` só no servidor. |
| 3 | **Senha do banco Supabase** | Arquivo `senha do banco de dados supabase in.txt` (na pasta pai) | **Trocar** a senha do Postgres no painel Supabase (Settings → Database) e **apagar** esse arquivo `.txt`. |
| 4 | **Sessão do WhatsApp** | `.wwebjs_auth/` (246 arquivos versionados) | **Desconectar/deslogar** o WhatsApp pelo próprio sistema (ou no app do celular: Aparelhos conectados → sair) e reconectar via QR. A sessão vazada deixa de valer. |

> **Importante:** o `.wwebjs_auth/` é da versão **antiga** (whatsapp-web.js). O sistema atual usa
> Baileys (`auth_info_baileys/`). Ainda assim, deslogar/reconectar invalida qualquer sessão exposta.

---

## 3. LIMPEZA DO HISTÓRICO DO GIT (executar **após** rotacionar)

O `.gitignore` já foi corrigido (UTF-8), mas ele **não remove o que já está no histórico**.
Passos planejados (a rodar juntos, com sua autorização — envolve `push --force`):

### 3.1. Remover do índice atual (não destrói histórico)
```bash
git rm -r --cached .env .wwebjs_auth database.db database/database.db "frontend/assets" uploads
# (mantém os arquivos no disco; apenas para de versioná-los)
git add .gitignore
git commit -m "Parar de versionar segredos e arquivos sensiveis"
```

### 3.2. Expurgar do histórico (destrutivo — precisa de backup e --force)
Recomendado: **git filter-repo** (ou BFG). Exemplo com filter-repo:
```bash
# backup completo antes
git clone --mirror . ../backup-repo-irp.git

pip install git-filter-repo
git filter-repo --force \
  --path .env \
  --path database.db \
  --path database/database.db \
  --path .wwebjs_auth \
  --path uploads \
  --path-glob 'frontend/assets/*.pdf' \
  --invert-paths
```

### 3.3. Republicar
```bash
git remote add origin https://github.com/lovspeu/Instituto-Rodrigues-Prado.git
git push origin --force --all
git push origin --force --tags
```
> Após isso, **todos os clones antigos ficam inválidos** — quem tiver cópia deve re-clonar.
> O Render fará novo deploy; garanta que as variáveis de ambiente da seção 1 estejam configuradas.

### 3.4. Confirmar
```bash
git ls-files | grep -Ei '\.env|\.wwebjs_auth|database\.db|\.pdf'   # não deve retornar nada
```

---

## 4. CHECKLIST DE INVALIDAÇÃO

- [ ] Token PagBank rotacionado e antigo revogado
- [ ] Chave/senha Supabase rotacionada
- [ ] Arquivo `senha do banco de dados supabase in.txt` apagado
- [ ] WhatsApp deslogado e reconectado por QR
- [ ] `JWT_SECRET`, `ALLOWED_ORIGINS`, `NODE_ENV=production` definidos no Render
- [ ] Histórico do Git expurgado e `push --force` feito
- [ ] `git ls-files` sem arquivos sensíveis

---

## 5. PENDÊNCIAS DE SEGURANÇA (próximas fases)
- **SEG-09**: boletos em bucket **público** do Supabase → avaliar bucket privado + URLs assinadas (Fase 6), preservando links já enviados.
- **SEG-11**: validação de MIME/tamanho/nome no upload de boletos (Fase 4/5).
- Servir `/uploads` publicamente → gerar relatórios em diretório temporário privado (Fase 9).
