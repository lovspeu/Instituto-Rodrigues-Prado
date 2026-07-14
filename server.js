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

const qrcode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

/* SEGURANCA */
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/* ---- Configuracao de seguranca a partir do ambiente ---- */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[SEGURANCA] JWT_SECRET nao definido no .env — defina um valor forte antes de ir para producao.');
}
const JWT_SECRET_EFETIVO = JWT_SECRET || 'dev-secret-inseguro-trocar';
const COOKIE_SESSAO = 'irp_sessao';
const SESSAO_MAX_IDADE_MS = 1000 * 60 * 60 * 8; // 8 horas
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// Origens autorizadas (CORS + Socket.IO). Same-origin sempre e permitido.
const ORIGENS_PERMITIDAS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Usuarios com privilegio administrativo (acoes destrutivas / config critica).
const USUARIOS_ADMIN = (process.env.ADMIN_USERS || 'rosangela,adriana,joao')
  .split(',')
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);

function origemPermitida(origin) {
  // Sem Origin = requisicao same-origin (navegacao normal / servidor) -> permitido.
  if (!origin) return true;
  // Se ALLOWED_ORIGINS nao foi configurado, nao restringe (evita quebrar deploy).
  // Configure ALLOWED_ORIGINS em producao para travar as origens.
  if (ORIGENS_PERMITIDAS.length === 0) return true;
  return ORIGENS_PERMITIDAS.includes(origin);
}
if (ORIGENS_PERMITIDAS.length === 0) {
  console.warn('[SEGURANCA] ALLOWED_ORIGINS nao definido — CORS/Socket.IO aceitam qualquer origem. Configure em producao.');
}

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
   AUTENTICACAO — JWT em cookie HttpOnly
========================================================= */

function gerarTokenSessao(usuario) {
  return jwt.sign(
    { usuario: usuario.usuario, nome: usuario.nome },
    JWT_SECRET_EFETIVO,
    { expiresIn: '8h' }
  );
}

function definirCookieSessao(res, token) {
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: EM_PRODUCAO,
    sameSite: 'lax',
    maxAge: SESSAO_MAX_IDADE_MS
  });
}

function limparCookieSessao(res) {
  res.clearCookie(COOKIE_SESSAO, {
    httpOnly: true,
    secure: EM_PRODUCAO,
    sameSite: 'lax'
  });
}

function lerSessao(req) {
  const token = req.cookies?.[COOKIE_SESSAO];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET_EFETIVO);
  } catch {
    return null;
  }
}

// Bloqueia rotas privadas
function requireAuth(req, res, next) {
  const sessao = lerSessao(req);
  if (!sessao) {
    return res.status(401).json({ erro: 'Nao autenticado.' });
  }
  req.usuario = sessao;
  next();
}

