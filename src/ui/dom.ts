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
 *
 * Layout rule for this panel: the listings own the vertical space. Everything
 * above them (input, item, filters) collapses to a line once it has served its
 * purpose, because the answer to "what is this worth" is the prices, not the
 * item you already have in your hand.
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
  .pc-link { background:none; border:none; padding:0; color:var(--c-accent);
    text-decoration:underline; cursor:pointer; font-size:10px; }
  .pc-link:hover { color:var(--c-primary); }

  /* ── input ───────────────────────────────────────────────────────────── */
  .pc-paste { width:100%; box-sizing:border-box; min-height:90px; resize:vertical;
    font:10.5px/1.4 "JetBrains Mono",Consolas,monospace; }
  .pc-hint { font-size:10px; color:var(--c-accent); }

  /* ── item header ─────────────────────────────────────────────────────── */
  .pc-item { flex:0 0 auto; display:flex; flex-direction:column; gap:4px;
    padding:5px 7px; border:1px solid rgba(167,154,133,.22); background:rgba(167,154,133,.05); }
  .pc-item-top { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .pc-item-name { font-weight:700; font-size:12px; color:var(--c-primary); }
  .pc-item-name.rare { color:#e6d96a; }
  .pc-item-name.unique { color:#c1734a; }
  .pc-item-name.magic { color:#8c9ce6; }
  .pc-item-name.currency, .pc-item-name.gem { color:#9bc8bd; }
  .pc-item-base, .pc-item-class { color:var(--c-accent); font-size:10.5px; }
  .pc-item-class { opacity:.75; }
  .pc-item-top .pc-link { margin-left:auto; }
  .pc-flag { font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; color:#e2333c;
    border:1px solid rgba(226,51,60,.45); padding:0 4px; }
  .pc-chips { display:flex; flex-wrap:wrap; gap:4px; }
  .pc-chip { font-size:10px; color:var(--c-primary); background:rgba(167,154,133,.1);
    border:1px solid rgba(167,154,133,.2); padding:1px 5px; font-variant-numeric:tabular-nums; }
  .pc-chip-label { color:var(--c-accent); margin-right:3px; }

  /* ── filters ─────────────────────────────────────────────────────────── */
  .pc-filters { flex:0 0 auto; display:flex; flex-direction:column; min-height:0; }
  .pc-filters-head { display:flex; align-items:center; gap:6px; padding:3px 0; }
  .pc-filters-title { font-size:10px; font-weight:700; letter-spacing:.07em;
    text-transform:uppercase; color:var(--c-accent); background:none; border:none; padding:0;
    cursor:pointer; }
  .pc-filters-title:hover { color:var(--c-primary); }
  .pc-filters-count { font-size:10px; color:var(--c-accent); }
  .pc-filter-list { max-height:190px; overflow-y:auto; border:1px solid rgba(167,154,133,.18); }
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

  /* ── listings ────────────────────────────────────────────────────────── */
  .pc-results { flex:1 1 auto; min-height:0; overflow-y:auto;
    border:1px solid rgba(167,154,133,.18); }
  .pc-table { display:flex; flex-direction:column; }
  .pc-thead, .pc-tr { display:grid; grid-template-columns:var(--tracks); gap:6px;
    align-items:center; padding:3px 7px; }
  .pc-thead { position:sticky; top:0; z-index:1; background:#0e0d0c;
    border-bottom:1px solid rgba(167,154,133,.24); }
  .pc-th { font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
    color:var(--c-accent); background:none; border:none; padding:0; text-align:left; }
  .pc-th.sortable { cursor:pointer; }
  .pc-th.sortable:hover { color:var(--c-primary); }
  .pc-th.on { color:var(--c-primary); }
  .pc-th.right { text-align:right; }
  .pc-tr { border-bottom:1px solid rgba(167,154,133,.1); min-height:26px; }
  .pc-tr:hover { background:rgba(167,154,133,.07); }
  .pc-icon { width:24px; height:24px; object-fit:contain; }
  .pc-td { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pc-td.right { text-align:right; font-variant-numeric:tabular-nums; color:var(--c-accent); }
  .pc-td.price { font-weight:600; font-variant-numeric:tabular-nums;
    display:flex; align-items:center; gap:3px; }
  .pc-cur { width:15px; height:15px; object-fit:contain; flex:0 0 auto; }
  .pc-cur-text { color:var(--c-accent); font-weight:400; font-size:10px; }
  .pc-norm { color:var(--c-accent); font-weight:400; font-size:10px; }
  .pc-td.listed { color:var(--c-accent); font-variant-numeric:tabular-nums; }
  .pc-td.seller { color:var(--c-accent); }
  .pc-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px;
    vertical-align:baseline; }
  .pc-dot.online { background:#5fa372; }
  .pc-dot.afk { background:#d9a441; }
  .pc-dot.offline { background:#4a4438; }
  .pc-copy { padding:1px 5px; font-size:10px; }
  .pc-empty { padding:10px 6px; color:var(--c-accent); font-style:italic; }

  .pc-foot { flex:0 0 auto; font-size:9.5px; color:var(--c-accent);
    display:flex; justify-content:space-between; gap:6px; align-items:center; }
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
