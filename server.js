require('dotenv').config();

const PDFDocument = require('pdfkit');
const multer = require('multer');
const pdfParseLib = require('pdf-parse');
const pdfParse =
  typeof pdfParseLib === 'function'
    ? pdfParseLib
    : pdfParseLib.default;
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const { Server } = require('socket.io');

const fs = require('fs');

/* SEGURANCA */
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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
const {
  gerarTokenSessao,
  definirCookieSessao,
  limparCookieSessao,
  lerSessao,
  requireAuth,
  requireAdmin,
  limiteLogin
} = require('./src/middlewares/auth');

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

/* Boletos (upload/storage/deteccao) — src/services/boletos.js */
const { uploadBoleto, uploadParaSupabase, encontrarResponsavelPorBoleto } = require('./src/services/boletos');


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
const realtime = require('./src/services/realtime');
realtime.init(io);
const { atualizarSistema } = realtime;

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

app.post('/api/cobrancas/importar-boleto', uploadBoleto.single('boleto'), async (req, res) => {
  try{

    if(!req.file){
      return res.status(400).json({
        erro:'Nenhum boleto enviado.'
      });
    }

    const referencia = req.body.referencia;

    if(!referencia){
      return res.status(400).json({
        erro:'Referência não enviada.'
      });
    }

    const extensao = path.extname(req.file.originalname) || (req.file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
    const nomeArquivo = `boleto-${Date.now()}${extensao}`;
    const buffer = req.file.buffer;

    // Faz upload para Supabase Storage
    const urlArquivo = await uploadParaSupabase(buffer, nomeArquivo, req.file.mimetype);

    let textoExtraido = '';

    if(req.file.mimetype === 'application/pdf'){

      console.log('LENDO PDF...');

      if(typeof pdfParse !== 'function'){
        throw new Error('pdfParse não é função. Tipo: ' + typeof pdfParse);
      }

      const pdf = await pdfParse(buffer);

      textoExtraido = pdf.text || '';

    }

    const cpfDetectado =
      detectarCPF(textoExtraido);

    const linhaDigitavel =
      detectarLinhaDigitavel(textoExtraido);

    const valorDetectado =
      detectarValor(textoExtraido);

    const vencimentoDetectado =
      detectarVencimento(textoExtraido);

    const resultado =
      await encontrarResponsavelPorBoleto({
        cpf:cpfDetectado,
        texto:textoExtraido,
        valor:valorDetectado
      });

    if(!resultado.cliente){

      return res.json({
        sucesso:false,
        precisa_confirmar:true,
        mensagem:'Boleto importado, mas não consegui identificar o responsável automaticamente.',
        arquivo_boleto:urlArquivo,
        cpf_detectado:cpfDetectado,
        linha_digitavel:linhaDigitavel,
        valor_detectado:valorDetectado,
        vencimento_detectado:vencimentoDetectado,
        confianca:resultado.confianca,
        motivo:resultado.motivo
      });

    }

    const id = Date.now();

const { error } = await supabase
  .from('cobrancas')
  .insert([{
    id,
    responsavel_id: resultado.cliente.id,
    referencia,
    valor_total: valorDetectado || 0,
    status: 'pendente',
    link_boleto: urlArquivo,
    linha_digitavel: linhaDigitavel,
    modo: 'manual',
    criadoem: new Date().toLocaleDateString('pt-BR'),
    arquivo_boleto: urlArquivo,
    origem: 'manual',
    cpf_detectado: cpfDetectado,
    nome_detectado: resultado.cliente.nome,
    vencimento_detectado: vencimentoDetectado,
    confianca: resultado.confianca,
    whatsapp_enviado: 0
  }]);

if (error) throw error;

    atualizarSistema();

    res.json({
      sucesso:true,
      responsavel:resultado.cliente.nome,
      confianca:resultado.confianca,
      motivo:resultado.motivo,
      arquivo_boleto:urlArquivo,
      linha_digitavel:linhaDigitavel,
      valor_detectado:valorDetectado,
      vencimento_detectado:vencimentoDetectado
    });

  }catch(error){

    console.error(error);

    res.status(500).json({
      erro:'Erro ao importar boleto manual.',
      detalhes:error.message
    });

  }
});
/* PAGBANK removido — cobrancas usam apenas importacao manual de boletos */

/* FRONTEND */
app.use(express.static(path.join(__dirname, 'frontend')));

/* =========================================================
LOGIN
========================================================= */

function ehHashBcrypt(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$/.test(valor);
}

// Verifica a senha aceitando hash bcrypt OU senha legada em texto puro.
// Se a senha legada bater, re-hasheia de forma transparente (migracao sem lockout).
async function verificarESincronizarSenha(usuarioEncontrado, senhaDigitada) {
  const senhaArmazenada = usuarioEncontrado.senha;

  if (ehHashBcrypt(senhaArmazenada)) {
    return bcrypt.compare(senhaDigitada, senhaArmazenada);
  }

  // Legado: comparacao em texto puro
  const confere = String(senhaArmazenada) === String(senhaDigitada);
  if (confere) {
    try {
      const novoHash = await bcrypt.hash(senhaDigitada, 10);
      await supabase
        .from('usuarios')
        .update({ senha: novoHash })
        .eq('usuario', usuarioEncontrado.usuario);
    } catch (e) {
      console.error('[SEGURANCA] Falha ao migrar senha para hash:', e.message);
    }
  }
  return confere;
}

app.post('/api/login', limiteLogin, async (req, res) => {
  try {
    const usuario = String(req.body?.usuario || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');

    if (!usuario || !senha) {
      return res.status(400).json({ sucesso: false, erro: 'Usuário e senha são obrigatórios.' });
    }

    const { data, error } = await supabase
      .from('usuarios')
      .select('usuario, nome, senha, primeiroacesso')
      .eq('usuario', usuario)
      .limit(1);

    if (error) throw error;

    const usuarioEncontrado = data && data[0];
    const senhaConfere = usuarioEncontrado
      ? await verificarESincronizarSenha(usuarioEncontrado, senha)
      : false;

    // Mensagem generica para nao revelar se o usuario existe
    if (!usuarioEncontrado || !senhaConfere) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha inválidos.' });
    }

    const token = gerarTokenSessao(usuarioEncontrado);
    definirCookieSessao(res, token);

    // Retorna apenas campos publicos — nunca a senha
    res.json({
      sucesso: true,
      usuario: {
        usuario: usuarioEncontrado.usuario,
        nome: usuarioEncontrado.nome,
        primeiroAcesso: usuarioEncontrado.primeiroacesso
      }
    });

  } catch (error) {
    console.error('Erro no login Supabase:', error.message);
    res.status(500).json({ sucesso: false, erro: 'Erro interno ao fazer login.' });
  }
});

// Sessao atual (substitui a checagem por localStorage no frontend)
app.get('/api/auth/me', (req, res) => {
  const sessao = lerSessao(req);
  if (!sessao) return res.status(401).json({ autenticado: false });
  res.json({
    autenticado: true,
    usuario: { usuario: sessao.usuario, nome: sessao.nome }
  });
});

// Logout real — invalida o cookie de sessao
app.post('/api/auth/logout', (req, res) => {
  limparCookieSessao(res);
  res.json({ sucesso: true });
});

const SENHA_MIN_TAMANHO = 6;

function validarPoliticaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MIN_TAMANHO) {
    return `A senha deve ter pelo menos ${SENHA_MIN_TAMANHO} caracteres.`;
  }
  return null;
}

