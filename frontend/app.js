/* =========================================================
APP.JS — INSTITUTO RODRIGUES PRADO
========================================================= */

/* =========================================================
HELPERS
========================================================= */
// Socket conecta apenas apos autenticacao (o servidor rejeita sockets sem sessao)
let socket = null;

function conectarSocket(){
  if(socket) return;

  socket = io({ withCredentials: true });

  socket.on('connect_error', (err) => {
    console.warn('Tempo real indisponível:', err.message);
  });

  socket.on('atualizarSistema', async () => {
    await carregarDados();

    renderizarClientes();
    atualizarSelectResponsaveis();
    renderizarAlunos();
    renderizarFinanceiro();
    renderizarMensalidades();

    atualizarBotaoModoCobranca();
    renderizarCentralCobrancas();

    atualizarDashboard();
  });
}

function desconectarSocket(){
  if(socket){
    socket.disconnect();
    socket = null;
  }
}


function formatarMoeda(valor){
  return Number(valor || 0).toLocaleString('pt-BR', {
    style:'currency',
    currency:'BRL'
  });
}

function limparNumero(valor){
  return String(valor || '').replace(/\D/g, '');
}

function formatarCPF(valor){

  const cpf = limparNumero(valor).slice(0, 11);

  return cpf
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

}

function formatarTelefone(valor){

  const telefone = limparNumero(valor).slice(0, 11);

  return telefone
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{1})(\d{4})(\d{4})$/, '$1 $2-$3');

}
let modoCensura = false;

async function alternarModoCensura(){

  // A censura agora e controlada pela sessao no servidor (rota protegida por login).
  // Sem senha fixa no frontend.
  try{

    await apiPatch('/api/modo-censura', {
      ativo: !modoCensura
    });

    modoCensura = !modoCensura;

    atualizarBotaoCensura();

    renderizarClientes();
    renderizarAlunos();
    renderizarMensalidades();
    renderizarCentralCobrancas();
    atualizarDashboard();

  }catch(error){

    console.error(error);

    alert(
      'Erro ao alterar modo censura.'
    );

  }

}

function atualizarBotaoCensura(){

  const icone =
  document.getElementById('iconeCensura');

  if(!icone) return;

  icone.className =
  modoCensura
    ? 'fa-solid fa-eye'
    : 'fa-solid fa-eye-slash';

}

function censurarNome(nome){

  if(!modoCensura) return nome;
  if(!nome) return '-';

  return nome
    .split(' ')
    .map(parte =>
      parte[0] + '*'.repeat(Math.max(parte.length - 2, 1))
    )
    .join(' ');

}

function censurarTelefone(telefone){

  if(!modoCensura) return telefone;

  return '(**) *****-**' +
  String(telefone).slice(-2);

}

function censurarCPF(cpf){

  if(!modoCensura) return cpf;

  return '***.***.***-' +
  String(cpf).slice(-2);

}

function censurarEmail(email){

  if(!modoCensura) return email;

  const partes = String(email).split('@');

  if(partes.length < 2) return '***';

  return partes[0].slice(0,2) +
  '***@' +
  partes[1];

}

function censurarValor(valor){

  if(!modoCensura)
    return formatarMoeda(valor);

  return 'R$ •••••';

}

/* =========================================================
API
========================================================= */

// Trata sessao expirada/ausente de forma centralizada
function tratarNaoAutenticado(){
  if(window.__sessaoExpirada) return;
  window.__sessaoExpirada = true;
  usuarioLogado = null;
  if(typeof desconectarSocket === 'function') desconectarSocket();
  const telaLoginEl = document.getElementById('telaLogin');
  const sistemaEl = document.getElementById('sistema');
  if(telaLoginEl) telaLoginEl.style.display = 'flex';
  if(sistemaEl) sistemaEl.style.display = 'none';
}

async function requisitar(url, config = {}){
  const resposta = await fetch(url, {
    credentials: 'same-origin',
    ...config
  });

  if(resposta.status === 401){
    tratarNaoAutenticado();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  return resposta;
}

async function apiGet(url){
  const resposta = await requisitar(url);
  if(!resposta.ok){
    throw new Error(`Erro ao buscar ${url}`);
  }
  return await resposta.json();
}

async function apiPost(url, dados){
  const resposta = await requisitar(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(dados)
  });

  if(!resposta.ok){
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || `Erro ao salvar ${url}`);
  }

  return await resposta.json().catch(() => ({ sucesso:true }));
}

async function apiPatch(url, dados){
  const resposta = await requisitar(url, {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(dados)
  });

  if(!resposta.ok){
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || `Erro ao atualizar ${url}`);
  }

  return await resposta.json().catch(() => ({ sucesso:true }));
}

async function apiDelete(url, dados = null){
  const config = {
    method:'DELETE',
    headers:{ 'Content-Type':'application/json' }
  };

  if(dados){
    config.body = JSON.stringify(dados);
  }

  const resposta = await requisitar(url, config);

  if(!resposta.ok){
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || `Erro ao remover ${url}`);
  }

  return await resposta.json().catch(() => ({ sucesso:true }));
}

/* =========================================================
MENU
========================================================= */

const menuItems = document.querySelectorAll('.menu-item');
const sections = document.querySelectorAll('.section');

menuItems.forEach(item => {

  item.addEventListener('click', () => {

    menuItems.forEach(i => i.classList.remove('active'));
    sections.forEach(section => section.classList.remove('active-section'));

    item.classList.add('active');

    const sectionId = item.dataset.section;

    localStorage.setItem('abaAtual', sectionId);

    const section = document.getElementById(sectionId);

    if(section){
      section.classList.add('active-section');
    }

  });

});
function restaurarUltimaAba(){

  const abaSalva =
  localStorage.getItem('abaAtual');

  if(!abaSalva) return;

  menuItems.forEach(i =>
    i.classList.remove('active')
  );

  sections.forEach(section =>
    section.classList.remove('active-section')
  );

  const botao =
  document.querySelector(
    `[data-section="${abaSalva}"]`
  );

  const secao =
  document.getElementById(abaSalva);

  if(botao){
    botao.classList.add('active');
  }

  if(secao){
    secao.classList.add('active-section');
  }

}

/* =========================================================
LOGIN
========================================================= */

let usuarioLogado = null;

const telaLogin = document.getElementById('telaLogin');
const sistema = document.getElementById('sistema');
const formLogin = document.getElementById('formLogin');
const erroLogin = document.getElementById('erroLogin');

// Verifica a sessao no servidor (cookie HttpOnly) — nao confia mais no localStorage
async function verificarLogin(){
  try{
    const resposta = await fetch('/api/auth/me', { credentials:'same-origin' });

    if(resposta.ok){
      const dados = await resposta.json();
      usuarioLogado = dados.usuario;
      window.__sessaoExpirada = false;

      if(telaLogin) telaLogin.style.display = 'none';
      if(sistema) sistema.style.display = 'flex';

      mostrarUsuarioNoTopo(dados.usuario);
      return true;
    }
  }catch(error){
    console.error('Erro ao verificar sessão:', error);
  }

  usuarioLogado = null;
  if(telaLogin) telaLogin.style.display = 'flex';
  if(sistema) sistema.style.display = 'none';
  return false;
}

if(formLogin){

  formLogin.addEventListener('submit', async (e) => {

    e.preventDefault();

    const usuarioDigitado =
      document.getElementById('usuario').value.trim().toLowerCase();

    const senhaDigitada =
      document.getElementById('senha').value.trim();

    try{

      const resposta = await fetch('/api/login', {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          usuario:usuarioDigitado,
          senha:senhaDigitada
        })
      });

      const dados = await resposta.json();

      if(!resposta.ok || !dados.sucesso){

        if(erroLogin){
          erroLogin.style.display = 'block';
        }

        return;

      }

      // A sessao agora vive num cookie HttpOnly definido pelo servidor.
      // Nao guardamos usuario/senha no localStorage.
      usuarioLogado = dados.usuario;
      window.__sessaoExpirada = false;

      if(erroLogin){
        erroLogin.style.display = 'none';
      }

      if(Number(dados.usuario.primeiroAcesso) === 1){
        abrirTelaDefinirSenha(dados.usuario.usuario);
        return;
      }

      await verificarLogin();

      await iniciarSistema();

    }catch(error){

      console.error('Erro ao fazer login:', error);

      alert('Erro ao conectar com o servidor.');

    }

  });

}

function abrirTelaDefinirSenha(usuario){

  if(telaLogin){
    telaLogin.style.display = 'none';
  }

  if(sistema){
    sistema.style.display = 'none';
  }

  const telaExistente =
    document.getElementById('telaDefinirSenha');

  if(telaExistente){
    telaExistente.remove();
  }

  document.body.insertAdjacentHTML('beforeend', `

    <div id="telaDefinirSenha" class="tela-definir-senha">

      <div class="card-definir-senha">

        <h2>Definir nova senha</h2>

        <p>
          Este é seu primeiro acesso.
          Escolha uma senha pessoal para entrar no sistema.
        </p>

        <input
          type="password"
          id="novaSenha"
          placeholder="Nova senha"
        >

        <input
          type="password"
          id="confirmarNovaSenha"
          placeholder="Confirmar senha"
        >

        <button onclick="salvarNovaSenha('${usuario}')">
          Salvar senha
        </button>

      </div>

    </div>

  `);

}

async function salvarNovaSenha(usuario){

  const novaSenha =
    document.getElementById('novaSenha').value.trim();

  const confirmarNovaSenha =
    document.getElementById('confirmarNovaSenha').value.trim();

  if(!novaSenha || !confirmarNovaSenha){
    alert('Preencha os dois campos.');
    return;
  }

  if(novaSenha.length < 6){
    alert('A senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  if(novaSenha !== confirmarNovaSenha){
    alert('As senhas não coincidem.');
    return;
  }

  try{

    const resposta = await fetch('/api/usuarios/senha', {
      method:'PATCH',
      credentials:'same-origin',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        senha:novaSenha
      })
    });

    const dados = await resposta.json().catch(() => ({}));

    if(!resposta.ok || !dados.sucesso){
      alert(dados.erro || 'Erro ao salvar nova senha.');
      return;
    }

    // Sessao continua valida no cookie; nada sensivel no localStorage.
    usuarioLogado = dados.usuario;

    const telaDefinirSenha =
      document.getElementById('telaDefinirSenha');

    if(telaDefinirSenha){
      telaDefinirSenha.remove();
    }

    await verificarLogin();

    await iniciarSistema();

  }catch(error){

    console.error('Erro ao salvar senha:', error);

    alert('Erro ao conectar com o servidor.');

  }

}

function mostrarUsuarioNoTopo(usuario){

  if(!usuario) return;

  let saudacao = 'Bem-vinda';

  if(usuario.nome === 'João Pedro Pontes'){
    saudacao = 'Bem-vindo';
  }

  const usuarioLogadoTopo =
    document.getElementById('usuarioLogadoTopo');

  if(usuarioLogadoTopo){

    usuarioLogadoTopo.innerHTML =
      `${saudacao}, <strong>${usuario.nome}</strong>`;

  }

  const usuarioBoxTopo =
    document.getElementById('usuarioBoxTopo');

  if(usuarioBoxTopo){

    usuarioBoxTopo.innerText =
      usuario.nome;

  }

}

async function logout(){

  try{
    await fetch('/api/auth/logout', {
      method:'POST',
      credentials:'same-origin'
    });
  }catch(error){
    console.error('Erro ao encerrar sessão:', error);
  }

  // Limpa residuos antigos que porventura existam
  localStorage.removeItem('logado');
  localStorage.removeItem('usuarioLogado');

  desconectarSocket();
  usuarioLogado = null;

  location.reload();

}

/* MOSTRAR / OCULTAR SENHA */

function alternarVisibilidadeSenha(){

  const campo =
    document.getElementById('senha');

  const icone =
    document.getElementById('iconeSenha');

  if(!campo || !icone) return;

  if(campo.type === 'password'){

    campo.type = 'text';

    icone.classList.remove('fa-eye');
    icone.classList.add('fa-eye-slash');

  }else{

    campo.type = 'password';

    icone.classList.remove('fa-eye-slash');
    icone.classList.add('fa-eye');

  }

}

