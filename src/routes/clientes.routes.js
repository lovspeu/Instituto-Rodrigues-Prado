const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/clientes', async (req, res) => {
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

router.post('/api/clientes', async (req, res) => {
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

router.patch('/api/clientes/:id', async (req, res) => {
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

router.delete('/api/clientes/:id', async (req, res) => {
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

module.exports = router;