// Exige privilegio administrativo
function requireAdmin(req, res, next) {
  const sessao = req.usuario || lerSessao(req);
  if (!sessao) {
    return res.status(401).json({ erro: 'Nao autenticado.' });
  }
  if (!USUARIOS_ADMIN.includes(String(sessao.usuario).toLowerCase())) {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  req.usuario = sessao;
  next();
}

// Limite de tentativas para login (anti brute-force)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});

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
const db = new sqlite3.Database('./database.db');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

console.log('SUPABASE URL EXISTE:', !!process.env.SUPABASE_URL);
console.log('SUPABASE KEY EXISTE:', !!process.env.SUPABASE_KEY);

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

/* UPLOAD DE BOLETOS — SUPABASE STORAGE */

// Multer em memória (sem salvar em disco)
const uploadBoleto = multer({ storage: multer.memoryStorage() });

// Cria o bucket "boletos" automaticamente se não existir
async function garantirBucketBoletos() {
  try {
    const { error } = await supabase.storage.createBucket('Boletos', {
      public: true,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      fileSizeLimit: 10 * 1024 * 1024 // 10 MB
    });
    if (error && !error.message.includes('already exists')) {
      console.error('Erro ao criar bucket boletos:', error.message);
    } else {
      console.log('Bucket "boletos" pronto.');
    }
  } catch (e) {
    console.error('Erro ao garantir bucket:', e.message);
  }
}

garantirBucketBoletos();

async function uploadParaSupabase(buffer, nomeArquivo, mimeType) {
  const { error } = await supabase.storage
    .from('Boletos')
    .upload(nomeArquivo, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage.from('Boletos').getPublicUrl(nomeArquivo);
  return data.publicUrl;
}

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

function atualizarSistema() {
  io.emit('atualizarSistema', {
    timestamp: Date.now()
  });
}

let filaCobrancasWhatsapp = [];
let filaCobrancasRodando = false;
let totalFilaCobrancas = 0;
let enviadasFilaCobrancas = 0;
let errosFilaCobrancas = 0;

function esperar(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function delayAleatorio(minSeg = 45, maxSeg = 90){
  const min = minSeg * 1000;
  const max = maxSeg * 1000;

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function emitirStatusFilaCobrancas(){
  io.emit('fila-cobrancas-status', {
    rodando: filaCobrancasRodando,
    total: totalFilaCobrancas,
    restantes: filaCobrancasWhatsapp.length,
    enviadas: enviadasFilaCobrancas,
    erros: errosFilaCobrancas
  });
}
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

function limparNumero(valor){
  return String(valor || '').replace(/\D/g, '');
}

function normalizarTexto(texto){
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function detectarCPF(texto){
  const match =
    String(texto || '').match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);

  return match ? limparNumero(match[0]) : null;
}

function detectarLinhaDigitavel(texto){
  const match =
    String(texto || '').match(
      /(\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14})/
    );

  return match ? match[0] : null;
}

function detectarValor(texto){
  const valores =
    String(texto || '').match(/R\$\s?\d{1,3}(\.\d{3})*,\d{2}/g);

  if(!valores || valores.length === 0){
    return null;
  }

  const ultimo = valores[valores.length - 1];

  return Number(
    ultimo
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim()
  );
}

function detectarVencimento(texto){
  const match =
    String(texto || '').match(/\d{2}\/\d{2}\/\d{4}/);

  return match ? match[0] : null;
}

async function encontrarResponsavelPorBoleto({ cpf, texto, valor }){

const { data: listaClientes, error: erroClientes } =
  await supabase
    .from('clientes')
    .select('*')
    .order('nome');

if (erroClientes) throw erroClientes;

const { data: listaAlunos, error: erroAlunos } =
  await supabase
    .from('alunos')
    .select('*');

if (erroAlunos) throw erroAlunos;
  if(cpf){

    const porCpf =
      listaClientes.find(cliente =>
        limparNumero(cliente.cpf) === cpf
      );

    if(porCpf){
      return {
        cliente:porCpf,
        confianca:'alta',
        motivo:'CPF encontrado no boleto'
      };
    }

  }

  const textoNormalizado =
    normalizarTexto(texto);

  for(const cliente of listaClientes){

    const nomeNormalizado =
      normalizarTexto(cliente.nome);

    if(
      nomeNormalizado &&
      textoNormalizado.includes(nomeNormalizado)
    ){
      return {
        cliente,
        confianca:'alta',
        motivo:'Nome encontrado no boleto'
      };
    }

  }

  if(valor){

    for(const cliente of listaClientes){

      const alunosCliente =
        listaAlunos.filter(aluno =>
          aluno.responsavel === cliente.nome
        );

      const total =
        alunosCliente.reduce(
          (soma, aluno) =>
            soma + Number(aluno.mensalidade || 0),
          0
        );

      if(Number(total) === Number(valor)){
        return {
          cliente,
          confianca:'media',
          motivo:'Valor bate com total das mensalidades'
        };
      }

    }

  }

  return {
    cliente:null,
    confianca:'baixa',
    motivo:'Nenhum responsável encontrado automaticamente'
  };

}

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

async function processarFilaCobrancasWhatsapp(){

  if(filaCobrancasRodando) return;

  filaCobrancasRodando = true;
  emitirStatusFilaCobrancas();

  let enviadosNoBloco = 0;

  while(filaCobrancasWhatsapp.length > 0){

    const item = filaCobrancasWhatsapp.shift();

    try{

      const cliente = item.cliente;
      const cobranca = item.cobranca;
      const alunos = item.alunos || [];

      if(!whatsappSock){
        throw new Error('WhatsApp não conectado.');
      }

      if(!cliente || !cliente.telefone){
        throw new Error('Responsável sem telefone.');
      }

      if(!cobranca.link_boleto){
        throw new Error('Cobrança sem boleto.');
      }

      const telefoneLimpo = String(cliente.telefone).replace(/\D/g, '');

      const numeroComPais = telefoneLimpo.startsWith('55')
        ? telefoneLimpo
        : `55${telefoneLimpo}`;

      const existeWhatsapp = await whatsappSock.onWhatsApp(numeroComPais);

      if(!existeWhatsapp || !existeWhatsapp.length){
        throw new Error(`Número sem WhatsApp: ${numeroComPais}`);
      }

      const jid = `${numeroComPais}@s.whatsapp.net`;

      const nomesAlunos = alunos.length
        ? alunos.map(aluno => aluno.nome).join(', ')
        : 'Não informado';

      const vencimentos = alunos.length
        ? [...new Set(alunos.map(aluno => `Dia ${aluno.vencimento}`))].join(', ')
        : 'Não informado';

      const mensagem = `
Olá, *${cliente.nome}*. Tudo bem?

Identificamos uma pendência referente ao Instituto Rodrigues Prado.

Aluno(s): *${nomesAlunos}*
Referência: *${cobranca.referencia}*
Vencimento: *${vencimentos}*
Valor: *R$ ${Number(cobranca.valor_total || 0).toFixed(2).replace('.', ',')}*

Boleto:
${cobranca.link_boleto}

${cobranca.linha_digitavel ? `Linha digitável:\n${cobranca.linha_digitavel}` : ''}

Caso já tenha regularizado, por favor desconsidere esta mensagem.
      `.trim();

      await whatsappSock.sendMessage(jid, {
        text: mensagem
      });

      await supabase
        .from('cobrancas')
        .update({
          whatsapp_enviado: 1
        })
        .eq('id', cobranca.id);

      enviadasFilaCobrancas++;
      enviadosNoBloco++;

      atualizarSistema();
      emitirStatusFilaCobrancas();

      if(enviadosNoBloco >= 10){
        enviadosNoBloco = 0;
        await esperar(7 * 60 * 1000);
      }else{
        await esperar(delayAleatorio(45, 90));
      }

    }catch(error){

      console.error('Erro na fila de cobrança:', error.message);

      errosFilaCobrancas++;
      emitirStatusFilaCobrancas();

      await esperar(delayAleatorio(20, 45));

    }

  }

  filaCobrancasRodando = false;
  totalFilaCobrancas = 0;

  atualizarSistema();
  emitirStatusFilaCobrancas();

}





app.post('/api/cobrancas/enviar-em-massa', async (req, res) => {
  try{

    const { referencia } = req.body;

    if(!referencia){
      return res.status(400).json({
        erro: 'Referência não enviada.'
      });
    }

    if(filaCobrancasRodando){
      return res.json({
        sucesso: true,
        mensagem: 'Já existe uma fila de cobranças em andamento.',
        status: {
          rodando: filaCobrancasRodando,
          total: totalFilaCobrancas,
          restantes: filaCobrancasWhatsapp.length,
          enviadas: enviadasFilaCobrancas,
          erros: errosFilaCobrancas
        }
      });
    }

    const { data: cobrancasPendentes, error: erroCobrancas } = await supabase
      .from('cobrancas')
      .select('*')
      .eq('referencia', referencia)
      .or('whatsapp_enviado.is.false,whatsapp_enviado.eq.0,whatsapp_enviado.is.null')
      .not('link_boleto', 'is', null)
      .neq('link_boleto', '');

    if(erroCobrancas) throw erroCobrancas;

    const { data: clientes, error: erroClientes } = await supabase
      .from('clientes')
      .select('*');

    if(erroClientes) throw erroClientes;

    const { data: alunos, error: erroAlunos } = await supabase
      .from('alunos')
      .select('*');

    if(erroAlunos) throw erroAlunos;

    filaCobrancasWhatsapp = (cobrancasPendentes || [])
      .map(cobranca => {

        const cliente = clientes.find(c =>
          Number(c.id) === Number(cobranca.responsavel_id)
        );

        if(!cliente) return null;

        const alunosDoResponsavel = alunos.filter(aluno =>
          aluno.responsavel === cliente.nome
        );

        return {
          cobranca,
          cliente,
          alunos: alunosDoResponsavel
        };

      })
      .filter(Boolean);

    totalFilaCobrancas = filaCobrancasWhatsapp.length;
    enviadasFilaCobrancas = 0;
    errosFilaCobrancas = 0;

    processarFilaCobrancasWhatsapp();

    res.json({
      sucesso: true,
      mensagem: 'Fila de cobranças iniciada.',
      quantidade: filaCobrancasWhatsapp.length
    });

  }catch(error){

    console.error('Erro ao iniciar cobranças em massa:', error);

    res.status(500).json({
      erro: 'Erro ao iniciar cobranças em massa.',
      detalhes: error.message
    });

  }
});


app.get('/api/cobrancas/fila-status', (req, res) => {
  res.json({
    rodando: filaCobrancasRodando,
    total: totalFilaCobrancas,
    restantes: filaCobrancasWhatsapp.length,
    enviadas: enviadasFilaCobrancas,
    erros: errosFilaCobrancas
  });
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


/* =========================================================
WHATSAPP BAILEYS
========================================================= */

let whatsappSock = null;
let whatsappStatus = 'Desconectado';
let whatsappQr = null;
let whatsappInfo = null;
let desconexaoManual = false;

function emitirWhatsapp() {
  io.emit('whatsapp-status', whatsappStatus);
  io.emit('whatsapp-qr', whatsappQr);
  io.emit('whatsapp-info', whatsappInfo);
}

function obterMesAtualReferencia(){
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');

  return `${ano}-${mes}`;
}

function nomeMesAtual(){
  return new Date().toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  });
}

function formatarMoeda(valor){
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function menuSistema(){
  return `🤖 *Sistema Instituto Rodrigues Prado*

Escolha uma opção:

1️⃣ *Status do mês*
2️⃣ *Relatórios em PDF*
3️⃣ *Buscar boleto de responsável*
4️⃣ *Link do sistema*
5️⃣ *Ajuda*

Você também pode digitar:

• Sistema status
• Sistema relatório
• Sistema boleto
• Sistema link
• Sistema ajuda`;
}

async function responderStatusSistema(jid){
  const referencia = obterMesAtualReferencia();
  const [ano, mes] = referencia.split('-').map(Number);

  const { data: alunos, error: erroAlunos } = await supabase
    .from('alunos')
    .select('*');

  if(erroAlunos) throw erroAlunos;

  const { data: pagamentos, error: erroPagamentos } = await supabase
    .from('pagamentosmensais')
    .select('*')
    .eq('referencia', referencia);

  if(erroPagamentos) throw erroPagamentos;

  const { data: financeiro, error: erroFinanceiro } = await supabase
    .from('financeiro')
    .select('*')
    .eq('mes', mes)
    .eq('ano', ano);

  if(erroFinanceiro) throw erroFinanceiro;

  let totalMensalidadesPagas = 0;
  let totalMensalidadesPendentes = 0;

  alunos.forEach(aluno => {
    const pago = pagamentos.some(p =>
      Number(p.alunoid) === Number(aluno.id)
    );

    if(pago){
      totalMensalidadesPagas += Number(aluno.mensalidade || 0);
    }else{
      totalMensalidadesPendentes += Number(aluno.mensalidade || 0);
    }
  });

  const entradas = financeiro
    .filter(item => item.tipo === 'entrada' && item.status === 'pago')
    .reduce((soma, item) => soma + Number(item.valor || 0), 0);

  const saidas = financeiro
    .filter(item => item.tipo === 'saida' && item.status === 'pago')
    .reduce((soma, item) => soma + Number(item.valor || 0), 0);

  const saldoAtual =
    entradas + totalMensalidadesPagas - saidas;

  const mensagem =
`📊 *Status do Mês*
📅 Referência: *${nomeMesAtual()}*

✅ *Mensalidades pagas:* ${formatarMoeda(totalMensalidadesPagas)}
⚠️ *Mensalidades pendentes:* ${formatarMoeda(totalMensalidadesPendentes)}
💰 *Saldo atual do mês:* ${formatarMoeda(saldoAtual)}

🏛️ Instituto Rodrigues Prado`;

  await whatsappSock.sendMessage(jid, {
    text: mensagem
  });
}

function normalizarTelefoneWhatsApp(telefone) {
  let numero = String(telefone || '').replace(/\D/g, '');

  if (!numero.startsWith('55')) {
    numero = `55${numero}`;
  }

  return `${numero}@s.whatsapp.net`;
}

function statusMensalidadeServidor(alunoId, referencia, pagamentos, resolvidas){
  const resolvida = resolvidas.some(r =>
    Number(r.alunoid) === Number(alunoId) &&
    r.referencia === referencia
  );

  if(resolvida) return 'resolvido';

  const pago = pagamentos.some(p =>
    Number(p.alunoid) === Number(alunoId) &&
    p.referencia === referencia
  );

  return pago ? 'pago' : 'pendente';
}

function verificarAtrasoServidor(aluno, referencia){
  const [ano, mes] = referencia.split('-').map(Number);

  const vencimento = new Date(
    ano,
    mes - 1,
    Number(aluno.vencimento || 30),
    23,
    59,
    59
  );

  return new Date() > vencimento;
}

function desenharCabecalhoPdf(doc, titulo){
  doc.rect(0, 0, 842, 90).fill('#030c22');

  doc.fillColor('#f5d76e')
    .fontSize(22)
    .text('Instituto Rodrigues Prado', 40, 28);

  doc.fillColor('#ffffff')
    .fontSize(11)
    .text('Sistema Administrativo Financeiro', 40, 56);

  doc.fillColor('#f5d76e')
    .fontSize(18)
    .text(titulo, 0, 115, {
      align: 'center'
    });

  doc.fillColor('#555555')
    .fontSize(10)
    .text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 0, 140, {
      align: 'center'
    });
}

function desenharCardPdf(doc, titulo, valor, x, y){
  doc.roundedRect(x, y, 145, 55, 8)
    .fillAndStroke('#f8f8f8', '#d4af37');

  doc.fillColor('#444444')
    .fontSize(10)
    .text(titulo, x + 15, y + 14);

  doc.fillColor('#030c22')
    .fontSize(15)
    .text(String(valor), x + 15, y + 32);
}

function desenharRodapePdf(doc, pagina, totalPaginas = ''){
  const y = doc.page.height - 25;

  doc.fontSize(9)
    .fillColor('#666')
    .text(
      `Instituto Rodrigues Prado • Página ${pagina}${totalPaginas ? ` de ${totalPaginas}` : ''}`,
      0,
      y,
      {
        width: doc.page.width,
        align: 'center'
      }
    );
}

async function gerarRelatorioFinanceiroPremium(caminhoArquivo){
  const referencia = obterMesAtualReferencia();
  const [ano, mes] = referencia.split('-').map(Number);

  const { data: alunos = [], error: erroAlunos } =
    await supabase.from('alunos').select('*');

  if(erroAlunos) throw erroAlunos;

  const { data: financeiro = [], error: erroFinanceiro } =
    await supabase.from('financeiro').select('*');

  if(erroFinanceiro) throw erroFinanceiro;

  const { data: pagamentos = [], error: erroPagamentos } =
    await supabase
      .from('pagamentosmensais')
      .select('*')
      .eq('referencia', referencia);

  if(erroPagamentos) throw erroPagamentos;

  const { data: resolvidas = [], error: erroResolvidas } =
    await supabase
      .from('mensalidadesresolvidas')
      .select('*')
      .eq('referencia', referencia);

  if(erroResolvidas) throw erroResolvidas;

  let entradasManuais = 0;
  let saidasManuais = 0;
  let mensalidadesRecebidas = 0;
  let mensalidadesPendentes = 0;
  let mensalidadesAtrasadas = 0;

  const linhas = [];

  financeiro.forEach(item => {
    const valor = Number(item.valor || 0);

    if(item.status === 'pago'){
      if(item.tipo === 'entrada') entradasManuais += valor;
      if(item.tipo === 'saida') saidasManuais += valor;
    }

    linhas.push([
      item.data || '-',
      'Financeiro',
      item.descricao || '-',
      item.categoria || '-',
      item.tipo || '-',
      formatarMoeda(valor),
      String(item.status || '-').toUpperCase()
    ]);
  });

  alunos.forEach(aluno => {
    const status = statusMensalidadeServidor(
      aluno.id,
      referencia,
      pagamentos,
      resolvidas
    );

    const estaAtrasado =
      status === 'pendente' &&
      verificarAtrasoServidor(aluno, referencia);

    const statusFinal =
      estaAtrasado ? 'ATRASADO' : status.toUpperCase();

    const valor = Number(aluno.mensalidade || 0);

    if(status === 'pago'){
      mensalidadesRecebidas += valor;
    }else if(status !== 'resolvido'){
      mensalidadesPendentes += valor;
    }

    if(estaAtrasado){
      mensalidadesAtrasadas += valor;
    }

    linhas.push([
      referencia,
      'Mensalidade',
      aluno.nome || '-',
      aluno.responsavel || '-',
      'entrada',
      formatarMoeda(valor),
      statusFinal
    ]);
  });

  const totalEntradas = entradasManuais + mensalidadesRecebidas;
  const totalSaidas = saidasManuais;
  const saldoGeral = totalEntradas - totalSaidas;

  await new Promise((resolve, reject) => {
const doc = new PDFDocument({
  size: 'A4',
  layout: 'landscape',
  margin: 40,
  bufferPages: true
});

    const stream = fs.createWriteStream(caminhoArquivo);

    stream.on('finish', resolve);
    stream.on('error', reject);

    doc.pipe(stream);

    desenharCabecalhoPdf(doc, 'Relatório Financeiro Geral');

    desenharCardPdf(doc, 'Entradas', formatarMoeda(totalEntradas), 40, 185);
    desenharCardPdf(doc, 'Saídas', formatarMoeda(totalSaidas), 210, 185);
    desenharCardPdf(doc, 'Saldo Geral', formatarMoeda(saldoGeral), 380, 185);
    desenharCardPdf(doc, 'Referência', referencia, 550, 185);

    const graficoY = 300;
    const alturaMax = 80;
    const maiorValor = Math.max(totalEntradas, totalSaidas, 1);

    const alturaEntrada = (totalEntradas / maiorValor) * alturaMax;
    const alturaSaida = (totalSaidas / maiorValor) * alturaMax;

    doc.fillColor('#030c22')
      .fontSize(14)
      .text('Entradas x Saídas', 65, 270);

    doc.rect(70, graficoY + alturaMax - alturaEntrada, 60, alturaEntrada)
      .fill('#22c55e');

    doc.rect(170, graficoY + alturaMax - alturaSaida, 60, alturaSaida)
      .fill('#ef4444');

    doc.fillColor('#000000')
      .fontSize(9)
      .text('Entradas', 70, 390)
      .text(formatarMoeda(totalEntradas), 70, 405)
      .text('Saídas', 170, 390)
      .text(formatarMoeda(totalSaidas), 170, 405);

    const maiorMensalidade = Math.max(
      mensalidadesRecebidas,
      mensalidadesPendentes,
      mensalidadesAtrasadas,
      1
    );

    const alturaRecebidas = (mensalidadesRecebidas / maiorMensalidade) * alturaMax;
    const alturaPendentes = (mensalidadesPendentes / maiorMensalidade) * alturaMax;
    const alturaAtrasadas = (mensalidadesAtrasadas / maiorMensalidade) * alturaMax;

    doc.fillColor('#030c22')
      .fontSize(14)
      .text('Situação das Mensalidades', 430, 270);

    doc.rect(430, graficoY + alturaMax - alturaRecebidas, 55, alturaRecebidas)
      .fill('#22c55e');

    doc.rect(520, graficoY + alturaMax - alturaPendentes, 55, alturaPendentes)
      .fill('#f59e0b');

    doc.rect(610, graficoY + alturaMax - alturaAtrasadas, 55, alturaAtrasadas)
      .fill('#ef4444');

    doc.fillColor('#000000')
      .fontSize(8)
      .text('Recebidas', 430, 390)
      .text(formatarMoeda(mensalidadesRecebidas), 430, 405)
      .text('Pendentes', 520, 390)
      .text(formatarMoeda(mensalidadesPendentes), 520, 405)
      .text('Atrasadas', 610, 390)
      .text(formatarMoeda(mensalidadesAtrasadas), 610, 405);


doc.addPage();

desenharCabecalhoPdf(doc, 'Tabela Financeira');

let y = 115;

    doc.rect(35, y, 770, 24).fill('#030c22');

    doc.fillColor('#f5d76e')
      .fontSize(8)
      .text('Data/Ref.', 42, y + 8)
      .text('Origem', 105, y + 8)
      .text('Descrição', 175, y + 8)
      .text('Categoria/Responsável', 350, y + 8)
      .text('Tipo', 545, y + 8)
      .text('Valor', 610, y + 8)
      .text('Status', 700, y + 8);

    y += 30;

    linhas.forEach((linha, index) => {
if(y > 535){
  doc.addPage();

  desenharCabecalhoPdf(doc, 'Tabela Financeira');

  doc.rect(35, 115, 770, 24).fill('#030c22');

  doc.fillColor('#f5d76e')
    .fontSize(8)
    .text('Data/Ref.', 42, 123)
    .text('Origem', 105, 123)
    .text('Descrição', 175, 123)
    .text('Categoria/Responsável', 350, 123)
    .text('Tipo', 545, 123)
    .text('Valor', 610, 123)
    .text('Status', 700, 123);

  y = 145;
}
      if(index % 2 === 0){
        doc.rect(35, y - 4, 770, 22).fill('#f8f8f8');
      }

      doc.fillColor('#000000')
        .fontSize(7)
        .text(String(linha[0]), 42, y, { width: 58 })
        .text(String(linha[1]), 105, y, { width: 65 })
        .text(String(linha[2]), 175, y, { width: 165 })
        .text(String(linha[3]), 350, y, { width: 185 })
        .text(String(linha[4]), 545, y, { width: 55 })
        .text(String(linha[5]), 610, y, { width: 80 })
        .text(String(linha[6]), 700, y, { width: 80 });

      y += 22;
    });

const totalPaginas = doc.bufferedPageRange().count;

for(let i = 0; i < totalPaginas; i++){
  doc.switchToPage(i);
  desenharRodapePdf(doc, i + 1, totalPaginas);
}

doc.end();
  });

  return {
    caminhoArquivo,
    nomeArquivo: `relatorio-financeiro-geral-${referencia}.pdf`,
    referencia
  };
}

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

async function enviarPdfWhatsApp(jid, caminhoArquivo, nomeArquivo, legenda){
  await whatsappSock.sendMessage(jid, {
    document: fs.readFileSync(caminhoArquivo),
    mimetype: 'application/pdf',
    fileName: nomeArquivo,
    caption: legenda
  });

  fs.unlinkSync(caminhoArquivo);
}

async function gerarRelatorioFinanceiroSistema(jid){
  const referencia = obterMesAtualReferencia();
  const [ano, mes] = referencia.split('-').map(Number);

  const { data: alunos = [], error: erroAlunos } =
    await supabase.from('alunos').select('*');

  if(erroAlunos) throw erroAlunos;

  const { data: financeiro = [], error: erroFinanceiro } =
    await supabase.from('financeiro').select('*');

  if(erroFinanceiro) throw erroFinanceiro;

  const { data: pagamentos = [], error: erroPagamentos } =
    await supabase
      .from('pagamentosmensais')
      .select('*')
      .eq('referencia', referencia);

  if(erroPagamentos) throw erroPagamentos;

  const { data: resolvidas = [], error: erroResolvidas } =
    await supabase
      .from('mensalidadesresolvidas')
      .select('*')
      .eq('referencia', referencia);

  if(erroResolvidas) throw erroResolvidas;

  let entradasManuais = 0;
  let saidasManuais = 0;
  let mensalidadesRecebidas = 0;
  let mensalidadesPendentes = 0;
  let mensalidadesAtrasadas = 0;

  financeiro.forEach(item => {
    if(item.status !== 'pago') return;

    if(Number(item.mes) !== Number(mes)) return;
    if(Number(item.ano) !== Number(ano)) return;

    if(item.tipo === 'entrada'){
      entradasManuais += Number(item.valor || 0);
    }

    if(item.tipo === 'saida'){
      saidasManuais += Number(item.valor || 0);
    }
  });

  alunos.forEach(aluno => {
    const status = statusMensalidadeServidor(
      aluno.id,
      referencia,
      pagamentos,
      resolvidas
    );

    const valor = Number(aluno.mensalidade || 0);

    if(status === 'pago'){
      mensalidadesRecebidas += valor;
    }else if(status !== 'resolvido'){
      mensalidadesPendentes += valor;

      if(verificarAtrasoServidor(aluno, referencia)){
        mensalidadesAtrasadas += valor;
      }
    }
  });

  const totalEntradas = entradasManuais + mensalidadesRecebidas;
  const totalSaidas = saidasManuais;
  const saldoGeral = totalEntradas - totalSaidas;

  const nomeArquivo = `relatorio-financeiro-geral-${referencia}.pdf`;
  const caminhoArquivo = path.join(__dirname, 'uploads', nomeArquivo);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40
    });

    const stream = fs.createWriteStream(caminhoArquivo);

    stream.on('finish', resolve);
    stream.on('error', reject);

    doc.pipe(stream);

    doc.fontSize(20).text('Instituto Rodrigues Prado', { align:'center' });
    doc.fontSize(11).text('Sistema Administrativo Financeiro', { align:'center' });
    doc.moveDown();
    doc.fontSize(17).text('Relatório Financeiro Geral', { align:'center' });
    doc.fontSize(10).text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, { align:'center' });

    doc.moveDown(2);

    doc.fontSize(13).text(`Referência: ${referencia}`);
    doc.text(`Entradas: ${formatarMoeda(totalEntradas)}`);
    doc.text(`Saídas: ${formatarMoeda(totalSaidas)}`);
    doc.text(`Saldo Geral: ${formatarMoeda(saldoGeral)}`);
    doc.text(`Mensalidades Recebidas: ${formatarMoeda(mensalidadesRecebidas)}`);
    doc.text(`Mensalidades Pendentes: ${formatarMoeda(mensalidadesPendentes)}`);
    doc.text(`Mensalidades Atrasadas: ${formatarMoeda(mensalidadesAtrasadas)}`);

    doc.moveDown(2);
    doc.fontSize(15).text('Movimentações Financeiras');

    financeiro
      .filter(item =>
        Number(item.mes) === Number(mes) &&
        Number(item.ano) === Number(ano)
      )
      .forEach(item => {
        doc.fontSize(10).text(
          `${item.data || '-'} | ${item.descricao || '-'} | ${item.categoria || '-'} | ${item.tipo || '-'} | ${formatarMoeda(item.valor)} | ${String(item.status || '-').toUpperCase()}`
        );
      });

    doc.moveDown();
    doc.fontSize(15).text('Mensalidades');

    alunos.forEach(aluno => {
      const status = statusMensalidadeServidor(
        aluno.id,
        referencia,
        pagamentos,
        resolvidas
      );

      const atrasado =
        status === 'pendente' &&
        verificarAtrasoServidor(aluno, referencia);

      const statusFinal =
        atrasado ? 'ATRASADO' : status.toUpperCase();

      doc.fontSize(10).text(
        `${aluno.nome || '-'} | ${aluno.responsavel || '-'} | ${formatarMoeda(aluno.mensalidade)} | ${statusFinal}`
      );
    });

    doc.end();
  });

  await enviarPdfWhatsApp(
    jid,
    caminhoArquivo,
    nomeArquivo,
    `📄 Relatório Financeiro Geral - ${referencia}`
  );
}

