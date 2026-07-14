/* =========================================================
   Tempo real (Socket.IO) — instancia + eventos de dominio
   ========================================================= */
let io = null;

function init(ioInstance) {
  io = ioInstance;
}

function getIO() {
  return io;
}

// Avisa os clientes que um recurso mudou. O frontend recarrega SOMENTE esse recurso
// (se `recurso` vier vazio, o cliente faz o recarregamento completo, como antes).
// Ex.: atualizarSistema('clientes') | atualizarSistema('financeiro')
function atualizarSistema(recurso = null) {
  if (io) {
    io.emit('atualizarSistema', { recurso, timestamp: Date.now() });
  }
}

module.exports = { init, getIO, atualizarSistema };
