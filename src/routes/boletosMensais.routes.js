const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/boletosMensais', async (req, res) => {
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

router.post('/api/boletosMensais', async (req, res) => {
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

    atualizarSistema('boletosMensais');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar boleto mensal:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar boleto mensal.' });
  }
});

router.delete('/api/boletosMensais', async (req, res) => {
  try {
    const { alunoId, referencia } = req.body;

    const { error } = await supabase
      .from('boletosmensais')
      .delete()
      .eq('alunoid', alunoId)
      .eq('referencia', referencia);

    if (error) throw error;

    atualizarSistema('boletosMensais');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover boleto mensal:', error);
    res.status(500).json({ erro: 'Erro ao remover boleto mensal.' });
  }
});

module.exports = router;
