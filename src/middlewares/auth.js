/* =========================================================
   Autenticacao — JWT em cookie HttpOnly + guards
   ========================================================= */
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const {
  JWT_SECRET_EFETIVO,
  COOKIE_SESSAO,
  SESSAO_MAX_IDADE_MS,
  EM_PRODUCAO,
  USUARIOS_ADMIN
} = require('../config/env');

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

module.exports = {
  gerarTokenSessao,
  definirCookieSessao,
  limparCookieSessao,
  lerSessao,
  requireAuth,
  requireAdmin,
  limiteLogin
};
