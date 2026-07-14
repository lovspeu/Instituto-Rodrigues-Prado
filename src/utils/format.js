/* =========================================================
   Utilitarios puros de formatacao e deteccao (boletos)
   ========================================================= */

function limparNumero(valor){
  return String(valor || '').replace(/\D/g, '');
}

function normalizarTexto(texto){
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function detectarCPF(texto){
  const match =
    String(texto || '').match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);

  return match ? limparNumero(match[0]) : null;
}

function detectarLinhaDigitavel(texto){
  const match =
    String(texto || '').match(
      /(\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14})/
    );

  return match ? match[0] : null;
}

function detectarValor(texto){
  const valores =
    String(texto || '').match(/R\$\s?\d{1,3}(\.\d{3})*,\d{2}/g);

  if(!valores || valores.length === 0){
    return null;
  }

  const ultimo = valores[valores.length - 1];

  return Number(
    ultimo
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.')
      .trim()
  );
}

function detectarVencimento(texto){
  const match =
    String(texto || '').match(/\d{2}\/\d{2}\/\d{4}/);

  return match ? match[0] : null;
}

function formatarMoeda(valor){
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function obterMesAtualReferencia(){
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');

  return `${ano}-${mes}`;
}

function normalizarTelefoneWhatsApp(telefone) {
  let numero = String(telefone || '').replace(/\D/g, '');

  if (!numero.startsWith('55')) {
    numero = `55${numero}`;
  }

  return `${numero}@s.whatsapp.net`;
}

module.exports = {
  limparNumero,
  normalizarTexto,
  detectarCPF,
  detectarLinhaDigitavel,
  detectarValor,
  detectarVencimento,
  formatarMoeda,
  obterMesAtualReferencia,
  normalizarTelefoneWhatsApp
};
