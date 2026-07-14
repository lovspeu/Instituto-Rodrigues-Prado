const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { atualizarSistema } = require('../services/realtime');

router.get('/api/mensalidadesResolvidas', async (req, res) => {
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

router.post('/api/mensalidadesResolvidas', async (req, res) => {
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

    atualizarSistema('mensalidadesResolvidas');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar mensalidade resolvida:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar mensalidade resolvida.' });
  }
});

router.delete('/api/mensalidadesResolvidas', async (req, res) => {
  try {
    const { alunoId, referencia } = req.body;

    const { error } = await supabase
      .from('mensalidadesresolvidas')
      .delete()
      .eq('alunoid', alunoId)
      .eq('referencia', referencia);

    if (error) throw error;

    atualizarSistema('mensalidadesResolvidas');
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover mensalidade resolvida:', error);
    res.status(500).json({ erro: 'Erro ao remover mensalidade resolvida.' });
  }
});

module.exports = router;