/* =========================================================
DADOS
========================================================= */

let clientes = [];
let alunos = [];
let financeiro = [];
let pagamentosMensais = [];
let mensalidadesResolvidas = [];
let boletosMensais = [];
let configuracoes = {};
let cobrancas = [];
let modoCobranca = 'manual';

async function carregarDados(){

  clientes =
  await apiGet('/api/clientes');

  alunos =
  await apiGet('/api/alunos');

  financeiro =
  await apiGet('/api/financeiro');

  pagamentosMensais =
  await apiGet('/api/pagamentosMensais');

  mensalidadesResolvidas =
  await apiGet('/api/mensalidadesResolvidas');

  boletosMensais =
  await apiGet('/api/boletosMensais');

  try{
    configuracoes =
    await apiGet('/api/configuracoes');
  }catch{
    configuracoes = {};
  }

  try{
    cobrancas =
    await apiGet('/api/cobrancas');
  }catch{
    cobrancas = [];
  }

  try{
    const respostaModo =
    await apiGet('/api/modo-censura');

    modoCensura =
    respostaModo.ativo;
  }catch{
    modoCensura = false;
  }

  modoCobranca = 'manual';

}

/* =========================================================
CLIENTES / RESPONSÁVEIS
========================================================= */

const formCliente = document.getElementById('formCliente');
const listaClientes = document.getElementById('listaClientes');

const buscarResponsavel =
document.getElementById('buscarResponsavel');

if(buscarResponsavel){

  buscarResponsavel.addEventListener('input', () => {
    renderizarClientes();
  });

}

const telefoneClienteInput =
document.getElementById('telefoneCliente');

const cpfClienteInput =
document.getElementById('cpfCliente');

const emailClienteInput =
document.getElementById('emailCliente');

if(emailClienteInput){
  emailClienteInput.value = 'rosan.sousa@hotmail.com';
  emailClienteInput.readOnly = true;
}

if(telefoneClienteInput){

  telefoneClienteInput.addEventListener('input', () => {
    telefoneClienteInput.value =
    formatarTelefone(telefoneClienteInput.value);
  });

}

if(cpfClienteInput){

  cpfClienteInput.addEventListener('input', () => {
    cpfClienteInput.value =
    formatarCPF(cpfClienteInput.value);
  });

}

if(formCliente){

  formCliente.addEventListener('submit', async (e) => {

    e.preventDefault();

    const idEditando =
document.getElementById('clienteEditando')?.value || '';
    const cliente = {
      id:idEditando || Date.now(),

      nome:
      document.getElementById('nomeCliente').value.trim(),

      telefone:
      formatarTelefone(
        document.getElementById('telefoneCliente').value
      ),

      cpf:
      formatarCPF(
        document.getElementById('cpfCliente').value
      ),

      email:
      'rosan.sousa@hotmail.com'
    };

    try{

      if(idEditando){

        await apiPatch(`/api/clientes/${idEditando}`, {
          nome:cliente.nome,
          telefone:cliente.telefone,
          cpf:cliente.cpf,
          email:cliente.email
        });

        const index =
        clientes.findIndex(c =>
          Number(c.id) === Number(idEditando)
        );

        if(index !== -1){
          clientes[index] = cliente;
        }

      }else{

        await apiPost('/api/clientes', cliente);

        clientes.push(cliente);

      }

      formCliente.reset();

      const clienteEditando =
      document.getElementById('clienteEditando');

      if(clienteEditando){
        clienteEditando.value = '';
      }

      if(emailClienteInput){
        emailClienteInput.value = 'rosan.sousa@hotmail.com';
        emailClienteInput.readOnly = true;
      }

      const botao =
      formCliente.querySelector('button[type="submit"]');

      if(botao){
        botao.innerHTML = `
          <i class="fa-solid fa-plus"></i>
          Cadastrar Responsável
        `;
      }

      renderizarClientes();
      atualizarSelectResponsaveis();
      atualizarDashboard();

    }catch(error){

      console.error(error);
      alert(
        idEditando
        ? 'Erro ao editar responsável.'
        : 'Erro ao cadastrar responsável.'
      );

    }

  });

}

function renderizarClientes(){

  if(!listaClientes) return;

  const busca =
    document.getElementById('buscarResponsavel')
    ?.value
    ?.toLowerCase() || '';

  const clientesFiltrados =
    clientes.filter(cliente =>

      String(cliente.nome || '')
        .toLowerCase()
        .includes(busca) ||

      String(cliente.telefone || '')
        .toLowerCase()
        .includes(busca) ||

      String(cliente.cpf || '')
        .toLowerCase()
        .includes(busca) ||

      String(cliente.email || '')
        .toLowerCase()
        .includes(busca)

    );

  const total =
    document.getElementById('totalResponsaveis');

  if(total){
    total.innerText = clientes.length;
  }

  listaClientes.innerHTML = '';

  if(clientesFiltrados.length === 0){

    listaClientes.innerHTML = `
      <tr>
        <td colspan="5">
          Nenhum responsável encontrado.
        </td>
      </tr>
    `;

    return;
  }

  clientesFiltrados.forEach(cliente => {

    listaClientes.innerHTML += `

      <tr>

        <td>
          <strong>
            ${censurarNome(cliente.nome)}
          </strong>
        </td>

        <td>
          ${censurarTelefone(cliente.telefone)}
        </td>

        <td>
          ${censurarCPF(cliente.cpf)}
        </td>

        <td>
          ${censurarEmail(cliente.email)}
        </td>

        <td>

          <div class="tabela-acoes">

            <button
              onclick="editarCliente(${cliente.id})"
            >
              Editar
            </button>

            <button
              onclick="removerCliente(${cliente.id})"
            >
              Remover
            </button>

          </div>

        </td>

      </tr>

    `;

  });

}

function editarCliente(id){

  const cliente =
  clientes.find(c =>
    Number(c.id) === Number(id)
  );

  if(!cliente) return;

  document.getElementById('clienteEditando').value = cliente.id;
  document.getElementById('nomeCliente').value = cliente.nome;
  document.getElementById('telefoneCliente').value = cliente.telefone;
  document.getElementById('cpfCliente').value = cliente.cpf;

  if(emailClienteInput){
    emailClienteInput.value = cliente.email || 'rosan.sousa@hotmail.com';
  }

  const botao = document.getElementById('btnSalvarCliente');

  if(botao){
    botao.innerHTML = `
      <i class="fa-solid fa-floppy-disk"></i>
      Confirmar edição de responsável
    `;
  }

  window.scrollTo({
    top:0,
    behavior:'smooth'
  });

}

async function removerCliente(id){

  const confirmar =
  confirm('Deseja remover este responsável?');

  if(!confirmar) return;

  try{

    await apiDelete(`/api/clientes/${id}`);

    clientes =
    clientes.filter(cliente => Number(cliente.id) !== Number(id));

    renderizarClientes();
    atualizarSelectResponsaveis();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao remover responsável.');

  }

}

/* =========================================================
SELECT RESPONSÁVEIS
========================================================= */

function atualizarSelectResponsaveis(){

  const select = document.getElementById('responsavelAluno');

  if(!select) return;

  select.innerHTML = `
    <option value="">
      Selecione o responsável
    </option>
  `;

  clientes.forEach(cliente => {

    select.innerHTML += `
      <option value="${cliente.nome}">
        ${cliente.nome}
      </option>
    `;

  });

}

/* =========================================================
ALUNOS
========================================================= */

const formAluno = document.getElementById('formAluno');
const listaAlunos = document.getElementById('listaAlunos');

if(formAluno){

  formAluno.addEventListener('submit', async (e) => {

    e.preventDefault();

    const dataMatricula = new Date();

    const aluno = {
      id:Date.now(),

      nome:
      document.getElementById('nomeAluno').value.trim(),

      responsavel:
      document.getElementById('responsavelAluno').value,

      mensalidade:
      Number(
      document.getElementById('mensalidadeAluno').value.replace(',', '.')
      ),
      vencimento:
      Number(document.getElementById('vencimentoAluno').value),

      mesMatricula:
      dataMatricula.getMonth() + 1,

      anoMatricula:
      dataMatricula.getFullYear()
    };

    try{

      await apiPost('/api/alunos', aluno);

      alunos.push(aluno);

      formAluno.reset();

      renderizarAlunos();
      renderizarMensalidades();
      atualizarDashboard();

    }catch(error){

      console.error(error);
      alert('Erro ao cadastrar aluno.');

    }

  });

}

function renderizarAlunos(){

  if(!listaAlunos) return;

  const pesquisa = document
    .getElementById('pesquisaAluno')
    ?.value
    .toLowerCase()
    .trim() || '';

  const alunosFiltrados = alunos.filter(aluno =>
    aluno.nome.toLowerCase().includes(pesquisa) ||
    aluno.responsavel.toLowerCase().includes(pesquisa)
  );

  const totalAlunosLista =
    document.getElementById('totalAlunosLista');

  if(totalAlunosLista){
    totalAlunosLista.textContent =
      `Total de alunos: ${alunosFiltrados.length}`;
  }

  listaAlunos.innerHTML = '';

  if(alunosFiltrados.length === 0){

    listaAlunos.innerHTML = `
      <div class="aluno-card">
        <p>Nenhum aluno encontrado.</p>
      </div>
    `;

    return;

  }

  alunosFiltrados.forEach(aluno => {

    listaAlunos.innerHTML += `

      <div class="aluno-card">

        <div>

          <h3>${censurarNome(aluno.nome)}</h3>

          <p>
            <strong>Responsável:</strong>
            ${censurarNome(aluno.responsavel)}
          </p>

          <p>
            <strong>Mensalidade:</strong>
            ${censurarValor(aluno.mensalidade)}
          </p>

          <p>
            <strong>Vencimento:</strong>
            Dia ${aluno.vencimento}
          </p>

          <p>
            <strong>Matrícula:</strong>
            ${String(aluno.mesMatricula).padStart(2,'0')}/${aluno.anoMatricula}
          </p>

        </div>

        <div class="tabela-acoes">

          <button onclick="removerAluno(${aluno.id})">
            Remover
          </button>

        </div>

      </div>

    `;

  });

}

async function removerAluno(id){

  const confirmar =
  confirm('Deseja remover este aluno?');

  if(!confirmar) return;

  try{

    await apiDelete(`/api/alunos/${id}`);

    alunos =
    alunos.filter(aluno => Number(aluno.id) !== Number(id));

    pagamentosMensais =
    pagamentosMensais.filter(
      pagamento => Number(pagamento.alunoId) !== Number(id)
    );

    boletosMensais =
    boletosMensais.filter(
      boleto => Number(boleto.alunoId) !== Number(id)
    );

    renderizarAlunos();
    renderizarMensalidades();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao remover aluno.');

  }

}

/* =========================================================
FINANCEIRO
========================================================= */

const formFinanceiro = document.getElementById('formFinanceiro');
const listaFinanceiro = document.getElementById('listaFinanceiro');
const buscarFinanceiro = document.getElementById('buscarFinanceiro');

if(formFinanceiro){

  formFinanceiro.addEventListener('submit', async (e) => {

    e.preventDefault();

    const campoData = document.getElementById('dataFinanceiro').value;

    const dataBase =
      campoData
      ? new Date(campoData + 'T00:00:00')
      : new Date();

    const movimentacao = {
      id:Date.now(),

      descricao:
        document.getElementById('descricaoFinanceiro').value.trim(),

      valor:Number(
        document.getElementById('valorFinanceiro').value
          .replace(',', '.')
      ),

      tipo:
        document.getElementById('tipoFinanceiro').value,

      status:
        document.getElementById('statusFinanceiro').value,

      categoria:
        document.getElementById('categoriaFinanceiro').value,

      data:
        dataBase.toLocaleDateString('pt-BR'),

      mes:
        dataBase.getMonth() + 1,

      ano:
        dataBase.getFullYear()
    };

    try{

      await apiPost('/api/financeiro', movimentacao);

      financeiro.unshift(movimentacao);

      formFinanceiro.reset();

      renderizarFinanceiro();
      atualizarResumoFinanceiroManual();
      atualizarDashboard();

    }catch(error){

      console.error(error);
      alert('Erro ao adicionar movimentação.');

    }

  });

}

