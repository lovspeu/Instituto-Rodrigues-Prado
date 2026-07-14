/* =========================================================
   Configuracao central de ambiente e seguranca
   ========================================================= */
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[SEGURANCA] JWT_SECRET nao definido no .env — defina um valor forte antes de ir para producao.');
}

const ORIGENS_PERMITIDAS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (ORIGENS_PERMITIDAS.length === 0) {
  console.warn('[SEGURANCA] ALLOWED_ORIGINS nao definido — CORS/Socket.IO aceitam qualquer origem. Configure em producao.');
}

// Same-origin (sem Origin) sempre permitido; se ALLOWED_ORIGINS vazio, nao restringe.
function origemPermitida(origin) {
  if (!origin) return true;
  if (ORIGENS_PERMITIDAS.length === 0) return true;
  return ORIGENS_PERMITIDAS.includes(origin);
}

const USUARIOS_ADMIN = (process.env.ADMIN_USERS || 'rosangela,adriana,joao')
  .split(',')
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);

module.exports = {
  PORT: process.env.PORT || 3000,
  EM_PRODUCAO: process.env.NODE_ENV === 'production',
  JWT_SECRET_EFETIVO: JWT_SECRET || 'dev-secret-inseguro-trocar',
  COOKIE_SESSAO: 'irp_sessao',
  SESSAO_MAX_IDADE_MS: 1000 * 60 * 60 * 8, // 8 horas
  ORIGENS_PERMITIDAS,
  USUARIOS_ADMIN,
  origemPermitida
};
