const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/alunos', async (req, res) => {
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

router.post('/api/alunos', async (req, res) => {
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

router.delete('/api/alunos/:id', async (req, res) => {
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

module.exports = router;
