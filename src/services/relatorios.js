/* Servico de relatorios em PDF (PDFKit) */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const supabase = require('../config/supabase');
const { formatarMoeda, obterMesAtualReferencia } = require('../utils/format');
const { statusMensalidadeServidor, verificarAtrasoServidor } = require('../utils/mensalidades');

function desenharCabecalhoPdf(doc, titulo){
  doc.rect(0, 0, 842, 90).fill('#030c22');

  doc.fillColor('#f5d76e')
    .fontSize(22)
    .text('Instituto Rodrigues Prado', 40, 28);

  doc.fillColor('#ffffff')
    .fontSize(11)
    .text('Sistema Administrativo Financeiro', 40, 56);

  doc.fillColor('#f5d76e')
    .fontSize(18)
    .text(titulo, 0, 115, {
      align: 'center'
    });

  doc.fillColor('#555555')
    .fontSize(10)
    .text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 0, 140, {
      align: 'center'
    });
}

function desenharCardPdf(doc, titulo, valor, x, y){
  doc.roundedRect(x, y, 145, 55, 8)
    .fillAndStroke('#f8f8f8', '#d4af37');

  doc.fillColor('#444444')
    .fontSize(10)
    .text(titulo, x + 15, y + 14);

  doc.fillColor('#030c22')
    .fontSize(15)
    .text(String(valor), x + 15, y + 32);
}

function desenharRodapePdf(doc, pagina, totalPaginas = ''){
  const y = doc.page.height - 25;

  doc.fontSize(9)
    .fillColor('#666')
    .text(
      `Instituto Rodrigues Prado • Página ${pagina}${totalPaginas ? ` de ${totalPaginas}` : ''}`,
      0,
      y,
      {
        width: doc.page.width,
        align: 'center'
      }
    );
}

