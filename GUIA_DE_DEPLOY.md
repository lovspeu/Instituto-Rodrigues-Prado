# GUIA DE DEPLOY — Instituto Rodrigues Prado (repositório novo + Render novo)

Este guia cobre a virada para o **repositório limpo** e o **Render novo**, apontando para o
**mesmo Supabase** (a fonte oficial dos dados não muda).

---

## 0. Princípio

- O repositório novo nasce **sem histórico** — apenas a árvore atual, já limpa de segredos.
- Segredos vivem **apenas** como variáveis de ambiente no Render (nunca no git).
- O Supabase é o mesmo. Nenhum dado é migrado.

---

## 1. Publicar o código limpo no repositório novo

> Feito pelo assistente. O commit inicial **não** contém `.env`, `.wwebjs_auth/`,
> `database.db`, PDFs nem `node_modules` (garantido pelo `.gitignore` em UTF-8).

Conferência de que nada sensível foi para o repo:
```bash
git ls-files | grep -Ei '\.env$|wwebjs|database\.db|\.pdf$|node_modules'   # deve vir vazio
```

## 2. Variáveis de ambiente no Render (Environment)

| Variável | Valor | Observação |
|----------|-------|------------|
| `NODE_VERSION` | `22` | **Obrigatório** — supabase-js exige WebSocket nativo (Node ≥22). |
| `NODE_ENV` | `production` | Ativa cookie `Secure`. |
| `JWT_SECRET` | (gerar) | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` — ou deixar o Render gerar. |
| `SUPABASE_URL` | (o seu) | Mesmo do sistema atual. |
| `SUPABASE_KEY` | (rotacionada) | Ver `GUIA_DE_SEGURANCA.md`. |
| `PAGBANK_TOKEN` | (rotacionado) | Novo token do PagBank. |
| `PAGBANK_ENV` | `sandbox` ou `production` | Conforme o uso real. |
| `ALLOWED_ORIGINS` | `https://SEU-APP.onrender.com` | URL pública do Render novo. Trava CORS/Socket.IO. |

## 3. Build & Start (Render)
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Health Check Path:** `/ping`
- **Root Directory:** se o repo tiver o código na raiz, deixe vazio. Se você subiu a pasta
  `instituto_rodrigues_prado_serv` inteira como raiz do repo, também fica vazio.

## 4. Primeiro deploy — checklist
1. Conectar o repositório novo ao serviço do Render.
2. Preencher as variáveis da seção 2.
3. Disparar o deploy e acompanhar os logs. Você deve ver o banner "INSTITUTO RODRIGUES PRADO".
4. Abrir a URL → tela de login.
5. **Login:** os usuários antigos entram com a senha atual; ela é **migrada para bcrypt**
   automaticamente no primeiro acesso correto.
6. **WhatsApp:** vá em WhatsApp → conectar → leia o QR. (Só conecte aqui **depois** de
   desconectar o WhatsApp do sistema/Render antigo — o número aceita 1 sessão por vez.)

## 5. Validação pós-deploy (fluxos críticos)
- [ ] Login correto entra; login errado é recusado.
- [ ] Recarregar a página mantém a sessão (cookie).
- [ ] Logout encerra a sessão (recarregar volta ao login).
- [ ] Dashboard, Responsáveis, Alunos, Financeiro, Mensalidades, Cobranças carregam.
- [ ] Chamar `/api/clientes` sem estar logado retorna **401**.
- [ ] WhatsApp conecta e envia (teste com um número seu).
- [ ] Geração de relatório em PDF funciona.
- [ ] Tempo real: uma alteração aparece em outra aba/aparelho.

## 6. Virada (cutover)
Quando o Render novo estiver validado:
1. Desligar o WhatsApp do ambiente antigo.
2. Apontar o domínio/uso para o Render novo.
3. Pausar/deletar o serviço antigo.
4. Tornar o repositório antigo **privado** ou **arquivá-lo/deletá-lo**.
5. Confirmar que os segredos antigos foram **rotacionados** (`GUIA_DE_SEGURANCA.md`).

## 7. UptimeRobot (opcional, free tier)
O free tier do Render "dorme". Se usar UptimeRobot, aponte o monitor para
`https://SEU-APP.onrender.com/ping` (responde `pong`).