async function gerarRelatorioAlunosSistema(jid){
  const { data: alunos = [], error } =
    await supabase
      .from('alunos')
      .select('*')
      .order('nome');

  if(error) throw error;

  const nomeArquivo = `relatorio-alunos-instituto.pdf`;
  const caminhoArquivo = path.join(__dirname, 'uploads', nomeArquivo);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40
    });

    const stream = fs.createWriteStream(caminhoArquivo);

    stream.on('finish', resolve);
    stream.on('error', reject);

    doc.pipe(stream);

    doc.fontSize(20).text('Instituto Rodrigues Prado', { align:'center' });
    doc.fontSize(11).text('Sistema Administrativo Financeiro', { align:'center' });
    doc.moveDown();
    doc.fontSize(17).text('Relatório de Alunos', { align:'center' });
    doc.fontSize(10).text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, { align:'center' });

    doc.moveDown(2);

    doc.fontSize(13).text(`Total de alunos: ${alunos.length}`);
    doc.moveDown();

    alunos.forEach((aluno, index) => {
      doc.fontSize(10).text(
        `${index + 1}. ${aluno.nome || '-'} | Responsável: ${aluno.responsavel || '-'} | Mensalidade: ${formatarMoeda(aluno.mensalidade)} | Vencimento: Dia ${aluno.vencimento || '-'} | Matrícula: ${String(aluno.mesmatricula || '').padStart(2,'0')}/${aluno.anomatricula || ''}`
      );
    });

    doc.end();
  });

  await enviarPdfWhatsApp(
    jid,
    caminhoArquivo,
    nomeArquivo,
    '📚 Relatório de Alunos'
  );
}