if(buscarFinanceiro){

  buscarFinanceiro.addEventListener('input', () => {
    renderizarFinanceiro();
  });

}

function atualizarResumoFinanceiroManual(){

  const receitasEl = document.getElementById('financeiroReceitas');
  const despesasEl = document.getElementById('financeiroDespesas');
  const saldoEl = document.getElementById('financeiroSaldo');

  if(!receitasEl || !despesasEl || !saldoEl) return;

  const receitas = financeiro
    .filter(item =>
      item.tipo === 'entrada' &&
      item.status === 'pago'
    )
    .reduce((total, item) =>
      total + Number(item.valor || 0), 0
    );

  const despesas = financeiro
    .filter(item =>
      item.tipo === 'saida' &&
      item.status === 'pago'
    )
    .reduce((total, item) =>
      total + Number(item.valor || 0), 0
    );

  const saldo = receitas - despesas;

  receitasEl.textContent = formatarMoeda(receitas);
  despesasEl.textContent = formatarMoeda(despesas);
  saldoEl.textContent = formatarMoeda(saldo);

}

function renderizarFinanceiro(){

  if(!listaFinanceiro) return;

  listaFinanceiro.innerHTML = '';

  const termoBusca = buscarFinanceiro
    ? buscarFinanceiro.value.toLowerCase().trim()
    : '';

  let lista = financeiro.slice();
  const mesFiltro =
  document.getElementById('filtroMesFinanceiro')?.value;

const anoFiltro =
  document.getElementById('filtroAnoFinanceiro')?.value;

if(mesFiltro){

  lista = lista.filter(item =>
    Number(item.mes) === Number(mesFiltro)
  );

}

if(anoFiltro){

  lista = lista.filter(item =>
    Number(item.ano) === Number(anoFiltro)
  );

}
document
.getElementById('filtroMesFinanceiro')
?.addEventListener('change', renderizarFinanceiro);

document
.getElementById('filtroAnoFinanceiro')
?.addEventListener('change', renderizarFinanceiro);

  if(termoBusca){

    lista = lista.filter(item => {

      return (
        String(item.descricao || '').toLowerCase().includes(termoBusca) ||
        String(item.categoria || '').toLowerCase().includes(termoBusca) ||
        String(item.tipo || '').toLowerCase().includes(termoBusca) ||
        String(item.status || '').toLowerCase().includes(termoBusca) ||
        String(item.data || '').toLowerCase().includes(termoBusca)
      );

    });

  }

  if(lista.length === 0){

    listaFinanceiro.innerHTML = `
      <tr>
        <td colspan="6">Nenhuma movimentação encontrada.</td>
      </tr>
    `;

    atualizarResumoFinanceiroManual();
    return;

  }

  lista
    .sort((a, b) => Number(b.id) - Number(a.id))
    .forEach(item => {

      const tipoValor =
        item.tipo === 'entrada'
        ? 'valor-entrada'
        : 'valor-saida';

      const sinal =
        item.tipo === 'entrada'
        ? '+'
        : '-';

      listaFinanceiro.innerHTML += `

        <tr>

          <td>${item.data || '-'}</td>

          <td>
            <strong>${item.descricao}</strong>
            <br>
            <small>${item.tipo}</small>
          </td>

          <td>${item.categoria}</td>

          <td class="${tipoValor}">
            ${sinal} ${formatarMoeda(item.valor)}
          </td>

          <td>
            <span class="status ${item.status}">
              ${item.status}
            </span>
          </td>

          <td>
            <div class="tabela-acoes">

              <button onclick="alterarStatus(${item.id})">
                Alterar
              </button>

              <button onclick="removerFinanceiro(${item.id})">
                Remover
              </button>

            </div>
          </td>

        </tr>

      `;

    });

  atualizarResumoFinanceiroManual();

}

async function alterarStatus(id){

  const item =
    financeiro.find(mov => Number(mov.id) === Number(id));

  if(!item) return;

  const novoStatus =
    item.status === 'pago'
    ? 'pendente'
    : 'pago';

  try{

    await apiPatch(`/api/financeiro/${id}/status`, {
      status:novoStatus
    });

    item.status = novoStatus;

    renderizarFinanceiro();
    atualizarResumoFinanceiroManual();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao alterar status.');

  }

}

async function removerFinanceiro(id){

  const confirmar =
    confirm('Deseja remover esta movimentação?');

  if(!confirmar) return;

  try{

    await apiDelete(`/api/financeiro/${id}`);

    financeiro =
      financeiro.filter(item => Number(item.id) !== Number(id));

    renderizarFinanceiro();
    atualizarResumoFinanceiroManual();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao remover movimentação.');

  }

}

/* =========================================================
MENSALIDADES
========================================================= */

const tabelaMensalidades = document.getElementById('tabelaMensalidades');
const filtroMes = document.getElementById('filtroMes');
const filtroStatus = document.getElementById('filtroStatus');

if(filtroMes){
  filtroMes.addEventListener('change', () => {
    renderizarMensalidades();
  });
}

if(filtroStatus){
  filtroStatus.addEventListener('change', () => {
    renderizarMensalidades();
  });
}

function obterReferenciaAtual(){

  const data = new Date();

  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2,'0')}`;

}

function obterReferenciaFiltro(){

  if(filtroMes && filtroMes.value){
    return filtroMes.value;
  }

  return obterReferenciaAtual();

}

function obterReferenciaCentral(){

  const input = document.getElementById('centralFiltroMes');
  if(input && input.value){
    return input.value;
  }

  return obterReferenciaAtual();

}

function montarReferencia(mes, ano){

  return `${ano}-${String(mes).padStart(2,'0')}`;

}

function verificarStatusMensalidade(alunoId, referencia = obterReferenciaAtual()){

  const resolvida = mensalidadesResolvidas.find(r =>
    Number(r.alunoId) === Number(alunoId) &&
    r.referencia === referencia
  );

  if(resolvida){
    return 'resolvido';
  }

  const pagamento = pagamentosMensais.find(p =>
    Number(p.alunoId) === Number(alunoId) &&
    p.referencia === referencia
  );

  return pagamento ? 'pago' : 'pendente';

}

function verificarAtraso(aluno, referencia){

  const partes = referencia.split('-');

  const ano = Number(partes[0]);
  const mes = Number(partes[1]);

  const dataVencimento = new Date(
    ano,
    mes - 1,
    aluno.vencimento,
    23,
    59,
    59
  );

  const dataAtual = new Date();

  return dataAtual > dataVencimento;

}

async function pagarMensalidade(alunoId){

  const referencia = obterReferenciaFiltro();

  const existe = pagamentosMensais.find(p =>

    Number(p.alunoId) === Number(alunoId) &&
    p.referencia === referencia

  );

  if(existe) return;

  const pagamento = {
    id:Date.now(),
    alunoId,
    referencia,
    dataPagamento:new Date().toLocaleDateString('pt-BR')
  };

  try{

    await apiPost('/api/pagamentosMensais', pagamento);

    pagamentosMensais.push(pagamento);

    renderizarMensalidades();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao marcar mensalidade como paga.');

  }

}

async function estornarMensalidade(alunoId){

  const referencia = obterReferenciaFiltro();

  try{

    await apiDelete('/api/pagamentosMensais', {
      alunoId,
      referencia
    });

    pagamentosMensais =
    pagamentosMensais.filter(p =>

      !(
        Number(p.alunoId) === Number(alunoId) &&
        p.referencia === referencia
      )

    );

    renderizarMensalidades();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao estornar mensalidade.');

  }

}
async function resolverMensalidadeSemPagamento(alunoId){

  const referencia = obterReferenciaFiltro();

  const motivo = prompt(
    'Motivo da resolução sem pagamento:',
    'Mensalidade já resolvida antes do sistema'
  );

  if(motivo === null) return;

  const resolucao = {
    id: Date.now(),
    alunoId,
    referencia,
    status: 'resolvido',
    motivo: motivo.trim() || 'Resolvido sem pagamento',
    dataResolucao: new Date().toLocaleDateString('pt-BR')
  };

  try{

    await apiPost('/api/mensalidadesResolvidas', resolucao);

    mensalidadesResolvidas.push(resolucao);

    renderizarMensalidades();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao resolver mensalidade sem pagamento.');

  }

}

async function desfazerResolucaoMensalidade(alunoId){

  const referencia = obterReferenciaFiltro();

  try{

    await apiDelete('/api/mensalidadesResolvidas', {
      alunoId,
      referencia
    });

    mensalidadesResolvidas =
      mensalidadesResolvidas.filter(r =>
        !(
          Number(r.alunoId) === Number(alunoId) &&
          r.referencia === referencia
        )
      );

    renderizarMensalidades();
    atualizarDashboard();

  }catch(error){

    console.error(error);
    alert('Erro ao desfazer resolução.');

  }

}

function obterBoleto(alunoId, referencia){

  return boletosMensais.find(boleto =>

    Number(boleto.alunoId) === Number(alunoId) &&
    boleto.referencia === referencia

  );

}

function calcularVencimentoBoleto(referencia, dia){

  const [ano, mes] = referencia.split('-').map(Number);

  const ultimoDiaMes =
  new Date(ano, mes, 0).getDate();

  const diaValido =
  Math.min(Number(dia), ultimoDiaMes);

  return `${ano}-${String(mes).padStart(2,'0')}-${String(diaValido).padStart(2,'0')}`;

}

async function removerBoleto(alunoId, referencia){

  const confirmar =
  confirm('Deseja remover este boleto salvo?');

  if(!confirmar) return;

  try{

    await apiDelete('/api/boletosMensais', {
      alunoId,
      referencia
    });

    boletosMensais =
    boletosMensais.filter(boleto =>

      !(
        Number(boleto.alunoId) === Number(alunoId) &&
        boleto.referencia === referencia
      )

    );

    renderizarMensalidades();

  }catch(error){

    console.error(error);
    alert('Erro ao remover boleto.');

  }

}

function renderizarMensalidades(){

  if(!tabelaMensalidades) return;

  tabelaMensalidades.innerHTML = '';

  const referencia = obterReferenciaFiltro();
  const [anoRef, mesRef] = referencia.split('-').map(Number);

  const statusFiltro =
  filtroStatus ? filtroStatus.value : 'todos';

  let linhas = '';

  alunos.forEach(aluno => {

    const mesMatricula =
    aluno.mesMatricula || mesRef;

    const anoMatricula =
    aluno.anoMatricula || anoRef;

    const mensalidadeAntesDaMatricula =
    anoRef < anoMatricula ||
    (anoRef === anoMatricula && mesRef < mesMatricula);

    if(mensalidadeAntesDaMatricula){
      return;
    }

    const status =
    verificarStatusMensalidade(aluno.id, referencia);

    const atrasado =
    status === 'pendente' &&
    verificarAtraso(aluno, referencia);

    const statusFinal =
    atrasado ? 'atrasado' : status;

    if(
      statusFiltro !== 'todos' &&
      statusFiltro !== statusFinal
    ){
      return;
    }

    const boleto =
    obterBoleto(aluno.id, referencia);

    linhas += `

      <tr>

        <td>${censurarNome(aluno.nome)}</td>

        <td>${censurarNome(aluno.responsavel)}</td>

        <td>
  ${censurarValor(
    obterValorMensalidade(
      aluno.id,
      referencia
    )
  )}
</td>

        <td>${referencia} • Dia ${aluno.vencimento}</td>

        <td>
          <span class="status ${statusFinal}">
            ${statusFinal}
          </span>
        </td>

        <td>
          <div class="tabela-acoes">


