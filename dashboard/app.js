/* Token Radar's dark scatter dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
   and renders the LAD-fit radar: a header with a stats strip, a top-10 spotlight, a log-log scatter of
   TVL vs implied value with the fitted line and p25/p75 band, a sortable board table with filters, a
   per-protocol detail view, a Comps view of the tokenized comparables, and a methodology panel. No
   network: every byte it shows is in data.js. */
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', band: 'all', watchlistOnly: false, sort: 'implied', dir: -1, view: 'board', selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function bandOf(r) {
    var width = r.high_value_usd / Math.max(1, r.low_value_usd);
    if (width < 8) return 'narrow';
    if (width < 16) return 'medium';
    return 'wide';
  }
  var WL = new Set(DATA.watchlist || []);

  var MODEL = DATA.model;
  function catOffset(r) { return MODEL.categoryOffsets[r.category] || 0; }
  function fittedLog(r) { return MODEL.intercept + MODEL.slope * Math.log(Math.max(r.tvl_usd, 1)) + catOffset(r); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- SVG scatter: log-log TVL (x) vs implied (y), with the LAD line and the p25/p75 band shaded. ----
  function scatter() {
    var W = 900, H = 420, P = { l: 58, r: 20, t: 20, b: 46 };
    var iw = W - P.l - P.r, ih = H - P.t - P.b;
    var minX = Math.log(1e6), maxX = Math.log(2e10);
    var impliedVals = DATA.rows.map(function (r) { return Math.log(r.implied_value_usd); });
    var minY = Math.log(1e5), maxY = Math.log(3e9);
    DATA.rows.forEach(function (r) {
      var ly = Math.log(r.low_value_usd);
      var hy = Math.log(r.high_value_usd);
      if (ly < minY) minY = ly;
      if (hy > maxY) maxY = hy;
    });
    if (DATA.comps && DATA.comps.length) DATA.comps.forEach(function (c) {
      var cx = Math.log(c.tvl_usd);
      var cy = Math.log(c.mcap_usd);
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    });
    var X = function (v) { return P.l + (Math.log(v) - minX) / (maxX - minX) * iw; };
    var Y = function (v) { return P.t + ih - (Math.log(v) - minY) / (maxY - minY) * ih; };
    var svgNS = 'http' + '://www.w3.org/2000/svg';
    function node(tag, attrs) {
      var n = document.createElementNS(svgNS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    var svg = node('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Log-log scatter of TVL against implied value with the fitted line and band' });
    svg.appendChild(node('defs', { id: 'radial' }));
    // grid lines + axes
    for (var g = 7; g <= 10; g++) {
      var gv = Math.pow(10, g);
      svg.appendChild(node('line', { x1: X(gv), y1: P.t, x2: X(gv), y2: H - P.b, stroke: '#262c37', 'stroke-width': 1 }));
      svg.appendChild(node('text', { x: X(gv), y: H - P.b + 20, fill: '#8b93a3', 'font-size': 11, 'text-anchor': 'middle', 'font-family': 'monospace' })).textContent = '$' + (g >= 9 ? (gv / 1e9) + 'B' : (gv / 1e6) + 'M');
    }
    for (var k = 7; k <= 9; k++) {
      var kv = Math.pow(10, k);
      svg.appendChild(node('line', { x1: P.l, y1: Y(kv), x2: W - P.r, y2: Y(kv), stroke: '#262c37', 'stroke-width': 1 }));
      svg.appendChild(node('text', { x: P.l - 6, y: Y(kv) + 4, fill: '#8b93a3', 'font-size': 11, 'text-anchor': 'end', 'font-family': 'monospace' })).textContent = (kv >= 1e9 ? '$' + (kv / 1e9) + 'B' : kv >= 1e6 ? '$' + (kv / 1e6) + 'M' : '$' + (kv / 1e3) + 'K');
    }
    // p25/p75 band around the fitted line
    var m = DATA.model;
    function fittedY(tvl) { return Math.exp(m.intercept + m.slope * Math.log(tvl) + (m.categoryOffsets.Dexs || 0)); }
    var bandLo = Math.exp(Math.log(fittedY(1e6)) + m.residualP25);
    var bandHi = Math.exp(Math.log(fittedY(1e6)) + m.residualP75);
    var bandLo2 = Math.exp(Math.log(fittedY(2e10)) + m.residualP25);
    var bandHi2 = Math.exp(Math.log(fittedY(2e10)) + m.residualP75);
    svg.appendChild(node('polygon', {
      points: X(1e6) + ',' + Y(bandLo) + ' ' + X(2e10) + ',' + Y(bandLo2) + ' ' + X(2e10) + ',' + Y(bandHi2) + ' ' + X(1e6) + ',' + Y(bandHi),
      fill: 'rgba(232,163,61,0.12)'
    }));
    // the LAD fitted line
    svg.appendChild(node('line', { x1: X(1e6), y1: Y(fittedY(1e6)), x2: X(2e10), y2: Y(fittedY(2e10)), stroke: '#e8a33d', 'stroke-width': 2.5 }));
    // tokenized comparables (evidence base) as one series
    if (DATA.comps) DATA.comps.forEach(function (c) {
      svg.appendChild(node('circle', { cx: X(c.tvl_usd), cy: Y(c.mcap_usd), r: 3.2, fill: '#5aa7ff', opacity: '0.85' }));
    });
    // board pre-token protocols as the second series
    DATA.rows.forEach(function (r) {
      svg.appendChild(node('circle', { cx: X(Math.max(r.tvl_usd, 1e6)), cy: Y(r.implied_value_usd), r: 2.4, fill: '#ffc877', opacity: '0.7' }));
    });
    svg.appendChild(node('text', { x: P.l + 6, y: P.t + 16, fill: '#8b93a3', 'font-size': 12 })).textContent = 'TVL (x)';
    return svg;
  }

  function scatterPanel() {
    var legend = el('div', { class: 'legend' },
      el('span', null, el('i', { style: 'background:#5aa7ff' }), 'tokenized comparables'),
      el('span', null, el('i', { style: 'background:#ffc877' }), 'pre-token board rows'),
      el('span', null, el('i', { style: 'background:#e8a33d' }), 'LAD fitted line'),
      el('span', null, el('i', { style: 'background:rgba(232,163,61,0.5)' }), 'p25-p75 residual band')
    );
    return el('section', { class: 'panel scatter' },
      el('h2', { style: 'padding:14px 16px 0;color:#e8a33d', text: 'LAD fitted scatter' }),
      el('div', { class: 'panel-body' }, scatter()),
      legend
    );
  }

  function header() {
    var m = DATA.model;
    return el('header', null,
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'RADAR · LAD' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: 'LAD median regression' })
      )
    );
  }

  function statsStrip() {
    var m = DATA.model;
    var bt = DATA.backtest;
    return el('section', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Comparables' }), el('b', { text: String(DATA.comps_count) })),
      el('div', { class: 'fact' }, el('span', { text: 'LAD equation' }), el('b', { text: m.intercept.toFixed(2) + ' + ' + m.slope.toFixed(2) + '·log(TVL)' })),
      el('div', { class: 'fact' }, el('span', { text: 'Residual SD' }), el('b', { text: m.residualSd.toFixed(2) })),
      el('div', { class: 'fact' }, el('span', { text: 'Median % error' }), el('b', { text: bt.medianPctError.toFixed(0) + '%' }))
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'A median (LAD) regression fits the tokenized comparables, then every pre-token protocol gets a central implied value with a low/high interval. The watchlist (' + DATA.watchlist_size + ') is the floor; the board adds ' + DATA.early_size + ' early rows below it. Board rows never mix in protocols whose token already trades — those live in the Comps view.' })
      ),
      statsStrip()
    );
  }

  function spotlight() {
    var top = DATA.rows.slice(0, 10);
    return el('section', { class: 'spotlight' }, top.map(function (r) {
      return el('div', { class: 'spot', onclick: function () { openDetail(r.slug); } },
        el('div', { class: 'rk', text: '#' + r.rank }),
        el('div', { class: 'nm', text: r.name }),
        el('div', { class: 'cat', text: (r.category || 'Other') }),
        el('div', { class: 'val', text: fmtUsd(r.implied_value_usd) })
      );
    }));
  }

  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c }, state.category === c ? { selected: 'selected' } : null); })
    );
    select.addEventListener('change', function () { state.category = select.value; render(); });
    var bandChips = [['all', 'All bands'], ['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']].map(function (b) {
      return el('button', { type: 'button', 'aria-pressed': state.band === b[0] ? 'true' : 'false', text: b[1], onclick: function () { state.band = b[0]; render(); } });
    });
    var wlToggle = el('button', { type: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Interval band' }), el('div', { class: 'chips' }, bandChips)),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Coverage' }), el('div', { class: 'toggle' }, wlToggle)),
      el('span', { class: 'count', text: rows().length + ' rows shown' })
    );
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.band !== 'all' && bandOf(r) !== state.band) return false;
      if (state.watchlistOnly && !WL.has(r.slug)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.band = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var lo = Math.log(r.low_value_usd), hi = Math.log(r.high_value_usd), mid = Math.log(r.implied_value_usd);
      var w = 100;
      var left = (mid - lo) / (hi - lo || 1) * 50;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        el('td', null, el('div', { class: 'ibar', 'aria-hidden': 'true' },
          el('i', { style: 'left:' + Math.max(0, 50 - left) + '%;width:' + Math.max(4, left * 2) + '%' }),
          el('s', { style: 'left:' + 50 + '%' })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, farm plan and nearest comps.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied'),
          el('th', { scope: 'col', text: 'Low–high' })
        )),
        tbody
      )
    ));
  }

  var dialog = el('div', { class: 'detail', id: 'detail', hidden: true });

  function closeDetail() { state.selected = null; writeHash(); dialog.hidden = true; }

  function nearestComps(r) {
    var cat = r.category || '';
    var same = (DATA.comps || []).filter(function (c) { return (c.category || '') === cat; });
    var pool = same.length >= 4 ? same : DATA.comps || [];
    pool = pool.slice().sort(function (a, b) { return Math.abs(a.tvl_usd - r.tvl_usd) - Math.abs(b.tvl_usd - r.tvl_usd); });
    return pool.slice(0, 4);
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var lo = Math.log(row.low_value_usd), hi = Math.log(row.high_value_usd), mid = Math.log(row.implied_value_usd);
    var left = (mid - lo) / (hi - lo || 1) * 50;
    var nc = nearestComps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: closeDetail })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Valuation' }),
      el('div', { class: 'three' },
        el('div', { class: 'fact' }, el('span', { text: 'Low' }), el('b', { class: 'num lo', text: fmtUsd(row.low_value_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Central' }), el('b', { class: 'num mid', text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'High' }), el('b', { class: 'num hi', text: fmtUsd(row.high_value_usd) }))
      ),
      el('div', { class: 'big-bar', 'aria-hidden': 'true' },
        el('i', { style: 'left:' + Math.max(0, 50 - left) + '%;width:' + Math.max(4, left * 2) + '%' }),
        el('s', { style: 'left:' + 50 + '%' })
      ),
      el('p', { class: 'sub', text: 'Interval from the fitted residuals: central × ' + DATA.model.lowFactor.toFixed(2) + ' (low) to × ' + DATA.model.highFactor.toFixed(2) + ' (high).' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Fitted log value (LAD)' }), el('b', { class: 'num', text: fittedLog(row).toFixed(2) })),
        el('div', null, el('span', { text: 'Category offset (' + (row.category || 'ref') + ')' }), el('b', { class: 'num', text: (catOffset(row) >= 0 ? '+' : '') + catOffset(row).toFixed(2) })),
        el('div', null, el('span', { text: '7-day growth (bounded prior)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Growth and age are bounded priors, not fitted: growth tilts the central by up to ±25%, age by +8% over three years. The fitted line comes only from the comparables.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ul', { class: 'steps' }, row.farm_steps.map(function (s, i) {
        return el('li', null, el('span', { class: 'n', text: (i + 1) + '.' }), s);
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Nearest tokenized comps' }),
      el('p', { class: 'sub', text: 'Already-trading protocols, closest by TVL, the evidence behind this row. They are not board rows.' }),
      el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Comp' }), el('th', { text: 'TVL' }), el('th', { text: 'mcap/TVL' }), el('th', { text: 'LAD residual' }))),
        el('tbody', null, nc.map(function (c) {
          return el('tr', null,
            el('td', null, el('div', { class: 'name' }, el('b', { text: c.name }), el('span', { class: 'sub', text: c.slug }))),
            el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
            el('td', { class: 'num', text: c.multiple.toFixed(2) + '×' }),
            el('td', { class: 'num', text: (c.ladResidual >= 0 ? '+' : '') + c.ladResidual.toFixed(2) })
          );
        }))
      )
    ));
    dialog.hidden = false;
  }

  function compsView() {
    var tbody = el('tbody');
    (DATA.comps || []).forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: c.name }), el('span', { class: 'sub', text: c.slug + ' · ' + (c.category || 'Other') }))),
        el('td', { class: 'num', text: fmtUsd(c.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(c.mcap_usd) }),
        el('td', { class: 'num', text: c.multiple.toFixed(2) + '×' }),
        el('td', { class: 'num', text: (c.ladResidual >= 0 ? '+' : '') + c.ladResidual.toFixed(2) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'comps-note', text: DATA.comps_count + ' tokenized comparables — the model\'s evidence base. These protocols already trade; they are the fitted data, never board rows. ' + DATA.backtest.within2x + ' within 2×, ' + DATA.backtest.within3x + ' within 3×.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Comparables, largest TVL first. mcap/TVL is the multiple; LAD residual is the log error of the fitted line for this comp.' }),
          el('thead', null, el('tr', null,
            el('th', { text: 'Comparable' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }),
            el('th', { text: 'mcap/TVL' }), el('th', { text: 'LAD residual' })
          )),
          tbody
        )
      )
    );
  }

  function methodology() {
    var m = DATA.model;
    var bt = DATA.backtest;
    var off = Object.keys(m.categoryOffsets).map(function (k) {
      return k + ' ' + (m.categoryOffsets[k] >= 0 ? '+' : '') + m.categoryOffsets[k].toFixed(2);
    }).join(', ');
    return el('section', { class: 'panel methodology' },
      el('h2', { text: 'How implied value is computed' }),
      el('div', { class: 'formula' },
        'log(mcap) = ' + m.intercept.toFixed(3) + ' + ' + m.slope.toFixed(3) + '·log(TVL) + category offset, fitted by LAD (IRLS) on ' + DATA.comps_count + ' tokenized comparables; reference ' + m.referenceCategory + ' = 0; offsets: ' + off + '.'
      ),
      el('div', { class: 'formula' },
        'implied = round( exp(fitted) · growthMult · maturityMult ); low = implied × ' + m.lowFactor.toFixed(2) + ', high = implied × ' + m.highFactor.toFixed(2) + '.'
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'fact' }, el('span', { text: 'LAD intercept / slope' }), el('b', { text: m.intercept.toFixed(2) + ' / ' + m.slope.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Residual SD' }), el('b', { text: m.residualSd.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Residual p25 / p75' }), el('b', { text: m.residualP25.toFixed(2) + ' / ' + m.residualP75.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median |log error|' }), el('b', { text: bt.medianAbsLogError.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median % error' }), el('b', { text: bt.medianPctError.toFixed(0) + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Within 2× / 3×' }), el('b', { text: bt.within2x + ' / ' + bt.within3x })),
        el('div', { class: 'fact' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Comps / excluded' }), el('b', { text: DATA.comps_count + ' / ' + (DATA.excluded_count + DATA.comps_count) }))
      ),
      el('p', { class: 'sub', text: 'The LAD line and OLS land in the same error band; LAD is chosen for robustness to the 0.0003×–400× multiple spread, not for a better backtest. Growth and age are bounded priors: growth tilts by up to ±25%, age by +8% over 3 years. The board ranks pre-token non-exchange protocols; the 11 version-marked names admitted only so the board reaches 300 rows. Tokenized protocols appear in the Comps view, never as board rows.' })
    );
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('view')) state.view = params.get('view');
    if (params.get('detail')) state.selected = params.get('detail');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.view !== 'board') params.set('view', state.view);
    if (state.selected) params.set('detail', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function navTabs() {
    return el('div', { class: 'toggle', style: 'margin-bottom:12px' },
      el('button', { type: 'button', 'aria-pressed': state.view === 'board' ? 'true' : 'false', text: 'Board', onclick: function () { state.view = 'board'; state.selected = null; writeHash(); render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.view === 'comps' ? 'true' : 'false', text: 'Comps (' + DATA.comps_count + ')', onclick: function () { state.view = 'comps'; state.selected = null; writeHash(); render(); } })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(navTabs());
    if (state.view === 'comps') {
      shell.appendChild(scatterPanel());
      shell.appendChild(compsView());
    } else {
      shell.appendChild(spotlight());
      shell.appendChild(scatterPanel());
      shell.appendChild(controls());
      shell.appendChild(boardTable());
    }
    shell.appendChild(methodology());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dialog.hidden) closeDetail();
  });
})();