async function gerarRelatorioMensalidadesSistema(jid){
  const referencia = obterMesAtualReferencia();

  const { data: alunos = [], error: erroAlunos } =
    await supabase.from('alunos').select('*').order('nome');

  if(erroAlunos) throw erroAlunos;

  const { data: pagamentos = [], error: erroPagamentos } =
    await supabase
      .from('pagamentosmensais')
      .select('*')
      .eq('referencia', referencia);

  if(erroPagamentos) throw erroPagamentos;

  const { data: resolvidas = [], error: erroResolvidas } =
    await supabase
      .from('mensalidadesresolvidas')
      .select('*')
      .eq('referencia', referencia);

  if(erroResolvidas) throw erroResolvidas;

  const nomeArquivo = `relatorio-mensalidades-${referencia}.pdf`;
  const caminhoArquivo = path.join(__dirname, 'uploads', nomeArquivo);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40
    });

    const stream = fs.createWriteStream(caminhoArquivo);

    stream.on('finish', resolve);
    stream.on('error', reject);

    doc.pipe(stream);

    doc.fontSize(20).text('Instituto Rodrigues Prado', { align:'center' });
    doc.fontSize(11).text('Sistema Administrativo Financeiro', { align:'center' });
    doc.moveDown();
    doc.fontSize(17).text('Relatório de Mensalidades', { align:'center' });
    doc.fontSize(10).text(`Referência: ${referencia}`, { align:'center' });
    doc.fontSize(10).text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, { align:'center' });

    doc.moveDown(2);

    alunos.forEach((aluno, index) => {
      const status = statusMensalidadeServidor(
        aluno.id,
        referencia,
        pagamentos,
        resolvidas
      );

      const atrasado =
        status === 'pendente' &&
        verificarAtrasoServidor(aluno, referencia);

      const statusFinal =
        atrasado ? 'ATRASADO' : status.toUpperCase();

      doc.fontSize(10).text(
        `${index + 1}. ${aluno.nome || '-'} | Responsável: ${aluno.responsavel || '-'} | ${formatarMoeda(aluno.mensalidade)} | Dia ${aluno.vencimento || '-'} | ${statusFinal}`
      );
    });

    doc.end();
  });

  await enviarPdfWhatsApp(
    jid,
    caminhoArquivo,
    nomeArquivo,
    `💳 Relatório de Mensalidades - ${referencia}`
  );
}