${
  status === 'pago'
  ? `
    <button onclick="estornarMensalidade(${aluno.id})">
      Estornar
    </button>
  `
  : status === 'resolvido'
  ? `
    <button onclick="desfazerResolucaoMensalidade(${aluno.id})">
      Desfazer resolução
    </button>
  `
  : `
    <button onclick="pagarMensalidade(${aluno.id})">
      Marcar como pago
    </button>

    <button onclick="resolverMensalidadeSemPagamento(${aluno.id})">
      Resolver sem pagamento
    </button>
  `
}
          </div>
        </td>

      </tr>

    `;

  });

  tabelaMensalidades.innerHTML =
  linhas ||
  `
    <tr>
      <td colspan="6">Nenhuma mensalidade encontrada.</td>
    </tr>
  `;

}

let responsavelImportacaoAtual = null;

function abrirImportacaoManual(nomeResponsavel){

  responsavelImportacaoAtual = nomeResponsavel;

  const input =
    document.getElementById('arquivoBoletoManual');

  if(input){
    input.click();
  }

}
function renderizarCobrancasPorResponsavel(){

  const container = document.getElementById('listaCobrancas');
  if(!container) return;

  container.innerHTML = '';

  const referencia = obterReferenciaFiltro();

  const filtroStatus =
    document.getElementById('filtroStatus')?.value || 'todos';

  const [anoRef, mesRef] =
    referencia.split('-').map(Number);

  const mapa = {};

  alunos.forEach(aluno => {

    const mesMatricula =
      Number(aluno.mesMatricula || mesRef);

    const anoMatricula =
      Number(aluno.anoMatricula || anoRef);

    const mensalidadeAntesDaMatricula =
      anoRef < anoMatricula ||
      (
        anoRef === anoMatricula &&
        mesRef < mesMatricula
      );

    if(mensalidadeAntesDaMatricula){
      return;
    }

    const statusAluno =
      verificarStatusMensalidade(
        aluno.id,
        referencia
      );

    if(statusAluno === 'resolvido'){
      return;
    }

    if(!mapa[aluno.responsavel]){
      mapa[aluno.responsavel] = {
        responsavel: aluno.responsavel,
        alunos: [],
        total: 0
      };
    }

    mapa[aluno.responsavel].alunos.push(aluno);

    mapa[aluno.responsavel].total +=
      obterValorMensalidade(
        aluno.id,
        referencia
      );

  });

  Object.values(mapa).forEach(grupo => {

    const cliente =
      clientes.find(c => c.nome === grupo.responsavel);

    const cobranca =
      cliente
      ? cobrancas.find(c =>
          Number(c.responsavel_id) === Number(cliente.id) &&
          c.referencia === referencia
        )
      : null;

    const boletoGerado =
      cobranca && cobranca.link_boleto;

    const todosPagos = grupo.alunos.every(aluno => {
      const status = verificarStatusMensalidade(aluno.id, referencia);
      return status === 'pago' || status === 'resolvido';
    });

    const algumAtrasado = grupo.alunos.some(aluno =>
      verificarStatusMensalidade(aluno.id, referencia) === 'pendente' &&
      verificarAtraso(aluno, referencia)
    );

    const statusFinal =
      todosPagos ? 'pago' :
      algumAtrasado ? 'atrasado' :
      'pendente';

const whatsappEnviado =
  cobranca &&
  Number(cobranca.whatsapp_enviado) === 1;

if(filtroStatus !== 'todos'){

  if(filtroStatus === 'com_boleto' && !boletoGerado){
    return;
  }

  if(filtroStatus === 'sem_boleto' && boletoGerado){
    return;
  }

  if(filtroStatus === 'whatsapp_enviado' && !whatsappEnviado){
    return;
  }

  if(filtroStatus === 'whatsapp_nao_enviado' && whatsappEnviado){
    return;
  }

  if(
    filtroStatus !== 'com_boleto' &&
    filtroStatus !== 'sem_boleto' &&
    filtroStatus !== 'whatsapp_enviado' &&
    filtroStatus !== 'whatsapp_nao_enviado' &&
    statusFinal !== filtroStatus
  ){
    return;
  }

}
    const textoBoleto =
      boletoGerado
      ? (
          cobranca.origem === 'manual'
          ? 'Com Boleto Importado'
          : 'Com Boleto Gerado'
        )
      : 'Sem Boleto';
      
    const textoStatus =
      todosPagos ? 'Pago' :
      algumAtrasado ? 'Atrasado' :
      'Pendente';

    const listaAlunos =
      grupo.alunos
      .map(a => `• ${censurarNome(a.nome)}`)
      .join('<br>');

    container.innerHTML += `

      <div class="cobranca-card">

        <h3
          class="titulo-responsavel"
          onclick="toggleResponsavel(this)"
        >
          <span>${censurarNome(grupo.responsavel)}</span>

          <span class="seta">
            ▼
          </span>
        </h3>

        <div class="etiqueta-boleto ${boletoGerado ? 'emitido' : 'nao-emitido'}">
          ${textoBoleto}
        </div>

        <div class="resumo-responsavel">

          <strong>
            ${censurarValor(grupo.total)}
          </strong>

          <span class="status ${statusFinal}">
            ${textoStatus}
          </span>

        </div>

        <div class="conteudo-responsavel">

          <div class="cobranca-alunos">
            <strong>Alunos</strong>
            <p>${listaAlunos}</p>
          </div>

          <div class="cobranca-total">
            <span>Total da Cobrança</span>
            <strong>${censurarValor(grupo.total)}</strong>
          </div>

          <div class="cobranca-total">
            <span>Referência</span>
            <strong>${referencia}</strong>
          </div>

          ${
            boletoGerado
            ? `
              <div class="boleto-info">

                <div class="boleto-origem-linha">

                  <span class="status pago">
                    Boleto Gerado
                  </span>

                  <span class="boleto-origem ${
                    cobranca.origem === 'manual'
                    ? 'origem-manual'
                    : 'origem-boleto'
                  }">
                    ${
                      cobranca.origem === 'manual'
                      ? 'Importado Manualmente'
                      : 'Boleto'
                    }
                  </span>

                </div>

                <p>
                  <strong>Gerado em:</strong>
                  ${cobranca.criadoEm || '-'}
                </p>

                ${
                  cobranca.linha_digitavel
                  ? `
                    <p>
                      <strong>Linha digitável:</strong><br>
                      <small>${cobranca.linha_digitavel}</small>
                    </p>
                  `
                  : ''
                }

              </div>
            `
            : ''
          }

          <div class="tabela-acoes">

            ${
              boletoGerado
              ? `
                <button
                  onclick="abrirBoletoResponsavel('${grupo.responsavel}')"
                >
                  Abrir Boleto
                </button>

                <button
                  class="btn-whatsapp ${whatsappEnviado ? 'enviado' : ''}"
                  onclick="enviarWhatsappResponsavel('${grupo.responsavel}', this)"
                >
                  ${whatsappEnviado ? '✓ Enviado' : 'WhatsApp'}
                </button>

                <button
                  onclick="removerBoletoResponsavel('${grupo.responsavel}')"
                >
                  Remover Boleto
                </button>
              `
              : `
                <button
                  onclick="mostrarDadosBoletoResponsavel('${grupo.responsavel}')"
                >
                  Ver dados do boleto
                </button>

                <button
                  class="btn-gerar-boleto"
                  onclick="abrirImportacaoManual('${grupo.responsavel}')"
                >
                  Importar Boleto
                </button>
              `
            }

          </div>

        </div>

      </div>

    `;

  });

}

function mostrarDadosBoletoResponsavel(nomeResponsavel){

  const grupo = obterGrupoResponsavel(nomeResponsavel);
  const cliente = grupo.responsavel;

  if(!cliente){
    alert('Responsável não encontrado.');
    return;
  }

  const referencia = obterReferenciaCentral();

  const alunosTexto =
    grupo.alunos.map(a => a.nome).join(', ');

  const vencimentos =
    [...new Set(
      grupo.alunos.map(
        a => `Dia ${a.vencimento}`
      )
    )].join(', ');

  const texto =
    `DADOS PARA GERAR BOLETO\n\n` +
    `Responsável: ${cliente.nome}\n` +
    `CPF: ${cliente.cpf}\n` +
    `E-mail: ${cliente.email}\n` +
    `Telefone: ${cliente.telefone}\n\n` +
    `Aluno(s): ${alunosTexto}\n` +
    `Valor: ${formatarMoeda(grupo.total)}\n` +
    `Vencimento: ${vencimentos}\n` +
    `Referência: ${referencia}`;

  abrirModalDadosBoleto(texto);

}

function obterGrupoResponsavel(nomeResponsavel){

  const grupoAlunos =
    alunos.filter(a => a.responsavel === nomeResponsavel);

  const responsavel =
    clientes.find(c => c.nome === nomeResponsavel);

const referencia = obterReferenciaFiltro();

const total =
  grupoAlunos.reduce(
    (soma, aluno) =>
      soma +
      obterValorMensalidade(
        aluno.id,
        referencia
      ),
    0
  );

  return {
    responsavel,
    alunos: grupoAlunos,
    total
  };

}

function abrirBoletoResponsavel(nomeResponsavel){

  const grupo = obterGrupoResponsavel(nomeResponsavel);

  if(!grupo.responsavel){
    alert('Responsável não encontrado.');
    return;
  }

  const cobranca =
    cobrancas.find(c =>
      Number(c.responsavel_id) === Number(grupo.responsavel.id)
    );

  if(!cobranca || !cobranca.link_boleto){
    alert('Nenhum boleto encontrado.');
    return;
  }

  window.open(cobranca.link_boleto, '_blank');

}

async function enviarWhatsappResponsavel(nomeResponsavel, botao){

  const grupo = obterGrupoResponsavel(nomeResponsavel);

  if(!grupo.responsavel){
    alert('Responsável não encontrado.');
    return;
  }

  const referencia = obterReferenciaFiltro();

  const cobranca =
    cobrancas.find(c =>
      Number(c.responsavel_id) === Number(grupo.responsavel.id) &&
      c.referencia === referencia
    );

  if(!cobranca || !cobranca.link_boleto){
    alert('Gere o boleto primeiro.');
    return;
  }

const jaEnviado =
  cobranca &&
  Number(cobranca.whatsapp_enviado) === 1;
  if(jaEnviado){

    const reenviar = confirm(
      'Esta cobrança já foi enviada.\n\nDeseja enviar novamente?'
    );

    if(!reenviar){
      return;
    }

  }

  try{

    if(botao){
      botao.innerHTML = 'Enviando...';
      botao.disabled = true;
    }

const vencimentos = [
  ...new Set(
    grupo.alunos.map(a => `Dia ${a.vencimento}`)
  )
].join(', ');

await apiPost('/api/whatsapp/enviar-cobranca', {
  telefone: grupo.responsavel.telefone,
  responsavel: grupo.responsavel.nome,
  aluno: grupo.alunos.map(a => a.nome).join(', '),
  valor: grupo.total,
  vencimento: vencimentos,
  link_boleto: cobranca.link_boleto,
  linha_digitavel: cobranca.linha_digitavel,

  responsavel_id: grupo.responsavel.id,
  referencia: referencia
});


    if(botao){
      botao.innerHTML = '✓ Enviado';
      botao.classList.add('enviado');
      botao.disabled = false;
    }

    alert('Cobrança enviada com sucesso.');

  }catch(error){

    console.error(error);

    if(botao){
      botao.innerHTML = jaEnviado ? '✓ Enviado' : 'WhatsApp';
      botao.disabled = false;

      if(jaEnviado){
        botao.classList.add('enviado');
      }else{
        botao.classList.remove('enviado');
      }
    }

    alert('Erro ao enviar cobrança.');

  }

}
async function removerBoletoResponsavel(nomeResponsavel){

  const grupo = obterGrupoResponsavel(nomeResponsavel);
  const cliente = grupo.responsavel;

  if(!cliente){
    alert('Responsável não encontrado.');
    return;
  }

  const referencia = obterReferenciaCentral();

  const cobrancasEncontradas = cobrancas.filter(c =>
    Number(c.responsavel_id) === Number(cliente.id) &&
    c.referencia === referencia
  );

  if(cobrancasEncontradas.length === 0){
    alert('Nenhum boleto encontrado para remover.');
    return;
  }

  const confirmar = confirm(
    `Deseja realmente remover ${cobrancasEncontradas.length} boleto(s)?`
  );

  if(!confirmar) return;

  try{

    for(const cobranca of cobrancasEncontradas){

      await apiDelete(`/api/cobrancas/${cobranca.id}`);

    }

    await carregarDados();

    renderizarCentralCobrancas();
    atualizarDashboard();

    alert('Boleto removido com sucesso.');

  }catch(erro){

    console.error(erro);
    alert('Erro ao remover boleto.');

  }

}
/* =========================================================
DASHBOARD — FILTROS
========================================================= */

const mesBtns = document.querySelectorAll('.mes-btn');
const filtroAnoDashboard = document.getElementById('filtroAnoDashboard');

const hojeDashboard = new Date();

let mesDashboardSelecionado = 'todos';
let anoDashboardSelecionado = hojeDashboard.getFullYear();

if(filtroAnoDashboard){

  filtroAnoDashboard.innerHTML = '';

  for(let ano = 2025; ano <= 2040; ano++){

    filtroAnoDashboard.innerHTML += `
      <option value="${ano}">
        ${ano}
      </option>
    `;

  }

  filtroAnoDashboard.value =
  String(anoDashboardSelecionado);

  filtroAnoDashboard.addEventListener('change', () => {

    anoDashboardSelecionado =
    Number(filtroAnoDashboard.value);

    atualizarDashboard();

  });

}

mesBtns.forEach(btn => {

  const mesBotao =
  btn.dataset.mes === 'todos'
  ? 'todos'
  : Number(btn.dataset.mes);

  btn.classList.toggle(
    'active',
    mesBotao === mesDashboardSelecionado
  );

  btn.addEventListener('click', () => {

    mesBtns.forEach(b => {
      b.classList.remove('active');
    });

    btn.classList.add('active');

    mesDashboardSelecionado =
    btn.dataset.mes === 'todos'
    ? 'todos'
    : Number(btn.dataset.mes);

    atualizarDashboard();

  });

});

/* =========================================================
DASHBOARD — CÁLCULOS
========================================================= */

function calcularResumoFinanceiro(mes, ano){

  let entradas = 0;
  let saidas = 0;
  let pendencias = 0;
  let recebidas = 0;
  let atrasadas = 0;

  alunos.forEach(aluno => {

    const mesInicio =
    aluno.mesMatricula || 1;

    const anoInicio =
    aluno.anoMatricula || 2025;

    if(ano < anoInicio){
      return;
    }

    for(let m = 1; m <= 12; m++){

      if(mes !== 'todos' && m !== Number(mes)){
        continue;
      }

      if(
        ano === anoInicio &&
        m < mesInicio
      ){
        continue;
      }

      const referencia =
      montarReferencia(m, ano);

      const status =
      verificarStatusMensalidade(
        aluno.id,
        referencia
      );

      const atrasado =
      status === 'pendente' &&
      verificarAtraso(aluno, referencia);

const valorMensalidade =
  obterValorMensalidade(
    aluno.id,
    referencia
  );

if(status === 'pago'){

  recebidas += valorMensalidade;
  entradas += valorMensalidade;

}else if(status === 'resolvido'){

  // Não soma em recebido e não soma em pendente

}else{

  pendencias += valorMensalidade;

}
      if(atrasado){
        atrasadas++;
      }

    }

  });

  financeiro.forEach(item => {

    if(item.status !== 'pago') return;

    if(Number(item.ano) !== Number(ano)) return;

    if(
      mes !== 'todos' &&
      Number(item.mes) !== Number(mes)
    ){
      return;
    }

    if(item.tipo === 'entrada'){
      entradas += Number(item.valor);
    }

    if(item.tipo === 'saida'){
      saidas += Number(item.valor);
    }

  });

  const saldoPeriodo = entradas - saidas;

 return {
  entradas,
  saidas,
  saldoPeriodo,
  pendencias,
  recebidas,
  atrasadas
};

}

function calcularCaixaAtual(){

  let entradas = 0;
  let saidas = 0;

  financeiro.forEach(item => {

    if(item.status !== 'pago') return;

    if(item.tipo === 'entrada'){
      entradas += Number(item.valor);
    }

    if(item.tipo === 'saida'){
      saidas += Number(item.valor);
    }

  });

  pagamentosMensais.forEach(pagamento => {

    const valorMensalidade =
      obterValorMensalidade(
        pagamento.alunoId,
        pagamento.referencia
      );

    entradas += valorMensalidade;

  });

  return entradas - saidas;

}

function atualizarDashboard(){

  const resumo =
  calcularResumoFinanceiro(
    mesDashboardSelecionado,
    anoDashboardSelecionado
  );

  const caixaAtual =
  calcularCaixaAtual();

  const campos = {
    totalAlunos: alunos.length,
    mensalidadesAtrasadas: resumo.atrasadas,
    totalEntradas: formatarMoeda(resumo.entradas),
    totalSaidas: formatarMoeda(resumo.saidas),
    lucroTotal: formatarMoeda(resumo.saldoPeriodo),
    caixaAtual: formatarMoeda(caixaAtual),
   valorRecebido: censurarValor(resumo.recebidas),
valorPendente: censurarValor(resumo.pendencias),
    resumoEntradas: formatarMoeda(resumo.entradas),
    resumoSaidas: formatarMoeda(resumo.saidas),
    resumoLucro: formatarMoeda(resumo.saldoPeriodo)
  };

  Object.keys(campos).forEach(id => {

    const elemento =
    document.getElementById(id);

    if(elemento){
      elemento.innerText = campos[id];
    }

  });

  renderizarUltimasMovimentacoes();

}

/* =========================================================
ÚLTIMAS MOVIMENTAÇÕES
========================================================= */

function renderizarUltimasMovimentacoes(){

  const container =
  document.getElementById('ultimasMovimentacoes');

  if(!container) return;

  container.innerHTML = '';

  const ultimos =
  financeiro
  .slice()
  .sort((a, b) => Number(b.id) - Number(a.id))
  .slice(0,5);

  if(ultimos.length === 0){

    container.innerHTML = `
      <div class="movimentacao-vazia">
        Nenhuma movimentação registrada
      </div>
    `;

    return;

  }

  ultimos.forEach(item => {

    container.innerHTML += `

      <div class="movimentacao-item">

        <div>
          <strong>${item.descricao}</strong>
          <br>
          <span>${item.categoria} • ${formatarMoeda(item.valor)}</span>
        </div>

        <span class="status ${item.status}">
          ${item.status}
        </span>

      </div>

    `;

  });

}

/* =========================================================
RELATÓRIOS PREMIUM
========================================================= */

function cabecalhoRelatorio(doc, titulo){

  doc.setFillColor(3, 12, 34);
  doc.rect(0, 0, 297, 32, 'F');

  doc.setTextColor(245, 215, 110);
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text('Instituto Rodrigues Prado', 14, 14);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text('Sistema Administrativo Financeiro', 14, 22);

  doc.setTextColor(245, 215, 110);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(titulo, 148, 48, { align:'center' });

  doc.setTextColor(90, 90, 90);
  doc.setFontSize(10);
  doc.text(
    `Emitido em: ${new Date().toLocaleDateString('pt-BR')}`,
    148,
    56,
    { align:'center' }
  );

}

function rodapeRelatorio(doc){

  const paginas = doc.internal.getNumberOfPages();

  for(let i = 1; i <= paginas; i++){

    doc.setPage(i);

    doc.setFillColor(3, 12, 34);
    doc.rect(0, 200, 297, 10, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);

    doc.text(
      `Instituto Rodrigues Prado • Página ${i} de ${paginas}`,
      148,
      206,
      { align:'center' }
    );

  }

}

function cardResumoPdf(doc, titulo, valor, x, y){

  doc.setFillColor(248, 248, 248);
  doc.roundedRect(x, y, 62, 22, 3, 3, 'F');

  doc.setDrawColor(212, 175, 55);
  doc.roundedRect(x, y, 62, 22, 3, 3);

  doc.setTextColor(80, 80, 80);
  doc.setFontSize(9);
  doc.text(titulo, x + 5, y + 8);

  doc.setTextColor(3, 12, 34);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.text(String(valor), x + 5, y + 17);

  doc.setFont(undefined, 'normal');

}

async function gerarRelatorioFinanceiro(){

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation:'landscape',
    unit:'mm',
    format:'a4'
  });

  const referencia = obterReferenciaFiltro();

  let entradasManuais = 0;
  let saidasManuais = 0;
  let mensalidadesRecebidas = 0;
  let mensalidadesPendentes = 0;
  let mensalidadesAtrasadas = 0;

  const linhas = [];

  financeiro.forEach(item => {

    const valor = Number(item.valor || 0);

    if(item.status === 'pago'){

      if(item.tipo === 'entrada'){
        entradasManuais += valor;
      }

      if(item.tipo === 'saida'){
        saidasManuais += valor;
      }

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

    const status = verificarStatusMensalidade(aluno.id, referencia);

    const estaAtrasado =
      status === 'pendente' &&
      verificarAtraso(aluno, referencia);

    const statusFinal =
      estaAtrasado ? 'ATRASADO' : status.toUpperCase();

    const valor = Number(aluno.mensalidade || 0);

    if(status === 'pago'){
      mensalidadesRecebidas += valor;
    }else{
      mensalidadesPendentes += valor;
    }

    if(estaAtrasado){
      mensalidadesAtrasadas += valor;
    }

    linhas.push([
      referencia,
      'Mensalidade',
      aluno.nome,
      aluno.responsavel,
      'entrada',
      formatarMoeda(valor),
      statusFinal
    ]);

  });

  const totalEntradas =
    entradasManuais + mensalidadesRecebidas;

  const totalSaidas =
    saidasManuais;

  const saldoGeral =
    totalEntradas - totalSaidas;

  cabecalhoRelatorio(doc, 'Relatório Financeiro Geral');

  cardResumoPdf(doc, 'Entradas', formatarMoeda(totalEntradas), 14, 66);
  cardResumoPdf(doc, 'Saídas', formatarMoeda(totalSaidas), 82, 66);
  cardResumoPdf(doc, 'Saldo Geral', formatarMoeda(saldoGeral), 150, 66);
  cardResumoPdf(doc, 'Referência', referencia, 218, 66);

  /* GRÁFICO 1 - ENTRADAS X SAÍDAS */
  const graficoX = 22;
  const graficoY = 115;
  const larguraBarra = 38;
  const alturaMaxima = 38;

  const maiorValor = Math.max(totalEntradas, totalSaidas, 1);

  const alturaEntrada =
    (totalEntradas / maiorValor) * alturaMaxima;

  const alturaSaida =
    (totalSaidas / maiorValor) * alturaMaxima;

  doc.setFontSize(14);
  doc.setTextColor(3,12,34);
  doc.text('Entradas x Saídas', graficoX, graficoY - 10);

  doc.setFillColor(34,197,94);
  doc.rect(graficoX, graficoY + alturaMaxima - alturaEntrada, larguraBarra, alturaEntrada, 'F');

  doc.setFillColor(239,68,68);
  doc.rect(graficoX + 55, graficoY + alturaMaxima - alturaSaida, larguraBarra, alturaSaida, 'F');

  doc.setFontSize(9);
  doc.setTextColor(0,0,0);
  doc.text('Entradas', graficoX + 2, graficoY + alturaMaxima + 8);
  doc.text(formatarMoeda(totalEntradas), graficoX, graficoY + alturaMaxima + 14);

  doc.text('Saídas', graficoX + 60, graficoY + alturaMaxima + 8);
  doc.text(formatarMoeda(totalSaidas), graficoX + 55, graficoY + alturaMaxima + 14);

  /* GRÁFICO 2 - MENSALIDADES */
  const grafico2X = 160;
  const grafico2Y = 115;

  const maiorMensalidade = Math.max(
    mensalidadesRecebidas,
    mensalidadesPendentes,
    mensalidadesAtrasadas,
    1
  );

  const alturaRecebidas =
    (mensalidadesRecebidas / maiorMensalidade) * alturaMaxima;

  const alturaPendentes =
    (mensalidadesPendentes / maiorMensalidade) * alturaMaxima;

  const alturaAtrasadas =
    (mensalidadesAtrasadas / maiorMensalidade) * alturaMaxima;

  doc.setFontSize(14);
  doc.setTextColor(3,12,34);
  doc.text('Situação das Mensalidades', grafico2X, grafico2Y - 10);

  doc.setFillColor(34,197,94);
  doc.rect(grafico2X, grafico2Y + alturaMaxima - alturaRecebidas, 30, alturaRecebidas, 'F');

  doc.setFillColor(245,158,11);
  doc.rect(grafico2X + 45, grafico2Y + alturaMaxima - alturaPendentes, 30, alturaPendentes, 'F');

  doc.setFillColor(239,68,68);
  doc.rect(grafico2X + 90, grafico2Y + alturaMaxima - alturaAtrasadas, 30, alturaAtrasadas, 'F');

  doc.setFontSize(8);
  doc.setTextColor(0,0,0);

  doc.text('Recebidas', grafico2X, grafico2Y + alturaMaxima + 8);
  doc.text(formatarMoeda(mensalidadesRecebidas), grafico2X, grafico2Y + alturaMaxima + 14);

  doc.text('Pendentes', grafico2X + 45, grafico2Y + alturaMaxima + 8);
  doc.text(formatarMoeda(mensalidadesPendentes), grafico2X + 45, grafico2Y + alturaMaxima + 14);

  doc.text('Atrasadas', grafico2X + 90, grafico2Y + alturaMaxima + 8);
  doc.text(formatarMoeda(mensalidadesAtrasadas), grafico2X + 90, grafico2Y + alturaMaxima + 14);

  doc.autoTable({
    startY:178,
    head:[[
      'Data/Ref.',
      'Origem',
      'Descrição',
      'Categoria/Responsável',
      'Tipo',
      'Valor',
      'Status'
    ]],
    body:linhas,
    theme:'grid',
    headStyles:{
      fillColor:[3,12,34],
      textColor:[245,215,110],
      fontStyle:'bold'
    },
    styles:{
      fontSize:8,
      cellPadding:3
    },
    alternateRowStyles:{
      fillColor:[248,248,248]
    }
  });

  rodapeRelatorio(doc);

  doc.save('relatorio-financeiro-geral-instituto.pdf');

}
async function gerarRelatorioAlunos(){

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation:'landscape',
    unit:'mm',
    format:'a4'
  });

  const rows = alunos.map(aluno => [
    aluno.nome,
    aluno.responsavel,
    formatarMoeda(aluno.mensalidade),
    `Dia ${aluno.vencimento}`,
    `${String(aluno.mesMatricula || '').padStart(2,'0')}/${aluno.anoMatricula || ''}`
  ]);

  cabecalhoRelatorio(doc, 'Relatório de Alunos');

  cardResumoPdf(doc, 'Total de Alunos', alunos.length, 14, 66);
  cardResumoPdf(doc, 'Responsáveis', clientes.length, 82, 66);

  doc.autoTable({
    startY:100,
    head:[[
      'Aluno',
      'Responsável',
      'Mensalidade',
      'Vencimento',
      'Matrícula'
    ]],
    body:rows,
    theme:'grid',
    headStyles:{
      fillColor:[3,12,34],
      textColor:[245,215,110],
      fontStyle:'bold'
    },
    styles:{
      fontSize:10,
      cellPadding:4
    },
    alternateRowStyles:{
      fillColor:[248,248,248]
    }
  });

  rodapeRelatorio(doc);

  doc.save('relatorio-alunos-instituto.pdf');

}

async function gerarRelatorioMensalidades(){

  const { jsPDF } = window.jspdf;

  const doc = new jsPDF({
    orientation:'landscape',
    unit:'mm',
    format:'a4'
  });

  const referencia = obterReferenciaFiltro();

  let pagas = 0;
  let pendentes = 0;
  let atrasadas = 0;

  const rows = alunos.map(aluno => {

    const status = verificarStatusMensalidade(aluno.id, referencia);

    const estaAtrasado =
    status === 'pendente' &&
    verificarAtraso(aluno, referencia);

    const statusFinal =
    estaAtrasado ? 'ATRASADO' : status.toUpperCase();

    if(status === 'pago') pagas++;
    if(status === 'pendente') pendentes++;
    if(estaAtrasado) atrasadas++;

    return [
      aluno.nome,
      aluno.responsavel,
      formatarMoeda(aluno.mensalidade),
      `${referencia} • Dia ${aluno.vencimento}`,
      statusFinal
    ];

  });

  cabecalhoRelatorio(doc, 'Relatório de Mensalidades');

  cardResumoPdf(doc, 'Pagas', pagas, 14, 66);
  cardResumoPdf(doc, 'Pendentes', pendentes, 82, 66);
  cardResumoPdf(doc, 'Atrasadas', atrasadas, 150, 66);
  cardResumoPdf(doc, 'Referência', referencia, 218, 66);

  doc.autoTable({
    startY:100,
    head:[[
      'Aluno',
      'Responsável',
      'Mensalidade',
      'Referência',
      'Status'
    ]],
    body:rows,
    theme:'grid',
    headStyles:{
      fillColor:[3,12,34],
      textColor:[245,215,110],
      fontStyle:'bold'
    },
    styles:{
      fontSize:10,
      cellPadding:4
    },
    alternateRowStyles:{
      fillColor:[248,248,248]
    }
  });

  rodapeRelatorio(doc);

  doc.save('relatorio-mensalidades-instituto.pdf');

}
/* =========================================================
ENVIAR COBRANÇA WHATSAPP
========================================================= */

async function enviarCobrancaWhatsapp(alunoId, referencia){

  const aluno = alunos.find(a => Number(a.id) === Number(alunoId));

  if(!aluno){
    alert('Aluno não encontrado.');
    return;
  }

  const cliente = clientes.find(c => c.nome === aluno.responsavel);

  if(!cliente){
    alert('Responsável não encontrado.');
    return;
  }

  const boleto = obterBoleto(alunoId, referencia);

  if(!boleto || !boleto.link_boleto){
    alert('Gere o boleto antes de enviar a cobrança.');
    return;
  }

  const confirmar = confirm(
    `Enviar cobrança pelo WhatsApp para ${cliente.nome}?`
  );

  if(!confirmar) return;

  try{

    await apiPost('/api/whatsapp/enviar-cobranca', {
      telefone: cliente.telefone,
      responsavel: cliente.nome,
      aluno: aluno.nome,
      valor: aluno.mensalidade,
      vencimento: `Dia ${aluno.vencimento}`,
      link_boleto: boleto.link_boleto,
      linha_digitavel: boleto.linha_digitavel,

      responsavel_id: cliente.id,
      referencia: referencia
    });

    alert('Cobrança enviada pelo WhatsApp com sucesso.');

  }catch(error){

    console.error(error);
    alert(error.message || 'Erro ao enviar cobrança pelo WhatsApp.');

  }

}

async function enviarCobrancasEmMassa(){

  const referencia = obterReferenciaFiltro();

  const confirmar = confirm(
    `Deseja iniciar o envio em massa das cobranças de ${referencia}?\n\n` +
    `O sistema vai enviar somente cobranças COM BOLETO e com WhatsApp NÃO ENVIADO.\n\n` +
    `Os envios serão intercalados para reduzir risco de bloqueio.`
  );

  if(!confirmar) return;

  try{

    const botao = document.getElementById('btnEnviarCobrancasMassa');

    if(botao){
      botao.disabled = true;
      botao.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        Iniciando fila...
      `;
    }

    const resposta = await apiPost('/api/cobrancas/enviar-em-massa', {
      referencia
    });

    alert(
      `${resposta.mensagem}\n\n` +
      `Quantidade na fila: ${resposta.quantidade || 0}`
    );

    await atualizarStatusFilaCobrancas();

  }catch(error){

    console.error(error);
    alert(error.message || 'Erro ao iniciar cobranças em massa.');

  }finally{

    const botao = document.getElementById('btnEnviarCobrancasMassa');

    if(botao){
      botao.disabled = false;
      botao.innerHTML = `
        <i class="fa-brands fa-whatsapp"></i>
        Enviar cobranças em massa
      `;
    }

  }

}

