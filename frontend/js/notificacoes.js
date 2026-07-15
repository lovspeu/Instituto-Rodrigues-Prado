/* =========================================================
   Componente central de notificações (toasts)
   Substitui os alert() por avisos estilizados, não bloqueantes.
   Carregado ANTES do app.js — expõe window.toast(mensagem, tipo).
   ========================================================= */
(function () {

  // Injeta o CSS uma única vez (auto-contido, tema navy + dourado do Instituto)
  const css = `
  #irp-toasts{
    position:fixed; top:18px; right:18px; z-index:99999;
    display:flex; flex-direction:column; gap:10px;
    max-width:min(92vw, 380px); pointer-events:none;
  }
  .irp-toast{
    pointer-events:auto; cursor:pointer;
    display:flex; align-items:flex-start; gap:10px;
    padding:13px 15px; border-radius:12px;
    background:#0b1220; color:#f3f4f6;
    border:1px solid rgba(255,255,255,.08);
    border-left:4px solid #d4af37;
    box-shadow:0 10px 30px rgba(0,0,0,.35);
    font-size:14px; line-height:1.4; word-break:break-word;
    opacity:0; transform:translateX(24px);
    transition:opacity .25s ease, transform .25s ease;
  }
  .irp-toast.mostrar{ opacity:1; transform:translateX(0); }
  .irp-toast .irp-toast-ic{ flex:0 0 auto; margin-top:1px; font-size:16px; }
  .irp-toast-sucesso{ border-left-color:#22c55e; }
  .irp-toast-sucesso .irp-toast-ic{ color:#22c55e; }
  .irp-toast-erro{ border-left-color:#ef4444; }
  .irp-toast-erro .irp-toast-ic{ color:#ef4444; }
  .irp-toast-info{ border-left-color:#d4af37; }
  .irp-toast-info .irp-toast-ic{ color:#f5d76e; }
  @media (prefers-reduced-motion: reduce){
    .irp-toast{ transition:opacity .01s; transform:none; }
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  let container = null;
  function obterContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.id = 'irp-toasts';
    document.body.appendChild(container);
    return container;
  }

  const ICONES = {
    sucesso: '✓',   // check
    erro: '⚠',      // triangulo de alerta
    info: 'ℹ'       // i
  };

  // Deduz o tipo pela mensagem quando nao e informado (mantem cores coerentes
  // sem precisar tocar em cada chamada antiga de alert()).
  function deduzirTipo(mensagem) {
    const m = String(mensagem || '').toLowerCase();
    if (/erro|inválid|invalid|falh|não\s|nao\s|incorret|obrigat/.test(m)) return 'erro';
    if (/sucesso|salv|cadastrad|atualizad|removid|conclu|realizad/.test(m)) return 'sucesso';
    return 'info';
  }

  window.toast = function (mensagem, tipo, duracao) {
    try {
      tipo = tipo || deduzirTipo(mensagem);
      duracao = duracao || (tipo === 'erro' ? 6000 : 4000);

      const el = document.createElement('div');
      el.className = 'irp-toast irp-toast-' + tipo;
      el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

      const ic = document.createElement('span');
      ic.className = 'irp-toast-ic';
      ic.textContent = ICONES[tipo] || ICONES.info;

      const txt = document.createElement('div');
      txt.textContent = String(mensagem); // textContent = sem injeção de HTML

      el.appendChild(ic);
      el.appendChild(txt);
      obterContainer().appendChild(el);

      requestAnimationFrame(() => el.classList.add('mostrar'));

      const remover = () => {
        el.classList.remove('mostrar');
        setTimeout(() => el.remove(), 300);
      };
      const timer = setTimeout(remover, duracao);
      el.addEventListener('click', () => { clearTimeout(timer); remover(); });

      return el;
    } catch (e) {
      // fallback ultra seguro
      console.log('[toast]', mensagem);
    }
  };

})();
