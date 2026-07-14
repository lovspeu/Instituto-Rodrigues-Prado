require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const fs = require('fs');

/* SEGURANCA */
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

/* ---- Configuracao de ambiente (src/config/env.js) ---- */
const {
  COOKIE_SESSAO,
  JWT_SECRET_EFETIVO,
  origemPermitida
} = require('./src/config/env');

const app = express();
app.set('trust proxy', 1); // Render/proxy — necessario para Secure cookies e rate-limit por IP
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, origemPermitida(origin)),
    credentials: true
  }
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' ainda necessario por causa dos onclick inline (removidos na Fase 8)
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com', "'unsafe-inline'"],
      styleSrc: ["'self'", 'https://cdnjs.cloudflare.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: (origin, cb) => cb(null, origemPermitida(origin)),
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

/* =========================================================
   AUTENTICACAO — src/middlewares/auth.js
========================================================= */
const { requireAuth } = require('./src/middlewares/auth');

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* =========================================================
   GUARD GLOBAL — toda rota /api exige sessao, exceto as publicas
========================================================= */
const ROTAS_PUBLICAS = new Set([
  '/api/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/status'
]);

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();   // arquivos estaticos / paginas
  if (ROTAS_PUBLICAS.has(req.path)) return next();     // rotas publicas
  return requireAuth(req, res, next);                  // demais exigem sessao
});

/* PING UPTIMEROBOT */
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

if(!fs.existsSync('./uploads')){
  fs.mkdirSync('./uploads');
}

if(!fs.existsSync('./uploads/boletos')){
  fs.mkdirSync('./uploads/boletos', { recursive:true });
}

/* Boletos — garante o bucket do Supabase Storage no startup (src/services/boletos.js) */
require('./src/services/boletos');


/* Tempo real (Socket.IO) — src/services/realtime.js */
require('./src/services/realtime').init(io);

/* MENSALIDADES RESOLVIDAS SEM PAGAMENTO */

app.use(require('./src/routes/mensalidadesResolvidas.routes'));

/* =========================================================
LEITURA DE BOLETO MANUAL
========================================================= */

/* Utilitarios de formatacao e deteccao \u2014 src/utils/format.js */
const {
  limparNumero,
  normalizarTexto,
  detectarCPF,
  detectarLinhaDigitavel,
  detectarValor,
  detectarVencimento,
  formatarMoeda,
  obterMesAtualReferencia,
  normalizarTelefoneWhatsApp
} = require('./src/utils/format');



/* =========================================================
IMPORTAR BOLETO MANUAL
========================================================= */


/* PAGBANK removido — cobrancas usam apenas importacao manual de boletos */

/* FRONTEND */
app.use(express.static(path.join(__dirname, 'frontend')));

/* =========================================================
LOGIN
========================================================= */

app.use(require('./src/routes/auth.routes'));

/* STATUS */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    sistema: 'Instituto Rodrigues Prado',
    versao: '2.0.0'
  });
});

/* CLIENTES */
app.use(require('./src/routes/clientes.routes'));


/* ALUNOS */
app.use(require('./src/routes/alunos.routes'));

/* FINANCEIRO */
app.use(require('./src/routes/financeiro.routes'));


/* PAGAMENTOS MENSAIS */
app.use(require('./src/routes/pagamentos.routes'));


/* BOLETOS SALVOS */
app.use(require('./src/routes/boletosMensais.routes'));

/* CONFIGURAÇÕES */

app.use(require('./src/routes/configuracoes.routes'));


/* COBRANÇAS */

app.use(require('./src/routes/cobrancas.routes'));


/* Regras de status/atraso de mensalidades — src/utils/mensalidades.js */
const {
  statusMensalidadeServidor,
  verificarAtrasoServidor
} = require('./src/utils/mensalidades');

/* Relatorios em PDF — src/services/relatorios.js */
const { gerarRelatorioFinanceiroPremium } = require('./src/services/relatorios');


app.use(require('./src/routes/relatorios.routes'));


// Autentica o handshake do Socket.IO pelo cookie de sessao
function lerTokenDoHandshake(socket) {
  const raw = socket.handshake.headers.cookie || '';
  const parte = raw
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(COOKIE_SESSAO + '='));
  if (!parte) return null;
  return decodeURIComponent(parte.slice(COOKIE_SESSAO.length + 1));
}

io.use((socket, next) => {
  const token = lerTokenDoHandshake(socket);
  if (!token) return next(new Error('nao autenticado'));
  try {
    socket.usuario = jwt.verify(token, JWT_SECRET_EFETIVO);
    next();
  } catch {
    next(new Error('sessao invalida'));
  }
});

/* FRONTEND */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

/* SERVIDOR */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`

========================================
INSTITUTO RODRIGUES PRADO
========================================

Servidor Online:
http://localhost:${PORT}

Banco:
Supabase PostgreSQL

========================================

  `);
});