async function gerarRelatorioFinanceiroPremium(caminhoArquivo){
  const referencia = obterMesAtualReferencia();
  const [ano, mes] = referencia.split('-').map(Number);

  const { data: alunos = [], error: erroAlunos } =
    await supabase.from('alunos').select('*');

  if(erroAlunos) throw erroAlunos;

  const { data: financeiro = [], error: erroFinanceiro } =
    await supabase.from('financeiro').select('*');

  if(erroFinanceiro) throw erroFinanceiro;

  const { data: pagamentos = [], error: erroPagamentos } =
    await supabase
      .from('pagamentosmensais')
      .select('*')
      .eq('referencia', referencia);

  if(erroPagamentos) throw erroPagamentos;

  const { data: resolvidas = [], error: erroResolvidas } =
    await supabase
      .from('mensalidadesresolvidas')
      .select('*')
      .eq('referencia', referencia);

  if(erroResolvidas) throw erroResolvidas;

  let entradasManuais = 0;
  let saidasManuais = 0;
  let mensalidadesRecebidas = 0;
  let mensalidadesPendentes = 0;
  let mensalidadesAtrasadas = 0;

  const linhas = [];

  financeiro.forEach(item => {
    const valor = Number(item.valor || 0);

    if(item.status === 'pago'){
      if(item.tipo === 'entrada') entradasManuais += valor;
      if(item.tipo === 'saida') saidasManuais += valor;
    }

    linhas.push([
      item.data || '-',
      'Financeiro',
      item.descricao || '-',
      item.categoria || '-',
      item.tipo || '-',
      formatarMoeda(valor),
      String(item.status || '-').toUpperCase()
    ]);
  });

  alunos.forEach(aluno => {
    const status = statusMensalidadeServidor(
      aluno.id,
      referencia,
      pagamentos,
      resolvidas
    );

    const estaAtrasado =
      status === 'pendente' &&
      verificarAtrasoServidor(aluno, referencia);

    const statusFinal =
      estaAtrasado ? 'ATRASADO' : status.toUpperCase();

    const valor = Number(aluno.mensalidade || 0);

    if(status === 'pago'){
      mensalidadesRecebidas += valor;
    }else if(status !== 'resolvido'){
      mensalidadesPendentes += valor;
    }

    if(estaAtrasado){
      mensalidadesAtrasadas += valor;
    }

    linhas.push([
      referencia,
      'Mensalidade',
      aluno.nome || '-',
      aluno.responsavel || '-',
      'entrada',
      formatarMoeda(valor),
      statusFinal
    ]);
  });

  const totalEntradas = entradasManuais + mensalidadesRecebidas;
  const totalSaidas = saidasManuais;
  const saldoGeral = totalEntradas - totalSaidas;

  await new Promise((resolve, reject) => {
const doc = new PDFDocument({
  size: 'A4',
  layout: 'landscape',
  margin: 40,
  bufferPages: true
});

    const stream = fs.createWriteStream(caminhoArquivo);

    stream.on('finish', resolve);
    stream.on('error', reject);

    doc.pipe(stream);

    desenharCabecalhoPdf(doc, 'Relatório Financeiro Geral');

    desenharCardPdf(doc, 'Entradas', formatarMoeda(totalEntradas), 40, 185);
    desenharCardPdf(doc, 'Saídas', formatarMoeda(totalSaidas), 210, 185);
    desenharCardPdf(doc, 'Saldo Geral', formatarMoeda(saldoGeral), 380, 185);
    desenharCardPdf(doc, 'Referência', referencia, 550, 185);

    const graficoY = 300;
    const alturaMax = 80;
    const maiorValor = Math.max(totalEntradas, totalSaidas, 1);

    const alturaEntrada = (totalEntradas / maiorValor) * alturaMax;
    const alturaSaida = (totalSaidas / maiorValor) * alturaMax;

    doc.fillColor('#030c22')
      .fontSize(14)
      .text('Entradas x Saídas', 65, 270);

    doc.rect(70, graficoY + alturaMax - alturaEntrada, 60, alturaEntrada)
      .fill('#22c55e');

    doc.rect(170, graficoY + alturaMax - alturaSaida, 60, alturaSaida)
      .fill('#ef4444');

    doc.fillColor('#000000')
      .fontSize(9)
      .text('Entradas', 70, 390)
      .text(formatarMoeda(totalEntradas), 70, 405)
      .text('Saídas', 170, 390)
      .text(formatarMoeda(totalSaidas), 170, 405);

    const maiorMensalidade = Math.max(
      mensalidadesRecebidas,
      mensalidadesPendentes,
      mensalidadesAtrasadas,
      1
    );

    const alturaRecebidas = (mensalidadesRecebidas / maiorMensalidade) * alturaMax;
    const alturaPendentes = (mensalidadesPendentes / maiorMensalidade) * alturaMax;
    const alturaAtrasadas = (mensalidadesAtrasadas / maiorMensalidade) * alturaMax;

    doc.fillColor('#030c22')
      .fontSize(14)
      .text('Situação das Mensalidades', 430, 270);

    doc.rect(430, graficoY + alturaMax - alturaRecebidas, 55, alturaRecebidas)
      .fill('#22c55e');

    doc.rect(520, graficoY + alturaMax - alturaPendentes, 55, alturaPendentes)
      .fill('#f59e0b');

    doc.rect(610, graficoY + alturaMax - alturaAtrasadas, 55, alturaAtrasadas)
      .fill('#ef4444');

    doc.fillColor('#000000')
      .fontSize(8)
      .text('Recebidas', 430, 390)
      .text(formatarMoeda(mensalidadesRecebidas), 430, 405)
      .text('Pendentes', 520, 390)
      .text(formatarMoeda(mensalidadesPendentes), 520, 405)
      .text('Atrasadas', 610, 390)
      .text(formatarMoeda(mensalidadesAtrasadas), 610, 405);


doc.addPage();

desenharCabecalhoPdf(doc, 'Tabela Financeira');

let y = 115;

    doc.rect(35, y, 770, 24).fill('#030c22');

    doc.fillColor('#f5d76e')
      .fontSize(8)
      .text('Data/Ref.', 42, y + 8)
      .text('Origem', 105, y + 8)
      .text('Descrição', 175, y + 8)
      .text('Categoria/Responsável', 350, y + 8)
      .text('Tipo', 545, y + 8)
      .text('Valor', 610, y + 8)
      .text('Status', 700, y + 8);

    y += 30;

    linhas.forEach((linha, index) => {
if(y > 535){
  doc.addPage();

  desenharCabecalhoPdf(doc, 'Tabela Financeira');

  doc.rect(35, 115, 770, 24).fill('#030c22');

  doc.fillColor('#f5d76e')
    .fontSize(8)
    .text('Data/Ref.', 42, 123)
    .text('Origem', 105, 123)
    .text('Descrição', 175, 123)
    .text('Categoria/Responsável', 350, 123)
    .text('Tipo', 545, 123)
    .text('Valor', 610, 123)
    .text('Status', 700, 123);

  y = 145;
}
      if(index % 2 === 0){
        doc.rect(35, y - 4, 770, 22).fill('#f8f8f8');
      }

      doc.fillColor('#000000')
        .fontSize(7)
        .text(String(linha[0]), 42, y, { width: 58 })
        .text(String(linha[1]), 105, y, { width: 65 })
        .text(String(linha[2]), 175, y, { width: 165 })
        .text(String(linha[3]), 350, y, { width: 185 })
        .text(String(linha[4]), 545, y, { width: 55 })
        .text(String(linha[5]), 610, y, { width: 80 })
        .text(String(linha[6]), 700, y, { width: 80 });

      y += 22;
    });

const totalPaginas = doc.bufferedPageRange().count;

for(let i = 0; i < totalPaginas; i++){
  doc.switchToPage(i);
  desenharRodapePdf(doc, i + 1, totalPaginas);
}

doc.end();
  });

  return {
    caminhoArquivo,
    nomeArquivo: `relatorio-financeiro-geral-${referencia}.pdf`,
    referencia
  };
}

module.exports = { gerarRelatorioFinanceiroPremium };
