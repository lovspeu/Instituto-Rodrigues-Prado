/* =========================================================
   Regras de status/atraso de mensalidades (lado servidor)
   ========================================================= */

function statusMensalidadeServidor(alunoId, referencia, pagamentos, resolvidas){
  const resolvida = resolvidas.some(r =>
    Number(r.alunoid) === Number(alunoId) &&
    r.referencia === referencia
  );

  if(resolvida) return 'resolvido';

  const pago = pagamentos.some(p =>
    Number(p.alunoid) === Number(alunoId) &&
    p.referencia === referencia
  );

  return pago ? 'pago' : 'pendente';
}

function verificarAtrasoServidor(aluno, referencia){
  const [ano, mes] = referencia.split('-').map(Number);

  const vencimento = new Date(
    ano,
    mes - 1,
    Number(aluno.vencimento || 30),
    23,
    59,
    59
  );

  return new Date() > vencimento;
}

module.exports = {
  statusMensalidadeServidor,
  verificarAtrasoServidor
};