// Troca de senha — protegida: o usuario so pode alterar a PROPRIA senha.
app.patch('/api/usuarios/senha', requireAuth, async (req, res) => {
  try {
    const usuario = req.usuario.usuario; // vem da sessao, nao do corpo
    const senha = String(req.body?.senha || '');

    const erroPolitica = validarPoliticaSenha(senha);
    if (erroPolitica) {
      return res.status(400).json({ sucesso: false, erro: erroPolitica });
    }

    const hash = await bcrypt.hash(senha, 10);

    const { error } = await supabase
      .from('usuarios')
      .update({ senha: hash, primeiroacesso: 0 })
      .eq('usuario', usuario);

    if (error) throw error;

    const { data: usuarioAtualizado, error: erroBusca } = await supabase
      .from('usuarios')
      .select('usuario, nome, primeiroacesso')
      .eq('usuario', usuario)
      .limit(1);

    if (erroBusca) throw erroBusca;

    if (!usuarioAtualizado || usuarioAtualizado.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    }

    const usuarioFinal = usuarioAtualizado[0];

    res.json({
      sucesso: true,
      usuario: {
        usuario: usuarioFinal.usuario,
        nome: usuarioFinal.nome,
        primeiroAcesso: usuarioFinal.primeiroacesso
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar senha Supabase:', error.message);
    res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar senha.' });
  }
});
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

app.get('/api/cobrancas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cobrancas')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    const cobrancas = data.map(item => ({
      ...item,
      responsavel_id: item.responsavel_id,
      valor_total: item.valor_total,
      link_boleto: item.link_boleto,
      linha_digitavel: item.linha_digitavel,
      criadoEm: item.criadoem,
      arquivo_boleto: item.arquivo_boleto,
      cpf_detectado: item.cpf_detectado,
      nome_detectado: item.nome_detectado,
      vencimento_detectado: item.vencimento_detectado,
      codigo_barras: item.codigo_barras,
      whatsapp_enviado: item.whatsapp_enviado
    }));

    res.json(cobrancas);

  } catch (error) {
    console.error('Erro ao buscar cobranças:', error);
    res.status(500).json({ erro: 'Erro ao buscar cobranças.' });
  }
});

