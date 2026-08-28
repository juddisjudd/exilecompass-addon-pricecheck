export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * The panel runs in a sandboxed iframe with an opaque origin, so the host's
 * theme tokens don't reach it — only the handful the bootstrap document
 * defines. Anything else has to be a literal.
 */
export const CSS = `
  .pc { display:flex; flex-direction:column; height:100%; gap:6px; font-size:11px; }
  .pc-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex:0 0 auto; }
  .pc select, .pc input, .pc button, .pc textarea { font:inherit; color:var(--c-primary);
    background:#121214; border:1px solid rgba(167,154,133,.34); padding:3px 6px; }
  .pc button { cursor:pointer; }
  .pc button:hover:not(:disabled) { border-color:rgba(237,230,213,.5); }
  .pc button:disabled { opacity:.4; cursor:default; }
  .pc-primary { background:#960018; border-color:#960018; color:#ede6d5; font-weight:600; }
  .pc-primary:hover:not(:disabled) { background:#b3001d; border-color:#b3001d; }
  .pc-toggle { display:flex; }
  .pc-toggle button { border-right-width:0; font-size:10px; font-weight:600; letter-spacing:.04em; }
  .pc-toggle button:last-child { border-right-width:1px; }
  .pc-toggle button.on { background:rgba(237,230,213,.16); border-color:rgba(237,230,213,.5); }
  .pc-status { margin-left:auto; font-size:10px; color:var(--c-accent); }
  .pc-error { color:#e2333c; font-size:10.5px; flex:0 0 auto; }
  .pc-warn { color:#d9a441; font-size:10.5px; flex:0 0 auto; }
  .pc-paste { width:100%; box-sizing:border-box; min-height:64px; resize:vertical;
    font:10.5px/1.4 "JetBrains Mono",Consolas,monospace; }
  .pc-scroll { flex:1 1 auto; min-height:0; overflow-y:auto;
    border:1px solid rgba(167,154,133,.18); }
  .pc-head { display:flex; align-items:baseline; gap:6px; flex:0 0 auto; }
  .pc-name { font-weight:700; }
  .pc-sub { color:var(--c-accent); font-size:10px; }
  .pc-section { font-size:9.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
    color:var(--c-accent); padding:5px 6px 3px; }
  .pc-filter { display:grid; grid-template-columns:16px minmax(0,1fr) 54px 54px; gap:5px;
    align-items:center; padding:2px 6px; border-bottom:1px solid rgba(167,154,133,.1); }
  .pc-filter:hover { background:rgba(167,154,133,.07); }
  .pc-filter input[type=number] { width:100%; box-sizing:border-box; padding:1px 3px;
    font-variant-numeric:tabular-nums; }
  .pc-filter input[type=checkbox] { margin:0; }
  .pc-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pc-tier { color:var(--c-accent); font-size:9.5px; margin-left:4px; }
  .pc-result { display:grid; grid-template-columns:28px minmax(0,1fr) auto auto; gap:6px;
    align-items:center; padding:4px 6px; border-bottom:1px solid rgba(167,154,133,.1); }
  .pc-result:hover { background:rgba(167,154,133,.07); }
  .pc-result img { width:28px; height:28px; object-fit:contain; }
  .pc-price { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; }
  .pc-seller { color:var(--c-accent); font-size:10px; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; }
  .pc-copy { padding:1px 5px; font-size:10px; }
  .pc-empty { padding:10px 6px; color:var(--c-accent); font-style:italic; }
  .pc-foot { flex:0 0 auto; font-size:9.5px; color:var(--c-accent);
    display:flex; justify-content:space-between; gap:6px; }
  .pc-link { background:none; border:none; padding:0; color:var(--c-primary);
    text-decoration:underline; cursor:pointer; font-size:10px; }
`;

/**
 * The panel's opaque origin blocks the async clipboard API, and the host's own
 * `clipboard.write` bridge is not in this ExileCompass yet, so the whisper is
 * copied the old way — which still works from inside a user gesture.
 */
export function copyText(text: string): boolean {
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.append(scratch);
  scratch.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  scratch.remove();
  return ok;
}
