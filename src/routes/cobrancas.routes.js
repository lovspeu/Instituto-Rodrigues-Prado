const express=require('express');
const router=express.Router();
const path=require('path');
const fs=require('fs');
const pdfParseLib=require('pdf-parse');
const pdfParse=typeof pdfParseLib==='function'?pdfParseLib:pdfParseLib.default;
const supabase=require('../config/supabase');
const { atualizarSistema }=require('../services/realtime');
const { requireAdmin }=require('../middlewares/auth');
const { uploadBoleto, uploadParaSupabase, encontrarResponsavelPorBoleto }=require('../services/boletos');
const { detectarCPF, detectarLinhaDigitavel, detectarValor, detectarVencimento }=require('../utils/format');

router.post('/api/cobrancas/importar-boleto', uploadBoleto.single('boleto'), async (req, res) => {
  try{

    if(!req.file){
      return res.status(400).json({
        erro:'Nenhum boleto enviado.'
      });
    }

    const referencia = req.body.referencia;

    if(!referencia){
      return res.status(400).json({
        erro:'Referência não enviada.'
      });
    }

    const extensao = path.extname(req.file.originalname) || (req.file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
    const nomeArquivo = `boleto-${Date.now()}${extensao}`;
    const buffer = req.file.buffer;

    // Faz upload para Supabase Storage
    const urlArquivo = await uploadParaSupabase(buffer, nomeArquivo, req.file.mimetype);

    let textoExtraido = '';

    if(req.file.mimetype === 'application/pdf'){

      console.log('LENDO PDF...');

      if(typeof pdfParse !== 'function'){
        throw new Error('pdfParse não é função. Tipo: ' + typeof pdfParse);
      }

      const pdf = await pdfParse(buffer);

      textoExtraido = pdf.text || '';

    }

    const cpfDetectado =
      detectarCPF(textoExtraido);

    const linhaDigitavel =
      detectarLinhaDigitavel(textoExtraido);

    const valorDetectado =
      detectarValor(textoExtraido);

    const vencimentoDetectado =
      detectarVencimento(textoExtraido);

    const resultado =
      await encontrarResponsavelPorBoleto({
        cpf:cpfDetectado,
        texto:textoExtraido,
        valor:valorDetectado
      });

    if(!resultado.cliente){

      return res.json({
        sucesso:false,
        precisa_confirmar:true,
        mensagem:'Boleto importado, mas não consegui identificar o responsável automaticamente.',
        arquivo_boleto:urlArquivo,
        cpf_detectado:cpfDetectado,
        linha_digitavel:linhaDigitavel,
        valor_detectado:valorDetectado,
        vencimento_detectado:vencimentoDetectado,
        confianca:resultado.confianca,
        motivo:resultado.motivo
      });

    }

    const id = Date.now();

const { error } = await supabase
  .from('cobrancas')
  .insert([{
    id,
    responsavel_id: resultado.cliente.id,
    referencia,
    valor_total: valorDetectado || 0,
    status: 'pendente',
    link_boleto: urlArquivo,
    linha_digitavel: linhaDigitavel,
    modo: 'manual',
    criadoem: new Date().toLocaleDateString('pt-BR'),
    arquivo_boleto: urlArquivo,
    origem: 'manual',
    cpf_detectado: cpfDetectado,
    nome_detectado: resultado.cliente.nome,
    vencimento_detectado: vencimentoDetectado,
    confianca: resultado.confianca,
    whatsapp_enviado: 0
  }]);

if (error) throw error;

    atualizarSistema();

    res.json({
      sucesso:true,
      responsavel:resultado.cliente.nome,
      confianca:resultado.confianca,
      motivo:resultado.motivo,
      arquivo_boleto:urlArquivo,
      linha_digitavel:linhaDigitavel,
      valor_detectado:valorDetectado,
      vencimento_detectado:vencimentoDetectado
    });

  }catch(error){

    console.error(error);

    res.status(500).json({
      erro:'Erro ao importar boleto manual.',
      detalhes:error.message
    });

  }
});

router.get('/api/cobrancas', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cobrancas')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    const cobrancas = data.map(item => ({
      ...item,
      responsavel_id: item.responsavel_id,
      valor_total: item.valor_total,
      link_boleto: item.link_boleto,
      linha_digitavel: item.linha_digitavel,
      criadoEm: item.criadoem,
      arquivo_boleto: item.arquivo_boleto,
      cpf_detectado: item.cpf_detectado,
      nome_detectado: item.nome_detectado,
      vencimento_detectado: item.vencimento_detectado,
      codigo_barras: item.codigo_barras,
      whatsapp_enviado: item.whatsapp_enviado
    }));

    res.json(cobrancas);

  } catch (error) {
    console.error('Erro ao buscar cobranças:', error);
    res.status(500).json({ erro: 'Erro ao buscar cobranças.' });
  }
});

