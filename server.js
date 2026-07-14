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

app.get('/api/mensalidadesResolvidas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensalidadesresolvidas')
      .select('*');

    if (error) throw error;

    const resolvidas = data.map(item => ({
      ...item,
      alunoId: item.alunoid,
      dataResolucao: item.dataresolucao
    }));

    res.json(resolvidas);

  } catch (error) {
    console.error('Erro ao buscar mensalidades resolvidas:', error);
    res.status(500).json({ erro: 'Erro ao buscar mensalidades resolvidas.' });
  }
});

app.post('/api/mensalidadesResolvidas', async (req, res) => {
  try {
    const {
      id,
      alunoId,
      referencia,
      status,
      motivo,
      dataResolucao
    } = req.body;

    const { error } = await supabase
      .from('mensalidadesresolvidas')
      .insert([{
        id,
        alunoid: alunoId,
        referencia,
        status,
        motivo,
        dataresolucao: dataResolucao
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar mensalidade resolvida:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar mensalidade resolvida.' });
  }
});

app.delete('/api/mensalidadesResolvidas', async (req, res) => {
  try {
    const { alunoId, referencia } = req.body;

    const { error } = await supabase
      .from('mensalidadesresolvidas')
      .delete()
      .eq('alunoid', alunoId)
      .eq('referencia', referencia);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover mensalidade resolvida:', error);
    res.status(500).json({ erro: 'Erro ao remover mensalidade resolvida.' });
  }
});
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
app.get('/api/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar clientes no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao buscar clientes.' });
  }
});

app.post('/api/clientes', async (req, res) => {
  try {
    const { id, nome, telefone, cpf, email } = req.body;

    const { error } = await supabase
      .from('clientes')
      .insert([{ id, nome, telefone, cpf, email }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar cliente no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente.' });
  }
});

app.patch('/api/clientes/:id', async (req, res) => {
  try {
    const { nome, telefone, cpf, email } = req.body;

    const { error } = await supabase
      .from('clientes')
      .update({ nome, telefone, cpf, email })
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao editar cliente no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao editar cliente.' });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {

    const { error } = await supabase
      .from('clientes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();

    res.json({
      sucesso: true
    });

  } catch (error) {

    console.error('Erro ao remover cliente:', error);

    res.status(500).json({
      erro: 'Erro ao remover cliente.'
    });

  }
});

/* ALUNOS */
app.get('/api/alunos', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('alunos')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;

    const alunos = data.map(aluno => ({
      ...aluno,
      mesMatricula: aluno.mesmatricula,
      anoMatricula: aluno.anomatricula
    }));

    res.json(alunos);

  } catch (error) {
    console.error('Erro ao buscar alunos no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao buscar alunos.' });
  }
});

app.post('/api/alunos', async (req, res) => {
  try {
    const {
      id,
      nome,
      responsavel,
      mensalidade,
      vencimento,
      mesMatricula,
      anoMatricula
    } = req.body;

    const { error } = await supabase
      .from('alunos')
      .insert([{
        id,
        nome,
        responsavel,
        mensalidade,
        vencimento,
        mesmatricula: mesMatricula,
        anomatricula: anoMatricula
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar aluno no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar aluno.' });
  }
});

app.delete('/api/alunos/:id', async (req, res) => {
  try {
    await supabase
      .from('pagamentosmensais')
      .delete()
      .eq('alunoid', req.params.id);

    await supabase
      .from('boletosmensais')
      .delete()
      .eq('alunoid', req.params.id);

    const { error } = await supabase
      .from('alunos')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover aluno no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao remover aluno.' });
  }
});
/* FINANCEIRO */
app.get('/api/financeiro', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('financeiro')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    res.json(data);

  } catch (error) {
    console.error('Erro ao buscar financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao buscar financeiro.' });
  }
});

app.post('/api/financeiro', async (req, res) => {
  try {
    const {
      id,
      descricao,
      valor,
      tipo,
      status,
      categoria,
      data,
      mes,
      ano
    } = req.body;

    const { error } = await supabase
      .from('financeiro')
      .insert([{
        id,
        descricao,
        valor,
        tipo,
        status,
        categoria,
        data,
        mes,
        ano
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar financeiro.' });
  }
});

app.patch('/api/financeiro/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    const { error } = await supabase
      .from('financeiro')
      .update({ status })
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao atualizar status financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao atualizar status financeiro.' });
  }
});

app.delete('/api/financeiro/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('financeiro')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao remover financeiro.' });
  }
});

