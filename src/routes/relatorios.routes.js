const express=require('express');
const router=express.Router();
const path=require('path');
const fs=require('fs');
const { gerarRelatorioFinanceiroPremium }=require('../services/relatorios');
const { obterMesAtualReferencia }=require('../utils/format');

router.get('/api/relatorios/financeiro/pdf', async (req, res) => {
  try {
    const referencia = obterMesAtualReferencia();

    const nomeArquivo =
      `relatorio-financeiro-geral-${referencia}.pdf`;

    const caminhoArquivo =
      path.join(process.cwd(), 'uploads', nomeArquivo);

    await gerarRelatorioFinanceiroPremium(caminhoArquivo);

    res.download(caminhoArquivo, nomeArquivo, () => {
      fs.unlinkSync(caminhoArquivo);
    });

  } catch (error) {
    console.error('Erro ao gerar relatório financeiro:', error);

    res.status(500).json({
      erro:'Erro ao gerar relatório financeiro.',
      detalhes:error.message
    });
  }
});

module.exports=router;