let gerenciadorContexto = null;
let processador = null;

async function iniciarWhatsapp() {
  try {
    const baileys = await import('@whiskeysockets/baileys');

    const makeWASocket = baileys.default;

    const {
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion
    } = baileys;

    const { state, saveCreds } =
      await useMultiFileAuthState('./auth_info_baileys');

    const { version } =
      await fetchLatestBaileysVersion();

    whatsappSock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: [
        'Instituto Rodrigues Prado',
        'Chrome',
        '1.0.0'
      ]
    });

    whatsappSock.ev.on('creds.update', saveCreds);
    // processador = new ProcessadorMensagens(
//   supabase,
//   whatsappSock,
//   gerenciadorContexto
// );

whatsappSock.ev.on('messages.upsert', async ({ messages }) => {
  try {
    const msg = messages[0];

    if (!msg || !msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const NOME_GRUPO_PERMITIDO = 'Financeiro Instituto Rodrigues Prado';

    if (!jid.endsWith('@g.us')) return;

    const metadataGrupo = await whatsappSock.groupMetadata(jid);
    const nomeGrupo = metadataGrupo.subject;

    if (nomeGrupo !== NOME_GRUPO_PERMITIDO) return;

    if (!processador) {
      console.log('Processador ainda não iniciado.');
      return;
    }

    await processador.processar(msg, jid);

  } catch (error) {
    console.log('ERRO NO ROBÔ DO WHATSAPP:', error);

    try {
      const jidErro = messages?.[0]?.key?.remoteJid;

      if (jidErro) {
        await whatsappSock.sendMessage(jidErro, {
          text: '❌ Ocorreu um erro ao executar esse comando.'
        });
      }
    } catch {}
  }
});

    whatsappSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('QR CODE BAILEYS RECEBIDO');

        whatsappStatus = 'Aguardando conexão';
        whatsappQr = await qrcode.toDataURL(qr);
        whatsappInfo = null;

        emitirWhatsapp();
      }

      if (connection === 'open') {
        console.log('WHATSAPP BAILEYS CONECTADO');

        whatsappStatus = 'Conectado';
        whatsappQr = null;

        whatsappInfo = {
          nome:
            whatsappSock.user?.name ||
            whatsappSock.user?.verifiedName ||
            'WhatsApp conectado',

          numero:
            String(whatsappSock.user?.id || '')
              .split(':')[0]
              .replace('@s.whatsapp.net', '')
        };

        emitirWhatsapp();
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        console.log('WHATSAPP DESCONECTOU:', statusCode);

        whatsappStatus = 'Desconectado';
        whatsappQr = null;
        whatsappInfo = null;

        emitirWhatsapp();

        const deveReconectar =
          !desconexaoManual &&
          statusCode !== DisconnectReason.loggedOut;

        if (deveReconectar) {
          setTimeout(iniciarWhatsapp, 3000);
        }
      }
    });

  } catch (error) {
    console.log('ERRO AO INICIAR WHATSAPP:', error);

    whatsappStatus = 'Erro ao iniciar';
    whatsappQr = null;
    whatsappInfo = null;

    emitirWhatsapp();
  }
}
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