async function atualizarStatusFilaCobrancas(){

  // Nao consulta sem sessao ativa (evita 401 na tela de login)
  if(!usuarioLogado) return;

  try{

    const dados = await apiGet('/api/cobrancas/fila-status');

    const area = document.getElementById('statusFilaCobrancas');

    if(!area) return;

    if(dados.rodando){

      area.innerHTML = `
        <div class="fila-cobrancas-card rodando">
          <strong>Fila de cobranças em andamento</strong>
          <span>Total: ${dados.total}</span>
          <span>Enviadas: ${dados.enviadas}</span>
          <span>Restantes: ${dados.restantes}</span>
          <span>Erros: ${dados.erros}</span>
        </div>
      `;

    }else{

      area.innerHTML = `
        <div class="fila-cobrancas-card parada">
          <strong>Nenhuma fila em andamento</strong>
          <span>As cobranças em massa aparecerão aqui quando forem iniciadas.</span>
        </div>
      `;

    }

  }catch(error){
    console.error('Erro ao buscar status da fila:', error);
  }

}

setInterval(atualizarStatusFilaCobrancas, 15000);



async function gerarRelatorioWhatsapp(jid){

  const referencia = obterMesAtualReferencia();
  const [ano, mes] = referencia.split('-').map(Number);

  const { data: alunos } =
    await supabase.from('alunos').select('*');

  const { data: clientes } =
    await supabase.from('clientes').select('*');

  const { data: pagamentos } =
    await supabase
      .from('pagamentosmensais')
      .select('*')
      .eq('referencia', referencia);

  const { data: financeiro } =
    await supabase
      .from('financeiro')
      .select('*')
      .eq('mes', mes)
      .eq('ano', ano);

  let totalPagas = 0;
  let totalPendentes = 0;

  alunos.forEach(aluno => {
    const pago = pagamentos.some(
      p => Number(p.alunoid) === Number(aluno.id)
    );

    if(pago){
      totalPagas += Number(aluno.mensalidade || 0);
    } else {
      totalPendentes += Number(aluno.mensalidade || 0);
    }
  });

  const entradas = financeiro
    .filter(item =>
      item.tipo === 'entrada' &&
      item.status === 'pago'
    )
    .reduce((soma, item) =>
      soma + Number(item.valor || 0), 0);

  const saidas = financeiro
    .filter(item =>
      item.tipo === 'saida' &&
      item.status === 'pago'
    )
    .reduce((soma, item) =>
      soma + Number(item.valor || 0), 0);

  const saldo =
    entradas + totalPagas - saidas;

  const nomeArquivo =
    `relatorio-${referencia}.pdf`;

  const caminhoArquivo =
    path.join(__dirname, nomeArquivo);

  const doc = new PDFDocument();

  doc.pipe(fs.createWriteStream(caminhoArquivo));

  doc.fontSize(20)
    .text('Instituto Rodrigues Prado', {
      align:'center'
    });

  doc.moveDown();

  doc.fontSize(16)
    .text(`Relatório Financeiro - ${referencia}`);

  doc.moveDown();

  doc.fontSize(12)
    .text(`Mensalidades Pagas: ${formatarMoeda(totalPagas)}`);
  doc.text(`Mensalidades Pendentes: ${formatarMoeda(totalPendentes)}`);
  doc.text(`Entradas Extras: ${formatarMoeda(entradas)}`);
  doc.text(`Saídas: ${formatarMoeda(saidas)}`);
  doc.text(`Saldo Final: ${formatarMoeda(saldo)}`);

  doc.moveDown();

  doc.text(`Total de alunos: ${alunos.length}`);
  doc.text(`Total de responsáveis: ${clientes.length}`);

  doc.end();

  doc.on('finish', async () => {
    await whatsappSock.sendMessage(jid, {
      document: fs.readFileSync(caminhoArquivo),
      mimetype:'application/pdf',
      fileName:nomeArquivo,
      caption:`📄 Relatório financeiro de ${referencia}`
    });

    fs.unlinkSync(caminhoArquivo);
  });

}
/* =========================================================
INICIAR
========================================================= */

