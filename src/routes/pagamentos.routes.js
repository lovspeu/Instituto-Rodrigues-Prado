const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/pagamentosMensais', async (req, res) => {
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

router.post('/api/pagamentosMensais', async (req, res) => {
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

router.delete('/api/pagamentosMensais', async (req, res) => {
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

module.exports = router;
