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
  .pc-status { margin-left:auto; font-size:10.5px; color:var(--c-accent); }
  .pc-error { color:#e2333c; font-size:10.5px; flex:0 0 auto; }
  .pc-warn { color:#d9a441; font-size:10.5px; flex:0 0 auto; }
  .pc-link { background:none; border:none; padding:0; color:var(--c-accent);
    text-decoration:underline; cursor:pointer; font-size:10px; }
  .pc-link:hover { color:var(--c-primary); }

  /* ── input ───────────────────────────────────────────────────────────── */
  .pc-paste { width:100%; box-sizing:border-box; height:26px; min-height:26px; resize:none;
    overflow:hidden; white-space:nowrap; font:11px/1.35 system-ui,sans-serif;
    border-style:dashed; cursor:text; }
  .pc-paste:focus { border-style:solid; border-color:rgba(237,230,213,.5); outline:none; }
  .pc-paste::placeholder { color:var(--c-accent); }
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
  .pc-filters { flex:1 1 auto; display:flex; flex-direction:column; min-height:0; }
  .pc-filters-head { display:flex; align-items:center; gap:6px; }
  .pc .pc-filters-title { display:flex; align-items:center; gap:6px; width:100%;
    background:rgba(167,154,133,.07); border:1px solid rgba(167,154,133,.22);
    padding:3px 7px; font-size:10px; font-weight:700; letter-spacing:.07em;
    text-transform:uppercase; color:var(--c-accent); cursor:pointer; text-align:left; }
  .pc .pc-filters-title:hover { color:var(--c-primary); border-color:rgba(237,230,213,.4);
    background:rgba(167,154,133,.13); }
  .pc-caret { display:inline-block; transition:transform .12s ease; font-size:9px; }
  .pc-filters-title.open .pc-caret { transform:rotate(90deg); }
  .pc-filters-count { margin-left:auto; font-size:10px; font-weight:400; letter-spacing:0;
    text-transform:none; color:var(--c-accent); }
  .pc-filter-list { flex:1 1 auto; min-height:0; overflow-y:auto;
    border:1px solid rgba(167,154,133,.18); }
  .pc-section { font-size:9.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
    color:var(--c-accent); padding:5px 6px 3px; }
  .pc-filter { display:grid; grid-template-columns:15px minmax(0,1fr) 30px 44px 44px; gap:4px;
    align-items:center; padding:2px 6px; border-bottom:1px solid rgba(167,154,133,.1); }
  .pc-filter:hover { background:rgba(167,154,133,.07); }
  .pc-filter input[type=number] { width:100%; box-sizing:border-box; padding:1px 3px;
    font-variant-numeric:tabular-nums; }
  .pc-filter input[type=checkbox] { margin:0; }
  .pc-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pc-tier { color:var(--c-accent); font-size:9.5px; margin-left:4px; }

  /* ── two panes ───────────────────────────────────────────────────────── */
  .pc-panes { flex:1 1 auto; min-height:0; display:grid;
    grid-template-columns:312px minmax(0,1fr); gap:8px; }
  .pc-side { min-height:0; display:flex; flex-direction:column; gap:6px;
    border-right:1px solid rgba(167,154,133,.18); padding-right:8px; }
  .pc-search-wrap { margin-top:auto; flex:0 0 auto; display:flex; flex-direction:column; gap:5px; }
  .pc-search-controls { display:flex; align-items:center; gap:5px; }
  .pc-search-controls select { flex:1 1 auto; min-width:0; }
  .pc-search { width:100%; padding:6px; font-size:12px; letter-spacing:.04em; }
  @media (max-width: 720px) {
    .pc-panes { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }
    .pc-side { border-right:none; padding-right:0;
      border-bottom:1px solid rgba(167,154,133,.18); padding-bottom:6px; }
  }

  /* ── results ─────────────────────────────────────────────────────────── */
  .pc-results { min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:6px; }
  .pc-results-head { position:sticky; top:0; z-index:1; background:var(--c-bg,#0b0a08);
    display:flex; align-items:center; gap:8px; padding:2px 0 4px;
    border-bottom:1px solid rgba(167,154,133,.18); }
  .pc-count { font-size:10px; color:var(--c-accent); }
  .pc-sorts { margin-left:auto; display:flex; gap:3px; }
  .pc .pc-sort { background:none; border:1px solid transparent; padding:2px 6px;
    min-width:58px; text-align:center;
    font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
    color:var(--c-accent); cursor:pointer; }
  .pc .pc-sort:hover { color:var(--c-primary); border-color:rgba(167,154,133,.3); }
  .pc .pc-sort.on { color:var(--c-primary); border-color:rgba(237,230,213,.45);
    background:rgba(167,154,133,.14); }

  .pc-cards { display:flex; flex-direction:column; gap:5px; padding-bottom:4px; }
  .pc-card { border:1px solid rgba(167,154,133,.2); background:rgba(167,154,133,.04); }
  .pc-card:hover { border-color:rgba(167,154,133,.34); }
  .pc-card-body { display:grid; grid-template-columns:minmax(0,1fr) 132px; }
  .pc-card-item { padding:6px 8px; min-width:0; }
  .pc-card-side { padding:6px 8px; display:flex; flex-direction:column; align-items:flex-end;
    gap:1px; border-left:1px solid rgba(167,154,133,.14); text-align:right; }
  .pc-price { display:flex; align-items:center; gap:4px; font-weight:700; font-size:15px;
    font-variant-numeric:tabular-nums; color:var(--c-primary); }
  .pc-cur { width:19px; height:19px; object-fit:contain; }
  .pc-cur-text { font-size:10px; font-weight:400; color:var(--c-accent); }
  .pc-norm { font-size:11px; color:var(--c-accent); font-variant-numeric:tabular-nums; }
  .pc-card-seller { font-size:11px; color:var(--c-accent); max-width:100%;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
  .pc-card-age { font-size:10.5px; color:var(--c-accent); opacity:.8; }
  .pc-card-icon { width:34px; height:34px; object-fit:contain; margin-top:3px; }
  .pc-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; }
  .pc-dot.online { background:#5fa372; }
  .pc-dot.afk { background:#d9a441; }
  .pc-dot.offline { background:#4a4438; }
  .pc-empty { padding:10px 6px; color:var(--c-accent); font-style:italic; }

  /* ── the item inside a card ──────────────────────────────────────────── */
  .pc-detail-head { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; }
  .pc-detail-facts { color:var(--c-accent); font-size:10px; margin-top:2px; }
  .pc-mods { display:flex; flex-direction:column; gap:1px; margin-top:4px;
    border-top:1px solid rgba(167,154,133,.14); padding-top:4px; }
  .pc-mod { display:flex; align-items:baseline; gap:5px; }
  .pc-mod-text { color:#8c9ce6; min-width:0; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; }
  .pc-mod.implicit .pc-mod-text, .pc-mod.enchant .pc-mod-text { color:#9bc8bd; }
  .pc-mod.rune .pc-mod-text { color:#c1a87a; }
  /* Tiers sit in a fixed gutter so they line up into a scannable column. */
  .pc-affix { flex:0 0 22px; font-size:9.5px; font-weight:700; letter-spacing:.02em;
    font-variant-numeric:tabular-nums; }
  .pc-affix.prefix { color:#ec7676; }
  .pc-affix.suffix { color:#7aaff1; }
  /* Scrollbars, kept out of the way. WebView2 is Chromium, so the ::-webkit
     rules are the ones that apply; scrollbar-width is there for anything else.
     Not hidden outright — a list that scrolls with no sign it scrolls is worse
     than a thin bar. */
  .pc-results, .pc-filter-list, .pc-paste {
    scrollbar-width: thin;
    scrollbar-color: rgba(167,154,133,.3) transparent;
  }
  .pc-results::-webkit-scrollbar,
  .pc-filter-list::-webkit-scrollbar { width:6px; height:6px; }
  .pc-results::-webkit-scrollbar-track,
  .pc-filter-list::-webkit-scrollbar-track { background:transparent; }
  .pc-results::-webkit-scrollbar-thumb,
  .pc-filter-list::-webkit-scrollbar-thumb {
    background:rgba(167,154,133,.25); border-radius:3px;
  }
  .pc-results:hover::-webkit-scrollbar-thumb,
  .pc-filter-list:hover::-webkit-scrollbar-thumb { background:rgba(167,154,133,.45); }
  .pc-results::-webkit-scrollbar-corner,
  .pc-filter-list::-webkit-scrollbar-corner { background:transparent; }

  .pc .pc-compare { padding:1px 0; text-align:center; font-size:12px; line-height:1.1;
    color:var(--c-accent); background:#121214; cursor:pointer; }
  .pc .pc-compare:hover { color:var(--c-primary); border-color:rgba(237,230,213,.5); }
  .pc-mod-kind { flex:0 0 auto; font-size:9px; letter-spacing:.05em; text-transform:uppercase;
    color:var(--c-accent); opacity:.85; border:1px solid rgba(167,154,133,.28); padding:0 3px; }
  .pc-mod.desecrated .pc-mod-text { color:#c78ee0; }
  .pc-mod.crafted .pc-mod-text { color:#b8daf5; }
  .pc-mod.fractured .pc-mod-text { color:#c2a875; }
  .pc-mod.mutated .pc-mod-text { color:#e0a06a; }
  .pc-mod-range { margin-left:auto; flex:0 0 auto; color:var(--c-accent); font-size:9.5px;
    font-variant-numeric:tabular-nums; opacity:.75; }

  .pc-foot { flex:0 0 auto; font-size:9.5px; color:var(--c-accent);
    display:flex; justify-content:space-between; gap:8px; align-items:center; }
  .pc-foot-league { display:flex; align-items:center; gap:6px; }
  .pc-limit { font-variant-numeric:tabular-nums; }
`;