async function iniciarSistema(){

  try{

    await carregarDados();

    // Define o mês padrão dos filtros como o mês atual
    const refAtual = obterReferenciaAtual();
    const filtroMesEl = document.getElementById('filtroMes');
    if(filtroMesEl && !filtroMesEl.value) filtroMesEl.value = refAtual;
    const centralMesEl = document.getElementById('centralFiltroMes');
    if(centralMesEl && !centralMesEl.value) centralMesEl.value = refAtual;

    renderizarClientes();
    renderizarAlunos();
    renderizarFinanceiro();
    renderizarMensalidades();
    atualizarSelectResponsaveis();
    atualizarDashboard();
    renderizarCentralCobrancas();

    conectarSocket();
    iniciarWhatsappFrontend();
    restaurarUltimaAba();
    atualizarBotaoModoCobranca();
    atualizarBotaoCensura();

  }catch(error){

    console.error(error);
    alert('Erro ao carregar dados do servidor.');

  }

}

// Bootstrap: valida a sessao no servidor (cookie) e so entao inicia o sistema
(async () => {
  const autenticado = await verificarLogin();
  if(autenticado){
    await iniciarSistema();
  }
})();
/* =========================================================
WHATSAPP FRONTEND
========================================================= */

let socketWhatsapp = null;