router.post('/api/cobrancas', async (req, res) => {
  try {
    const {
      id,
      responsavel_id,
      referencia,
      valor_total,
      status,
      link_boleto,
      linha_digitavel,
      modo,
      origem,
      criadoEm
    } = req.body;

    const { error } = await supabase
      .from('cobrancas')
      .insert([{
        id,
        responsavel_id,
        referencia,
        valor_total,
        status,
        link_boleto,
        linha_digitavel,
        modo,
        origem: origem || 'manual',
        criadoem: criadoEm
      }]);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao cadastrar cobrança:', error);
    res.status(500).json({ erro: 'Erro ao cadastrar cobrança.' });
  }
});

/* =========================================================
MIGRAÇÃO ÚNICA: boletos locais → Supabase Storage
========================================================= */
router.post('/api/admin/migrar-boletos', requireAdmin, async (req, res) => {
  try {
    // Busca todas as cobranças com link local
    const { data: cobrancas, error } = await supabase
      .from('cobrancas')
      .select('id, link_boleto, arquivo_boleto')
      .like('link_boleto', '/uploads/%');

    if (error) throw error;
    if (!cobrancas || cobrancas.length === 0) {
      return res.json({ sucesso: true, migradas: 0, mensagem: 'Nenhum boleto local encontrado.' });
    }

    const resultados = [];

    for (const cobranca of cobrancas) {
      const caminhoLocal = path.join(process.cwd(), cobranca.link_boleto);

      if (!fs.existsSync(caminhoLocal)) {
        resultados.push({ id: cobranca.id, status: 'arquivo_nao_encontrado' });
        continue;
      }

      try {
        const buffer = fs.readFileSync(caminhoLocal);
        const ext = path.extname(cobranca.link_boleto) || '.pdf';
        const nomeArquivo = `boleto-migrado-${cobranca.id}${ext}`;
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'image/jpeg';

        const urlPublica = await uploadParaSupabase(buffer, nomeArquivo, mimeType);

        const { error: errUpdate } = await supabase
          .from('cobrancas')
          .update({ link_boleto: urlPublica, arquivo_boleto: urlPublica })
          .eq('id', cobranca.id);

        if (errUpdate) throw errUpdate;

        resultados.push({ id: cobranca.id, status: 'migrado', url: urlPublica });

      } catch (e) {
        resultados.push({ id: cobranca.id, status: 'erro', detalhe: e.message });
      }
    }

    atualizarSistema();

    const migrados = resultados.filter(r => r.status === 'migrado').length;
    const erros = resultados.filter(r => r.status === 'erro').length;
    const naoEncontrados = resultados.filter(r => r.status === 'arquivo_nao_encontrado').length;

    res.json({ sucesso: true, total: cobrancas.length, migrados, erros, naoEncontrados, resultados });

  } catch (error) {
    console.error('Erro na migração:', error);
    res.status(500).json({ erro: 'Erro na migração.', detalhe: error.message });
  }
});

router.delete('/api/cobrancas/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('cobrancas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao remover cobrança:', error);
    res.status(500).json({ erro: 'Erro ao remover cobrança.' });
  }
});

router.patch('/api/cobrancas/reset-whatsapp', requireAdmin, async (req, res) => {
  try {
    const { referencia } = req.body;
    const query = supabase.from('cobrancas').update({ whatsapp_enviado: 0 });
    const { error } = referencia
      ? await query.eq('referencia', referencia)
      : await query.neq('id', 0);
    if (error) throw error;
    atualizarSistema();
    res.json({ sucesso: true });
  } catch (error) {
    console.error('Erro ao resetar envios:', error);
    res.status(500).json({ erro: 'Erro ao resetar envios.' });
  }
});

router.patch('/api/cobrancas/:id/whatsapp', async (req, res) => {
  try {
    const { error } = await supabase
      .from('cobrancas')
      .update({ whatsapp_enviado: req.body.whatsapp_enviado ? 1 : 0 })
      .eq('id', req.params.id);

    if (error) throw error;

    atualizarSistema();
    res.json({ sucesso: true });

  } catch (error) {
    console.error('Erro ao marcar cobrança como enviada:', error);
    res.status(500).json({ erro: 'Erro ao marcar como enviado.' });
  }
});

module.exports=router;
