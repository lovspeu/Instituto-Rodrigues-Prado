/* Boletos: upload, storage e deteccao de responsavel */
const multer = require('multer');
const supabase = require('../config/supabase');
const { limparNumero, normalizarTexto } = require('../utils/format');

/* UPLOAD DE BOLETOS — SUPABASE STORAGE */

// Multer em memória (sem salvar em disco)
const uploadBoleto = multer({ storage: multer.memoryStorage() });

// Cria o bucket "boletos" automaticamente se não existir
async function garantirBucketBoletos() {
  try {
    const { error } = await supabase.storage.createBucket('Boletos', {
      public: true,
      allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      fileSizeLimit: 10 * 1024 * 1024 // 10 MB
    });
    if (error && !error.message.includes('already exists')) {
      console.error('Erro ao criar bucket boletos:', error.message);
    } else {
      console.log('Bucket "boletos" pronto.');
    }
  } catch (e) {
    console.error('Erro ao garantir bucket:', e.message);
  }
}

garantirBucketBoletos();

async function uploadParaSupabase(buffer, nomeArquivo, mimeType) {
  const { error } = await supabase.storage
    .from('Boletos')
    .upload(nomeArquivo, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage.from('Boletos').getPublicUrl(nomeArquivo);
  return data.publicUrl;
}

async function encontrarResponsavelPorBoleto({ cpf, texto, valor }){

const { data: listaClientes, error: erroClientes } =
  await supabase
    .from('clientes')
    .select('*')
    .order('nome');

if (erroClientes) throw erroClientes;

const { data: listaAlunos, error: erroAlunos } =
  await supabase
    .from('alunos')
    .select('*');

if (erroAlunos) throw erroAlunos;
  if(cpf){

    const porCpf =
      listaClientes.find(cliente =>
        limparNumero(cliente.cpf) === cpf
      );

    if(porCpf){
      return {
        cliente:porCpf,
        confianca:'alta',
        motivo:'CPF encontrado no boleto'
      };
    }

  }

  const textoNormalizado =
    normalizarTexto(texto);

  for(const cliente of listaClientes){

    const nomeNormalizado =
      normalizarTexto(cliente.nome);

    if(
      nomeNormalizado &&
      textoNormalizado.includes(nomeNormalizado)
    ){
      return {
        cliente,
        confianca:'alta',
        motivo:'Nome encontrado no boleto'
      };
    }

  }

  if(valor){

    for(const cliente of listaClientes){

      const alunosCliente =
        listaAlunos.filter(aluno =>
          aluno.responsavel === cliente.nome
        );

      const total =
        alunosCliente.reduce(
          (soma, aluno) =>
            soma + Number(aluno.mensalidade || 0),
          0
        );

      if(Number(total) === Number(valor)){
        return {
          cliente,
          confianca:'media',
          motivo:'Valor bate com total das mensalidades'
        };
      }

    }

  }

  return {
    cliente:null,
    confianca:'baixa',
    motivo:'Nenhum responsável encontrado automaticamente'
  };

}

module.exports = { uploadBoleto, garantirBucketBoletos, uploadParaSupabase, encontrarResponsavelPorBoleto };