function iniciarWhatsappFrontend(){

  if(typeof io === 'undefined'){
    console.error('Socket.io não carregado.');
    return;
  }

  socketWhatsapp = io();

  socketWhatsapp.on('whatsapp-status', (status) => {
    atualizarStatusWhatsapp(status);
  });

  socketWhatsapp.on('whatsapp-qr', (qr) => {
    atualizarQrWhatsapp(qr);
  });

  socketWhatsapp.on('whatsapp-info', (info) => {
    atualizarInfoWhatsapp(info);
  });

  socketWhatsapp.on('fila-cobrancas-status', () => {
  atualizarStatusFilaCobrancas();
});

}

function atualizarStatusWhatsapp(status){

  const statusEl = document.getElementById('whatsappStatus');
  const btnDesconectar = document.getElementById('btnDesconectarWhatsapp');

  if(!statusEl) return;

  statusEl.innerText = status || 'Desconectado';

  statusEl.classList.remove('pago', 'pendente', 'atrasado');

  if(status === 'Conectado'){
    statusEl.classList.add('pago');

    if(btnDesconectar){
      btnDesconectar.style.display = 'block';
    }

  }else if(status === 'Aguardando conexão'){
    statusEl.classList.add('pendente');

    if(btnDesconectar){
      btnDesconectar.style.display = 'none';
    }

  }else{
    statusEl.classList.add('atrasado');

    if(btnDesconectar){
      btnDesconectar.style.display = 'none';
    }
  }

}

function atualizarQrWhatsapp(qr){

  const qrBox = document.getElementById('whatsappQrBox');

  if(!qrBox) return;

  if(qr){

    qrBox.innerHTML = `
      <img src="${qr}" alt="QR Code WhatsApp">
    `;

  }else{

  qrBox.innerHTML = `
    <div class="whatsapp-qr-placeholder">
      <i class="fa-solid fa-circle-check"></i>
      <p>WhatsApp conectado com sucesso</p>
    </div>
  `;

}

}

function atualizarInfoWhatsapp(info){

  const nomeEl = document.getElementById('whatsappNome');
  const numeroEl = document.getElementById('whatsappNumero');

  if(nomeEl){
    nomeEl.innerText = info?.nome || 'Nenhuma conta conectada';
  }

  if(numeroEl){
    numeroEl.innerText = info?.numero || '-';
  }

}

async function desconectarWhatsapp(){

  const confirmar = confirm('Deseja desconectar este WhatsApp?');

  if(!confirmar) return;

  try{

    await apiPost('/api/whatsapp/desconectar', {});

    atualizarStatusWhatsapp('Desconectado');
    atualizarInfoWhatsapp(null);
    atualizarQrWhatsapp(null);

  }catch(error){

    console.error(error);
    alert('Erro ao desconectar WhatsApp.');

  }

}
// PagBank removido: o sistema opera sempre em modo manual (importar boleto).
// Mantida para compatibilidade com os pontos de chamada; garante o box de importacao visivel.
function atualizarBotaoModoCobranca(){
  const boxManual = document.getElementById('boxImportacaoManual');
  if(boxManual){
    boxManual.style.display = 'flex';
  }
}

async function importarBoletoManual(){

  const input = document.getElementById('arquivoBoletoManual');

  if(!input || !input.files || input.files.length === 0){
    alert('Selecione um boleto PDF ou imagem.');
    return;
  }

  const referencia = obterReferenciaCentral();

  const formData = new FormData();

  formData.append('boleto', input.files[0]);
  formData.append('referencia', referencia);

  try{

    const resposta = await fetch('/api/cobrancas/importar-boleto', {
      method:'POST',
      body:formData
    });

    const dados = await resposta.json();

    if(!resposta.ok){
      alert(dados.erro || 'Erro ao importar boleto.');
      return;
    }

    if(dados.sucesso){
      

      alert(
        `Boleto associado com sucesso!\n\n` +
        `Responsável: ${dados.responsavel}\n` +
        `Confiança: ${dados.confianca}\n` +
        `Valor: ${formatarMoeda(dados.valor_detectado || 0)}`
      );

      await carregarDados();

      renderizarCentralCobrancas();

      input.value = '';

      return;
    }

    alert(
      'O sistema importou o boleto, mas não conseguiu identificar o responsável automaticamente.'
    );

  }catch(error){

    console.error(error);
    alert('Erro ao importar boleto manual.');

  }

}
function toggleResponsavel(elemento){

  const card = elemento.closest('.cobranca-card');

  const conteudo = card.querySelector('.conteudo-responsavel');

  if(!conteudo) return;

  conteudo.classList.toggle('aberto');

  const seta = elemento.querySelector('.seta');

  if(seta){
    seta.textContent = conteudo.classList.contains('aberto') ? '▲' : '▼';
  }

}
const loginContainer =
document.querySelector('.login-container');

const reveal =
document.querySelector('.login-reveal');

const loginLogo =
document.querySelector('.login-logo');

if(loginContainer && reveal){

  loginContainer.addEventListener('mousemove', e => {

    if(loginContainer.classList.contains('fundo-aberto')){
      return;
    }

    const rect =
      loginContainer.getBoundingClientRect();

    reveal.style.setProperty(
      '--x',
      `${e.clientX - rect.left}px`
    );

    reveal.style.setProperty(
      '--y',
      `${e.clientY - rect.top}px`
    );

    loginContainer.classList.add('revelando');

  });

  loginContainer.addEventListener('mouseleave', () => {

    if(loginContainer.classList.contains('fundo-aberto')){
      return;
    }

    loginContainer.classList.remove('revelando');

  });

}

if(loginLogo && loginContainer){

  loginLogo.addEventListener('click', () => {
    loginContainer.classList.toggle('fundo-aberto');
  });

}
function obterValorMensalidade(alunoId, referencia){

  const aluno = alunos.find(a =>
    Number(a.id) === Number(alunoId)
  );

  return aluno
    ? Number(aluno.mensalidade || 0)
    : 0;

}
function abrirModalDadosBoleto(texto){

  document.getElementById(
    'textoDadosBoleto'
  ).value = texto;

  document.getElementById(
    'modalDadosBoleto'
  ).style.display = 'flex';

}

function fecharModalDadosBoleto(){

  document.getElementById(
    'modalDadosBoleto'
  ).style.display = 'none';

}

function copiarDadosBoleto(){

  const texto =
    document.getElementById(
      'textoDadosBoleto'
    );

  texto.select();
  texto.setSelectionRange(
    0,
    99999
  );

  navigator.clipboard.writeText(
    texto.value
  );

  alert(
    'Dados copiados com sucesso!'
  );

}
function alternarVisibilidadeSenha(){

  const campo =
    document.getElementById('senha');

  const icone =
    document.getElementById('iconeSenha');

  if(campo.type === 'password'){

    campo.type = 'text';

    icone.classList.remove('fa-eye');
    icone.classList.add('fa-eye-slash');

  }else{

    campo.type = 'password';

    icone.classList.remove('fa-eye-slash');
    icone.classList.add('fa-eye');

  }

}

/* =========================================================
CENTRAL DE COBRANÇAS
========================================================= */

function montarMensagemCobranca(cobranca, cliente, alunosGrupo){

  const nomes =
    alunosGrupo.length
    ? alunosGrupo.map(a => a.nome).join(', ')
    : '-';

  const valor = Number(cobranca.valor_total || 0)
    .toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });

  let texto =
    'Olá, ' + cliente.nome + '. Tudo bem?\n\n' +
    'Segue a cobrança referente ao Instituto Rodrigues Prado.\n\n' +
    'Aluno(s): ' + nomes + '\n' +
    'Referência: ' + cobranca.referencia + '\n' +
    'Valor: R$ ' + valor + '\n\n' +
    'Boleto:\n' + cobranca.link_boleto;

  if(cobranca.linha_digitavel){
    texto += '\n\nLinha digitável:\n' + cobranca.linha_digitavel;
  }

  texto += '\n\nCaso já tenha regularizado, desconsidere esta mensagem.';

  return texto;

}

function copiarMensagemCentralCobranca(id){

  const cobranca = cobrancas.find(c => Number(c.id) === Number(id));
  if(!cobranca) return;

  const cliente = clientes.find(c => Number(c.id) === Number(cobranca.responsavel_id));
  if(!cliente){ alert('Responsável não encontrado.'); return; }

  const alunosGrupo = alunos.filter(a => a.responsavel === cliente.nome);
  const mensagem = montarMensagemCobranca(cobranca, cliente, alunosGrupo);

  navigator.clipboard.writeText(mensagem)
    .then(() => alert('Mensagem copiada!'))
    .catch(() => prompt('Copie a mensagem:', mensagem));

}

function abrirWhatsappCentralCobranca(id){

  const cobranca = cobrancas.find(c => Number(c.id) === Number(id));
  if(!cobranca) return;

  const cliente = clientes.find(c => Number(c.id) === Number(cobranca.responsavel_id));
  if(!cliente){ alert('Responsável não encontrado.'); return; }

  const alunosGrupo = alunos.filter(a => a.responsavel === cliente.nome);
  const mensagem = montarMensagemCobranca(cobranca, cliente, alunosGrupo);
  const telefone = String(cliente.telefone || '').replace(/\D/g, '');

  window.open('https://wa.me/55' + telefone + '?text=' + encodeURIComponent(mensagem), '_blank');

}

async function marcarCobrancaEnviada(id, botao){

  try{

    if(botao){ botao.disabled = true; botao.innerHTML = 'Marcando...'; }

    await apiPatch('/api/cobrancas/' + id + '/whatsapp', { whatsapp_enviado: true });

    const cobranca = cobrancas.find(c => Number(c.id) === Number(id));
    if(cobranca) cobranca.whatsapp_enviado = 1;

    renderizarCentralCobrancas();

  }catch(error){

    console.error(error);
    alert('Erro ao marcar como enviado.');
    if(botao){ botao.disabled = false; botao.innerHTML = '<i class="fa-solid fa-check"></i> Marcar enviado'; }

  }

}

