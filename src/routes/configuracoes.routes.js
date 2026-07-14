const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/configuracoes', async (req, res) => {
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

router.patch('/api/configuracoes', async (req, res) => {
  try {
    const { chave, valor } = req.body;

    const { error } = await supabase
      .from('configuracoes')
      .upsert([{ chave, valor }], { onConflict: 'chave' });

    if (error) throw error;

    atualizarSistema('configuracoes');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao salvar configuração:', error);
    res.status(500).json({ erro: 'Erro ao salvar configuração.' });
  }
});
router.get('/api/modo-censura', async (req, res) => {
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

router.patch('/api/modo-censura', async (req, res) => {
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

    atualizarSistema('configuracoes');

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

module.exports = router;
