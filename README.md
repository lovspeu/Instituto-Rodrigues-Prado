# Instituto Rodrigues Prado — Sistema de Gestão

Sistema administrativo e financeiro do Instituto Rodrigues Prado: responsáveis, alunos,
financeiro, mensalidades, central de cobranças, importação de boletos, envio por WhatsApp,
relatórios em PDF e atualização em tempo real.

## Tecnologias
- **Node.js + Express** (API e servidor estático)
- **Supabase (PostgreSQL)** — fonte oficial dos dados
- **Socket.IO** — atualização em tempo real
- **Baileys** (`@whiskeysockets/baileys`) — integração WhatsApp
- **PDFKit** — relatórios em PDF (no backend)
- Frontend em HTML/CSS/JS

> Requer **Node.js 22+**.

## Como rodar localmente
```bash
npm install
cp .env.example .env   # preencha os valores
npm run dev            # ou: npm start
```
Acesse http://localhost:3000

## Variáveis de ambiente
Veja [.env.example](.env.example). Nunca comite o `.env`.

## Segurança
- Autenticação por **JWT em cookie HttpOnly**; senhas com **bcrypt**.
- Rotas `/api/*` protegidas por sessão (allowlist pública para login/status).
- Detalhes e rotação de credenciais: [GUIA_DE_SEGURANCA.md](GUIA_DE_SEGURANCA.md).

## Deploy (Render)
Passo a passo em [GUIA_DE_DEPLOY.md](GUIA_DE_DEPLOY.md). Blueprint em [render.yaml](render.yaml).

## Documentação da refatoração
- [DIAGNOSTICO_REPAGINACAO.md](DIAGNOSTICO_REPAGINACAO.md) — auditoria e rastreador mestre.
- [GUIA_DE_SEGURANCA.md](GUIA_DE_SEGURANCA.md)
- [GUIA_DE_DEPLOY.md](GUIA_DE_DEPLOY.md)
