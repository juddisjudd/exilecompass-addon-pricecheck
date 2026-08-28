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

  /* A real table, fixed layout: the header and the body share one set of
     column widths, so nothing can drift out of alignment. */
  .pc-table { width:100%; border-collapse:collapse; table-layout:fixed; }
  .pc-table th, .pc-table td { padding:3px 6px; text-align:left; vertical-align:middle;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pc-table th.right, .pc-table td.right { text-align:right; }
  .pc-table th { position:sticky; top:0; z-index:1; background:#0e0d0c; padding:0;
    border-bottom:1px solid rgba(167,154,133,.24); font-size:9.5px; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase; color:var(--c-accent); }
  .pc-table th:not(.right) { padding:4px 6px; }

  /* Header buttons fill their cell and carry no chrome of their own — they are
     column labels, not controls sitting inside one. Needs to out-specify the
     panel-wide .pc button rule. */
  .pc .pc-sort { display:block; width:100%; background:none; border:none;
    padding:4px 6px; font:inherit; color:inherit; text-align:inherit; cursor:pointer;
    text-transform:inherit; letter-spacing:inherit; }
  .pc .pc-sort:hover { color:var(--c-primary); background:rgba(167,154,133,.1); }
  .pc .pc-sort.on { color:var(--c-primary); }
  .pc-table th.right .pc-sort { text-align:right; }

  .pc-tr { border-bottom:1px solid rgba(167,154,133,.1); }
  .pc-tr:hover { background:rgba(167,154,133,.07); }
  .pc-table td.summary { color:var(--c-primary); }
  .pc-table td.seller { color:var(--c-accent); }
  .pc-table td.right { font-variant-numeric:tabular-nums; color:var(--c-accent); }
  .pc-table td.listed { color:var(--c-accent); }
  .pc-table td.price { color:var(--c-primary); font-weight:600; }
  .pc .pc-item-btn { display:block; padding:1px; border:1px solid transparent; background:none;
    line-height:0; border-radius:2px; cursor:pointer; }
  .pc .pc-item-btn:hover, .pc .pc-item-btn.on { border-color:rgba(237,230,213,.5);
    background:rgba(167,154,133,.14); }
  .pc-icon { width:22px; height:22px; object-fit:contain; }
  .pc-amount { margin-left:3px; }
  .pc-cur { width:14px; height:14px; object-fit:contain; vertical-align:-3px; margin-left:2px; }
  .pc-cur-text { color:var(--c-accent); font-weight:400; font-size:10px; margin-left:2px; }
  .pc-norm { color:var(--c-accent); font-weight:400; font-size:10px; }
  .pc-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; }
  .pc-dot.online { background:#5fa372; }
  .pc-dot.afk { background:#d9a441; }
  .pc-dot.offline { background:#4a4438; }
  .pc-empty { padding:10px 6px; color:var(--c-accent); font-style:italic; }

  /* ── expanded item ───────────────────────────────────────────────────── */
  .pc-detail-row { border-bottom:1px solid rgba(167,154,133,.1); }
  .pc-detail-row > td { padding:6px 9px 8px 36px; background:rgba(167,154,133,.05);
    white-space:normal; }
  .pc-detail-head { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap;
    margin-bottom:3px; }
  .pc-detail-facts { color:var(--c-accent); font-size:10px; margin-bottom:3px; max-width:720px; }
  /* Capped to a readable measure: right-aligned tier and range are only
     useful if they stay near the mod they belong to. */
  .pc-mods { max-width:720px; display:flex; flex-direction:column; gap:1px;
    border-top:1px solid rgba(167,154,133,.14); padding-top:3px; margin-top:3px; }
  .pc-mod { display:flex; align-items:baseline; gap:6px; }
  .pc-mod-text { color:#8c9ce6; }
  .pc-mod.implicit .pc-mod-text, .pc-mod.enchant .pc-mod-text { color:#9bc8bd; }
  .pc-mod.rune .pc-mod-text { color:#c1a87a; }
  .pc-mod-meta { margin-left:auto; display:flex; gap:6px; flex:0 0 auto; }
  .pc-mod-affix { color:var(--c-accent); font-size:9.5px; }
  .pc-mod-range { color:var(--c-accent); font-size:9.5px; font-variant-numeric:tabular-nums;
    opacity:.8; }

  .pc-foot { flex:0 0 auto; font-size:9.5px; color:var(--c-accent);
    display:flex; justify-content:space-between; gap:6px; align-items:center; }
`;