app.post('/api/cobrancas', async (req, res) => {
  try {
    const {
      id,
      responsavel_id,
      referencia,
      valor_total,
      status,
      link_boleto,
      linha_digitavel,
      modo,
      origem,
      criadoEm
    } = req.body;

    const { error } = await supabase
      .from('cobrancas')
      .insert([{
        id,
        responsavel_id,
        referencia,
        valor_total,
        status,
        link_boleto,
        linha_digitavel,
        modo,
        origem: origem || 'manual',
        criadoem: criadoEm
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar cobrança:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar cobrança.' });
  }
});

/* =========================================================
MIGRAÇÃO ÚNICA: boletos locais → Supabase Storage
========================================================= */
app.post('/api/admin/migrar-boletos', requireAdmin, async (req, res) => {
  try {
    // Busca todas as cobranças com link local
    const { data: cobrancas, error } = await supabase
      .from('cobrancas')
      .select('id, link_boleto, arquivo_boleto')
      .like('link_boleto', '/uploads/%');

    if (error) throw error;
    if (!cobrancas || cobrancas.length === 0) {
      return res.json({ sucesso: true, migradas: 0, mensagem: 'Nenhum boleto local encontrado.' });
    }

    const resultados = [];

    for (const cobranca of cobrancas) {
      const caminhoLocal = path.join(__dirname, cobranca.link_boleto);

      if (!fs.existsSync(caminhoLocal)) {
        resultados.push({ id: cobranca.id, status: 'arquivo_nao_encontrado' });
        continue;
      }

      try {
        const buffer = fs.readFileSync(caminhoLocal);
        const ext = path.extname(cobranca.link_boleto) || '.pdf';
        const nomeArquivo = `boleto-migrado-${cobranca.id}${ext}`;
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'image/jpeg';

        const urlPublica = await uploadParaSupabase(buffer, nomeArquivo, mimeType);

        const { error: errUpdate } = await supabase
          .from('cobrancas')
          .update({ link_boleto: urlPublica, arquivo_boleto: urlPublica })
          .eq('id', cobranca.id);

        if (errUpdate) throw errUpdate;

        resultados.push({ id: cobranca.id, status: 'migrado', url: urlPublica });

      } catch (e) {
        resultados.push({ id: cobranca.id, status: 'erro', detalhe: e.message });
      }
    }

    atualizarSistema();

    const migrados = resultados.filter(r => r.status === 'migrado').length;
    const erros = resultados.filter(r => r.status === 'erro').length;
    const naoEncontrados = resultados.filter(r => r.status === 'arquivo_nao_encontrado').length;

    res.json({ sucesso: true, total: cobrancas.length, migrados, erros, naoEncontrados, resultados });

  } catch (error) {
    console.error('Erro na migração:', error);
    res.status(500).json({ erro: 'Erro na migração.', detalhe: error.message });
  }
});

app.delete('/api/cobrancas/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('cobrancas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover cobrança:', error);
    res.status(500).json({ erro: 'Erro ao remover cobrança.' });
  }
});

app.patch('/api/cobrancas/reset-whatsapp', requireAdmin, async (req, res) => {
  try {
    const { referencia } = req.body;
    const query = supabase.from('cobrancas').update({ whatsapp_enviado: 0 });
    const { error } = referencia
      ? await query.eq('referencia', referencia)
      : await query.neq('id', 0);
    if (error) throw error;
    atualizarSistema();
    res.json({ sucesso: true });
  } catch (error) {
    console.error('Erro ao resetar envios:', error);
    res.status(500).json({ erro: 'Erro ao resetar envios.' });
  }
});

app.patch('/api/cobrancas/:id/whatsapp', async (req, res) => {
  try {
    const { error } = await supabase
      .from('cobrancas')
      .update({ whatsapp_enviado: req.body.whatsapp_enviado ? 1 : 0 })
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao marcar cobrança como enviada:', error);
    res.status(500).json({ erro: 'Erro ao marcar como enviado.' });
  }
});

/* Regras de status/atraso de mensalidades — src/utils/mensalidades.js */
const {
  statusMensalidadeServidor,
  verificarAtrasoServidor
} = require('./src/utils/mensalidades');

/* Relatorios em PDF — src/services/relatorios.js */
const { gerarRelatorioFinanceiroPremium } = require('./src/services/relatorios');


app.get('/api/relatorios/financeiro/pdf', async (req, res) => {
  try {
    const referencia = obterMesAtualReferencia();

    const nomeArquivo =
      `relatorio-financeiro-geral-${referencia}.pdf`;

    const caminhoArquivo =
      path.join(__dirname, 'uploads', nomeArquivo);

    await gerarRelatorioFinanceiroPremium(caminhoArquivo);

    res.download(caminhoArquivo, nomeArquivo, () => {
      fs.unlinkSync(caminhoArquivo);
    });

  } catch (error) {
    console.error('Erro ao gerar relatório financeiro:', error);

    res.status(500).json({
      erro:'Erro ao gerar relatório financeiro.',
      detalhes:error.message
    });
  }
});

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