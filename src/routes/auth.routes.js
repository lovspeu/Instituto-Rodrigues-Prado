const express=require('express');
const router=express.Router();
const supabase=require('../config/supabase');
const bcrypt=require('bcryptjs');
const { gerarTokenSessao, definirCookieSessao, limparCookieSessao, lerSessao, limiteLogin, requireAuth }=require('../middlewares/auth');

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

router.post('/api/login', limiteLogin, async (req, res) => {
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
router.get('/api/auth/me', (req, res) => {
  const sessao = lerSessao(req);
  if (!sessao) return res.status(401).json({ autenticado: false });
  res.json({
    autenticado: true,
    usuario: { usuario: sessao.usuario, nome: sessao.nome }
  });
});

// Logout real — invalida o cookie de sessao
router.post('/api/auth/logout', (req, res) => {
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
router.patch('/api/usuarios/senha', requireAuth, async (req, res) => {
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

module.exports=router;