/* PAGAMENTOS MENSAIS */
app.get('/api/pagamentosMensais', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagamentosmensais')
      .select('*');

    if (error) throw error;

    const pagamentos = data.map(item => ({
      ...item,
      alunoId: item.alunoid,
      dataPagamento: item.datapagamento
    }));

    res.json(pagamentos);

  } catch (error) {
    console.error('Erro ao buscar pagamentos mensais:', error);
    res.status(500).json({ erro: 'Erro ao buscar pagamentos mensais.' });
  }
});

app.post('/api/pagamentosMensais', async (req, res) => {
  try {
    const { id, alunoId, referencia, dataPagamento } = req.body;

    const { error } = await supabase
      .from('pagamentosmensais')
      .insert([{
        id,
        alunoid: alunoId,
        referencia,
        datapagamento: dataPagamento
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar pagamento mensal:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar pagamento mensal.' });
  }
});

app.delete('/api/pagamentosMensais', async (req, res) => {
  try {
    const { alunoId, referencia } = req.body;

    const { error } = await supabase
      .from('pagamentosmensais')
      .delete()
      .eq('alunoid', alunoId)
      .eq('referencia', referencia);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover pagamento mensal:', error);
    res.status(500).json({ erro: 'Erro ao remover pagamento mensal.' });
  }
});

/* BOLETOS SALVOS */
app.get('/api/boletosMensais', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('boletosmensais')
      .select('*');

    if (error) throw error;

    const boletos = data.map(item => ({
      ...item,
      alunoId: item.alunoid,
      linha_digitavel: item.linha_digitavel,
      codigo_barras: item.codigo_barras,
      order_id: item.order_id,
      charge_id: item.charge_id,
      criadoEm: item.criadoem
    }));

    res.json(boletos);

  } catch (error) {
    console.error('Erro ao buscar boletos mensais:', error);
    res.status(500).json({ erro: 'Erro ao buscar boletos mensais.' });
  }
});

app.post('/api/boletosMensais', async (req, res) => {
  try {
    const {
      id,
      alunoId,
      referencia,
      link_boleto,
      linha_digitavel,
      codigo_barras,
      order_id,
      charge_id,
      criadoEm
    } = req.body;

    const { error } = await supabase
      .from('boletosmensais')
      .insert([{
        id,
        alunoid: alunoId,
        referencia,
        link_boleto,
        linha_digitavel,
        codigo_barras,
        order_id,
        charge_id,
        criadoem: criadoEm
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar boleto mensal:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar boleto mensal.' });
  }
});

app.delete('/api/boletosMensais', async (req, res) => {
  try {
    const { alunoId, referencia } = req.body;

    const { error } = await supabase
      .from('boletosmensais')
      .delete()
      .eq('alunoid', alunoId)
      .eq('referencia', referencia);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover boleto mensal:', error);
    res.status(500).json({ erro: 'Erro ao remover boleto mensal.' });
  }
});
/* CONFIGURAÇÕES */

app.get('/api/configuracoes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('*');

    if (error) throw error;

    const objeto = {};

    data.forEach(item => {
      objeto[item.chave] = item.valor;
    });

    res.json(objeto);

  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ erro: 'Erro ao buscar configurações.' });
  }
});

app.patch('/api/configuracoes', async (req, res) => {
  try {
    const { chave, valor } = req.body;

    const { error } = await supabase
      .from('configuracoes')
      .upsert([{ chave, valor }], { onConflict: 'chave' });

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao salvar configuração:', error);
    res.status(500).json({ erro: 'Erro ao salvar configuração.' });
  }
});
app.get('/api/modo-censura', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('configuracoes')
      .select('*')
      .eq('chave', 'modo_censura')
      .single();

    if(error && error.code !== 'PGRST116'){
      throw error;
    }

    res.json({
      ativo: data?.valor === 'true'
    });

  } catch(error){

    console.error(error);

    res.status(500).json({
      erro:'Erro ao buscar modo censura.'
    });

  }
});

app.patch('/api/modo-censura', async (req, res) => {
  try {

    const { ativo } = req.body;

    const { error } = await supabase
      .from('configuracoes')
      .upsert([{
        chave:'modo_censura',
        valor:String(ativo)
      }], {
        onConflict:'chave'
      });

    if(error) throw error;

    atualizarSistema();

    res.json({
      sucesso:true
    });

  } catch(error){

    console.error(error);

    res.status(500).json({
      erro:'Erro ao salvar modo censura.'
    });

  }
});

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