const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/financeiro', async (req, res) => {
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

router.post('/api/financeiro', async (req, res) => {
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

    atualizarSistema('financeiro');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar financeiro.' });
  }
});

router.patch('/api/financeiro/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    const { error } = await supabase
      .from('financeiro')
      .update({ status })
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema('financeiro');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao atualizar status financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao atualizar status financeiro.' });
  }
});

router.delete('/api/financeiro/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('financeiro')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema('financeiro');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover financeiro no Supabase:', error);
    res.status(500).json({ erro: 'Erro ao remover financeiro.' });
  }
});

module.exports = router;
