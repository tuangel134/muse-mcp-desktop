// Conecta el panel con el proceso principal: abrir/cerrar y montar el gestor de Master MCP.
(() => {
  const body = document.body;
  const wrap = document.getElementById('wrap');
  let cleanup = null;
  const apply = (open) => {
    body.classList.toggle('collapsed', !open);
    wrap.hidden = !open;
    if (open && !cleanup) cleanup = window.mountMasterMcp(document.getElementById('root'));
    if (!open && cleanup) { try { cleanup(); } catch {} cleanup = null; document.getElementById('root').replaceChildren(); }
  };
  document.getElementById('rail').addEventListener('click', () => window.museMcp.togglePanel());
  document.getElementById('close').addEventListener('click', () => window.museMcp.togglePanel());
  window.museMcp.onPanelState(apply);
  window.museMcp.info().then((i) => { document.getElementById('ver').textContent = 'v' + i.version; }).catch(() => {});
  apply(false);
})();