io.on('connection', (socket) => {
  socket.emit('whatsapp-status', whatsappStatus);
  socket.emit('whatsapp-qr', whatsappQr);
  socket.emit('whatsapp-info', whatsappInfo);
});

iniciarWhatsapp();

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: whatsappStatus,
    conectado: whatsappStatus === 'Conectado',
    info: whatsappInfo
  });
});

app.post('/api/whatsapp/desconectar', async (req, res) => {
  try {
    desconexaoManual = true;

    if (whatsappSock) {
      await whatsappSock.logout().catch(() => {});
      whatsappSock.end?.();
      whatsappSock = null;
    }

    fs.rmSync('./auth_info_baileys', {
      recursive: true,
      force: true
    });

    whatsappStatus = 'Desconectado';
    whatsappQr = null;
    whatsappInfo = null;

    emitirWhatsapp();

    setTimeout(() => {
      desconexaoManual = false;
      iniciarWhatsapp();
    }, 1500);

    res.json({ sucesso: true });

  } catch (error) {
    console.log(error);

    res.status(500).json({
      erro: 'Erro ao desconectar WhatsApp'
    });
  }
});

app.post('/api/whatsapp/enviar-cobranca', async (req, res) => {
  try {
    if (!whatsappSock || whatsappStatus !== 'Conectado') {
      return res.status(400).json({
        erro: 'WhatsApp não está conectado.'
      });
    }

    const {
      telefone,
      responsavel,
      aluno,
      valor,
      vencimento,
      link_boleto,
      linha_digitavel,
      responsavel_id,
      referencia
    } = req.body;

    const jid = normalizarTelefoneWhatsApp(telefone);

    const boletoTemArquivo =
      link_boleto &&
      (link_boleto.startsWith('/uploads/') || link_boleto.includes('supabase'));

    const textoBoleto = boletoTemArquivo
      ? '📎 *Boleto em anexo nesta mensagem.*'
      : `🔗 *Link do boleto:*\n${link_boleto}`;

const mensagem =
`🏛️ *Instituto Rodrigues Prado*

Olá, ${responsavel}!

Seu boleto referente à mensalidade de *${aluno}* já foi gerado.

💰 *Valor:* R$ ${Number(valor).toFixed(2).replace('.', ',')}
📅 *Vencimento:* ${vencimento}

${textoBoleto}

${linha_digitavel ? `📄 *Linha digitável:*\n${linha_digitavel}\n\n` : ''}✅ Após realizar o pagamento, pedimos a gentileza de enviar o comprovante por esta mesma conversa para que possamos registrar a baixa da mensalidade com mais agilidade.

⚠️ Caso o pagamento já tenha sido efetuado ou o comprovante já tenha sido enviado, por favor desconsidere esta mensagem.

🤝 Agradecemos pela atenção e permanecemos à disposição para qualquer dúvida.
Pedimos desculpas, pelo horário repentino!!!

🏛️ *Instituto Rodrigues Prado*`;
    const existe = await whatsappSock.onWhatsApp(jid);

    if (!existe || existe.length === 0 || !existe[0].exists) {
      return res.status(400).json({
        erro: 'Este número não foi encontrado no WhatsApp.',
        numero: jid
      });
    }

    const jidValidado = existe[0].jid;

    let bufferPdf = null;

    if(link_boleto && link_boleto.startsWith('/uploads/')){
      // Legado: arquivo local
      const caminhoPdf = path.join(__dirname, link_boleto);
      if(fs.existsSync(caminhoPdf)){
        bufferPdf = fs.readFileSync(caminhoPdf);
      }
    } else if(link_boleto && link_boleto.includes('supabase')){
      // Novo: baixa do Supabase Storage
      try {
        const resposta = await fetch(link_boleto);
        bufferPdf = Buffer.from(await resposta.arrayBuffer());
      } catch(e) {
        console.error('Erro ao baixar PDF do Supabase:', e.message);
      }
    }

    if(bufferPdf){
      await whatsappSock.sendMessage(jidValidado, {
        document: bufferPdf,
        mimetype: 'application/pdf',
        fileName: `boleto-${responsavel}.pdf`,
        caption: mensagem
      });
    } else {
      await whatsappSock.sendMessage(jidValidado, {
        text: mensagem
      });
    }
const { error: erroWhatsapp } = await supabase
  .from('cobrancas')
  .update({ whatsapp_enviado: 1 })
  .eq('responsavel_id', responsavel_id)
  .eq('referencia', referencia);

if (erroWhatsapp) throw erroWhatsapp;
    atualizarSistema();

    res.json({
      sucesso: true,
      whatsapp_enviado: true
    });

  } catch (error) {
    console.log(error);

    res.status(500).json({
      erro: 'Erro ao enviar cobrança pelo WhatsApp',
      detalhes: error.message
    });
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