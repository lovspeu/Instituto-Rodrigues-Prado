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

// Evento generico de atualizacao (sera substituido por eventos por dominio na Fase 7)
function atualizarSistema() {
  if (io) {
    io.emit('atualizarSistema', { timestamp: Date.now() });
  }
}

module.exports = { init, getIO, atualizarSistema };