async function desfazerCobrancaEnviada(id, botao){

  try{

    if(botao){ botao.disabled = true; botao.innerHTML = 'Desfazendo...'; }

    await apiPatch('/api/cobrancas/' + id + '/whatsapp', { whatsapp_enviado: false });

    const cobranca = cobrancas.find(c => Number(c.id) === Number(id));
    if(cobranca) cobranca.whatsapp_enviado = 0;

    renderizarCentralCobrancas();

  }catch(e){

    alert('Erro ao desfazer envio.');
    if(botao){ botao.disabled = false; botao.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Desfazer envio'; }

  }

}

async function migrarBoletosParaSupabase(){

  const btn = document.getElementById('btnMigrarBoletos');
  const confirmar = confirm(
    'Isso vai mover todos os boletos salvos localmente para a nuvem (Supabase Storage).\n\n' +
    'Os links ficarão permanentes e não somem mais a cada atualização do sistema.\n\nContinuar?'
  );
  if(!confirmar) return;

  try{

    if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Migrando...'; }

    const resposta = await fetch('/api/admin/migrar-boletos', { method: 'POST' });
    const dados = await resposta.json();
    if(!resposta.ok) throw new Error(dados.erro || 'Erro desconhecido');

    await carregarDados();
    renderizarCentralCobrancas();

    const primeiroErro = dados.resultados?.find(r => r.status === 'erro');

    alert(
      'Migração concluída!\n\n' +
      '✅ Migrados: ' + dados.migrados + '\n' +
      '❌ Erros: ' + dados.erros + '\n' +
      '⚠️ Arquivo não encontrado: ' + dados.naoEncontrados + '\n\n' +
      (primeiroErro ? 'Primeiro erro: ' + primeiroErro.detalhe : '') +
      (dados.migrados > 0 ? 'Os boletos agora têm links permanentes na nuvem.' : '')
    );

  }catch(e){

    alert('Erro na migração: ' + e.message);

  }finally{

    if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Migrar Boletos para Nuvem'; }

  }

}

async function resetarEnviosCobrancas(){

  const referencia = obterReferenciaCentral();

  const confirmar = confirm(
    'Resetar todos os envios de "' + referencia + '"?\n\n' +
    'Todos os responsáveis voltarão a aparecer como "aguardando envio".'
  );

  if(!confirmar) return;

  try{

    await apiPatch('/api/cobrancas/reset-whatsapp', { referencia });

    cobrancas.forEach(c => {
      if(c.referencia === referencia) c.whatsapp_enviado = 0;
    });

    renderizarCentralCobrancas();
    alert('Envios resetados com sucesso!');

  }catch(e){

    console.error(e);
    alert('Erro ao resetar envios.');

  }

}

function renderizarCentralCobrancas(){

  const container = document.getElementById('listaCentralCobrancas');
  if(!container) return;

  const referencia = obterReferenciaCentral();
  const [anoRef, mesRef] = referencia.split('-').map(Number);
  const filtroStatus = document.getElementById('centralFiltroStatus')?.value || 'todos';

  // Mapa de todos os responsáveis com alunos nesta referência
  const mapa = {};

  alunos.forEach(aluno => {

    const mesMatricula = Number(aluno.mesMatricula || mesRef);
    const anoMatricula = Number(aluno.anoMatricula || anoRef);
    const antesDaMatricula =
      anoRef < anoMatricula ||
      (anoRef === anoMatricula && mesRef < mesMatricula);

    if(antesDaMatricula) return;

    const nome = aluno.responsavel;
    if(!mapa[nome]) mapa[nome] = { responsavel: nome, alunos: [], total: 0 };
    mapa[nome].alunos.push(aluno);
    mapa[nome].total += obterValorMensalidade(aluno.id, referencia);

  });

  // Enriquece cada grupo
  let grupos = Object.values(mapa).map(grupo => {

    const cliente = clientes.find(c => c.nome === grupo.responsavel);

    const cobranca = cliente
      ? cobrancas.find(c =>
          Number(c.responsavel_id) === Number(cliente.id) &&
          c.referencia === referencia
        )
      : null;

    const boletoGerado = !!(cobranca && cobranca.link_boleto);
    const whatsappEnviado = !!(cobranca && Number(cobranca.whatsapp_enviado) === 1);

    const todosPagos = grupo.alunos.every(a => {
      const s = verificarStatusMensalidade(a.id, referencia);
      return s === 'pago' || s === 'resolvido';
    });

    const algumAtrasado = grupo.alunos.some(a =>
      verificarStatusMensalidade(a.id, referencia) === 'pendente' &&
      verificarAtraso(a, referencia)
    );

    const statusPagamento =
      todosPagos ? 'pago' :
      algumAtrasado ? 'atrasado' :
      'pendente';

    return { ...grupo, cliente, cobranca, boletoGerado, whatsappEnviado, statusPagamento };

  });

  // Aplica filtro
  if(filtroStatus === 'sem_boleto')  grupos = grupos.filter(g => !g.boletoGerado);
  if(filtroStatus === 'com_boleto')  grupos = grupos.filter(g => g.boletoGerado);
  if(filtroStatus === 'aguardando')  grupos = grupos.filter(g => g.boletoGerado && !g.whatsappEnviado);
  if(filtroStatus === 'enviado')     grupos = grupos.filter(g => g.whatsappEnviado);

  // Ordena: sem boleto primeiro, depois por nome
  grupos.sort((a, b) => {
    if(a.boletoGerado !== b.boletoGerado) return a.boletoGerado ? 1 : -1;
    return (a.responsavel || '').localeCompare(b.responsavel || '');
  });

  // Totais para resumo e badge
  const totalResponsaveis = Object.keys(mapa).length;
  let totalComBoleto = 0, totalAguardando = 0;

  Object.values(mapa).forEach(g => {
    const cli = clientes.find(c => c.nome === g.responsavel);
    const cob = cli ? cobrancas.find(c =>
      Number(c.responsavel_id) === Number(cli.id) && c.referencia === referencia
    ) : null;
    if(cob && cob.link_boleto){
      totalComBoleto++;
      if(!Number(cob.whatsapp_enviado)) totalAguardando++;
    }
  });

  // Badge
  const badge = document.getElementById('centralCobrancasBadge');
  if(badge) badge.textContent = totalAguardando > 0 ? totalAguardando : '';

  // Resumo
  const mesesNomes = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesNome = mesesNomes[mesRef] || mesRef;

  const resumoEl = document.getElementById('centralResumo');
  if(resumoEl){
    resumoEl.innerHTML =
      '<div class="central-resumo-item">' +
        '<i class="fa-solid fa-users"></i><span>' + totalResponsaveis + ' responsáveis</span>' +
      '</div>' +
      '<div class="central-resumo-item">' +
        '<i class="fa-solid fa-barcode"></i><span>' + totalComBoleto + ' com boleto</span>' +
      '</div>' +
      '<div class="central-resumo-item ' + (totalAguardando > 0 ? 'resumo-alerta' : 'resumo-ok') + '">' +
        '<i class="fa-solid fa-' + (totalAguardando > 0 ? 'clock' : 'check-circle') + '"></i>' +
        '<span>' + (totalAguardando > 0 ? totalAguardando + ' aguardando envio' : 'Todos enviados') + '</span>' +
      '</div>' +
      '<div class="central-resumo-ref">' +
        '<i class="fa-solid fa-calendar"></i> ' + mesNome + ' ' + anoRef +
      '</div>';
  }

  if(grupos.length === 0){
    container.innerHTML =
      '<div class="central-vazia">' +
        '<i class="fa-solid fa-circle-check"></i>' +
        '<p>Nenhum responsável encontrado para os filtros selecionados.</p>' +
      '</div>';
    return;
  }

  container.innerHTML = '';

  grupos.forEach(grupo => {

    const { cliente, cobranca, boletoGerado, whatsappEnviado, statusPagamento } = grupo;

    const nomeAlunos = grupo.alunos.map(a => censurarNome(a.nome)).join(', ') || '-';
    const telefone = cliente ? censurarTelefone(cliente.telefone) : '-';
    const totalFmt = censurarValor(grupo.total);
    const nomeResp = grupo.responsavel.replace(/\\/g,'\\\\').replace(/'/g, "\\'");

    const cardClass =
      !boletoGerado  ? 'central-card cc-sem-boleto' :
      whatsappEnviado ? 'central-card cc-enviado'  :
                        'central-card cc-pendente';

    const badgeEnvio =
      !boletoGerado
        ? '<span class="cc-badge cc-badge-sem-boleto"><i class="fa-solid fa-minus"></i> Sem boleto</span>'
        : whatsappEnviado
          ? '<span class="cc-badge cc-badge-enviado"><i class="fa-solid fa-check-circle"></i> Enviado</span>'
          : '<span class="cc-badge cc-badge-aguardando"><i class="fa-solid fa-clock"></i> Aguardando</span>';

    const infoBoleto = boletoGerado && cobranca
      ? '<div class="cc-boleto-info">' +
          (cobranca.linha_digitavel
            ? '<div class="cc-linha-digitavel"><span>Linha digitável</span><small>' + cobranca.linha_digitavel + '</small></div>'
            : '') +
          '<div class="cc-origem">' +
            (cobranca.origem === 'manual' ? '📎 Importado manualmente' : '📄 Boleto') +
          '</div>' +
        '</div>'
      : '';

    let acoesHtml = '';

    if(boletoGerado && cobranca){

      acoesHtml +=
        '<button onclick="window.open(\'' + cobranca.link_boleto + '\', \'_blank\')">' +
          '<i class="fa-solid fa-file-invoice"></i> Abrir Boleto' +
        '</button>' +
        '<button onclick="copiarMensagemCentralCobranca(' + cobranca.id + ')">' +
          '<i class="fa-solid fa-copy"></i> Copiar Mensagem' +
        '</button>' +
        '<button class="btn-whatsapp" onclick="abrirWhatsappCentralCobranca(' + cobranca.id + ')">' +
          '<i class="fa-brands fa-whatsapp"></i> WhatsApp' +
        '</button>';

      if(!whatsappEnviado){
        acoesHtml +=
          '<button class="btn-marcar-enviado" onclick="marcarCobrancaEnviada(' + cobranca.id + ', this)">' +
            '<i class="fa-solid fa-check"></i> Marcar como enviado' +
          '</button>';
      } else {
        acoesHtml +=
          '<button class="btn-desfazer-enviado" onclick="desfazerCobrancaEnviada(' + cobranca.id + ', this)">' +
            '<i class="fa-solid fa-rotate-left"></i> Desfazer envio' +
          '</button>';
      }

      acoesHtml +=
        '<button class="btn-remover-boleto" onclick="removerBoletoResponsavel(\'' + nomeResp + '\')">' +
          '<i class="fa-solid fa-trash"></i> Remover Boleto' +
        '</button>';

    } else {

      acoesHtml +=
        '<button onclick="mostrarDadosBoletoResponsavel(\'' + nomeResp + '\')">' +
          '<i class="fa-solid fa-info-circle"></i> Ver dados' +
        '</button>' +
        '<button class="btn-gerar-boleto" onclick="abrirImportacaoManual(\'' + nomeResp + '\')">' +
          '<i class="fa-solid fa-upload"></i> Importar Boleto' +
        '</button>';

    }

    container.innerHTML +=
      '<div class="' + cardClass + '">' +
        '<div class="cc-topo">' +
          '<div class="cc-nome-tel">' +
            '<h3>' + censurarNome(grupo.responsavel) + '</h3>' +
            '<p><i class="fa-solid fa-phone"></i> ' + telefone + '</p>' +
          '</div>' +
          badgeEnvio +
        '</div>' +
        '<div class="cc-info">' +
          '<div class="cc-info-item"><span>Aluno(s)</span><strong>' + nomeAlunos + '</strong></div>' +
          '<div class="cc-info-item"><span>Total</span><strong>' + totalFmt + '</strong></div>' +
          '<div class="cc-info-item"><span>Mensalidade</span><span class="status ' + statusPagamento + '">' + statusPagamento + '</span></div>' +
        '</div>' +
        infoBoleto +
        '<div class="cc-acoes">' + acoesHtml + '</div>' +
      '</div>';

  });

}
