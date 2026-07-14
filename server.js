require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
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

/* BANCO */
const db = new sqlite3.Database('./database.db'); // legado SQLite (a remover na Fase 6)
const supabase = require('./src/config/supabase');

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY,
      nome TEXT,
      telefone TEXT,
      cpf TEXT,
      email TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY,
      nome TEXT,
      responsavel TEXT,
      mensalidade REAL,
      vencimento INTEGER,
      mesMatricula INTEGER,
      anoMatricula INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS financeiro (
      id INTEGER PRIMARY KEY,
      descricao TEXT,
      valor REAL,
      tipo TEXT,
      status TEXT,
      categoria TEXT,
      data TEXT,
      mes INTEGER,
      ano INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pagamentosMensais (
      id INTEGER PRIMARY KEY,
      alunoId INTEGER,
      referencia TEXT,
      dataPagamento TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mensalidadesResolvidas (
      id INTEGER PRIMARY KEY,
      alunoId INTEGER,
      referencia TEXT,
      status TEXT,
      motivo TEXT,
      dataResolucao TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS boletosMensais (
      id INTEGER PRIMARY KEY,
      alunoId INTEGER,
      referencia TEXT,
      link_boleto TEXT,
      linha_digitavel TEXT,
      codigo_barras TEXT,
      order_id TEXT,
      charge_id TEXT,
      criadoEm TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE,
      nome TEXT,
      senha TEXT,
      primeiroAcesso INTEGER DEFAULT 1
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO usuarios
    (usuario, nome, senha, primeiroAcesso)
    VALUES
    ('rosangela', 'Rosângela Rodrigues', '1234', 1),
    ('adriana', 'Adriana Prado', '1234', 1),
    ('joao', 'João Pedro Pontes', '1234', 1)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cobrancas (
      id INTEGER PRIMARY KEY,
      responsavel_id INTEGER,
      referencia TEXT,
      valor_total REAL,
      status TEXT DEFAULT 'pendente',
      link_boleto TEXT,
      linha_digitavel TEXT,
      modo TEXT DEFAULT 'manual',
      criadoEm TEXT
    )
  `);

  db.run(`ALTER TABLE cobrancas ADD COLUMN arquivo_boleto TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN origem TEXT DEFAULT 'manual'`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN cpf_detectado TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN nome_detectado TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN vencimento_detectado TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN codigo_barras TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN confianca TEXT`, () => {});
  db.run(`ALTER TABLE cobrancas ADD COLUMN whatsapp_enviado INTEGER DEFAULT 0`, () => {});

});

/* Boletos — garante o bucket do Supabase Storage no startup (src/services/boletos.js) */
require('./src/services/boletos');


function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

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