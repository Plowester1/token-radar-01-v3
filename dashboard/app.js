(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('app');
  var state = {
    query: '',
    category: 'all',
    band: 'all',
    watched: false,
    sort: 'implied',
    direction: -1,
    view: 'board',
    selected: null
  };
  var watchlist = new Set(DATA.watchlist || []);
  var currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    var amount = Math.abs(value);
    if (amount >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
    if (amount >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (amount >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (amount >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return currency.format(value);
  }

  function percent(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function bandFor(row) {
    var spread = row.high_value_usd / Math.max(1, row.low_value_usd);
    if (spread < 8) return 'narrow';
    if (spread < 16) return 'medium';
    return 'wide';
  }

  function node(tag, attributes) {
    var element = document.createElement(tag);
    if (attributes) {
      Object.keys(attributes).forEach(function (key) {
        if (key === 'class') element.className = attributes[key];
        else if (key === 'text') element.textContent = attributes[key];
        else if (key.slice(0, 2) === 'on') element.addEventListener(key.slice(2), attributes[key]);
        else if (attributes[key] !== null && attributes[key] !== undefined) element.setAttribute(key, attributes[key]);
      });
    }
    for (var index = 2; index < arguments.length; index += 1) {
      var child = arguments[index];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (item) { if (item) element.appendChild(item); });
      else if (child instanceof Node) element.appendChild(child);
      else element.appendChild(document.createTextNode(String(child)));
    }
    return element;
  }

  function categoryOffset(row) {
    return DATA.model.categoryOffsets[row.category] || 0;
  }

  function fittedLog(row) {
    return DATA.model.intercept + DATA.model.slope * Math.log(Math.max(row.tvl_usd, 1)) + categoryOffset(row);
  }

  function readLocation() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('q')) state.query = params.get('q');
    if (params.get('view')) state.view = params.get('view');
    if (params.get('detail')) state.selected = params.get('detail');
  }

  function updateLocation() {
    var params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.view !== 'board') params.set('view', state.view);
    if (state.selected) params.set('detail', state.selected);
    var hash = params.toString();
    if (hash) window.history.replaceState(null, '', '#' + hash);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function svgNode(tag, attributes) {
    var namespace = 'http' + '://www.w3.org/2000/svg';
    var element = document.createElementNS(namespace, tag);
    Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    return element;
  }

  function scatterChart() {
    var width = 900;
    var height = 400;
    var padding = { left: 60, right: 22, top: 18, bottom: 46 };
    var innerWidth = width - padding.left - padding.right;
    var innerHeight = height - padding.top - padding.bottom;
    var minimumX = Math.log(1e6);
    var maximumX = Math.log(2e10);
    var minimumY = Math.log(1e5);
    var maximumY = Math.log(3e9);
    DATA.rows.forEach(function (row) {
      minimumY = Math.min(minimumY, Math.log(row.low_value_usd));
      maximumY = Math.max(maximumY, Math.log(row.high_value_usd));
    });
    DATA.comps.forEach(function (comp) {
      maximumX = Math.max(maximumX, Math.log(comp.tvl_usd));
      maximumY = Math.max(maximumY, Math.log(comp.mcap_usd));
    });
    var xAt = function (value) { return padding.left + (Math.log(value) - minimumX) / (maximumX - minimumX) * innerWidth; };
    var yAt = function (value) { return padding.top + innerHeight - (Math.log(value) - minimumY) / (maximumY - minimumY) * innerHeight; };
    var chart = svgNode('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      role: 'img',
      'aria-label': 'Log-log chart of TVL and value with the fitted LAD line and residual band'
    });
    for (var power = 6; power <= 10; power += 1) {
      var tick = Math.pow(10, power);
      chart.appendChild(svgNode('line', { x1: xAt(tick), y1: padding.top, x2: xAt(tick), y2: height - padding.bottom, stroke: '#252b35' }));
      var xLabel = svgNode('text', { x: xAt(tick), y: height - 20, fill: '#8991a0', 'font-size': 11, 'text-anchor': 'middle' });
      xLabel.textContent = power >= 9 ? '$' + tick / 1e9 + 'B' : '$' + tick / 1e6 + 'M';
      chart.appendChild(xLabel);
    }
    for (var level = 5; level <= 9; level += 1) {
      var value = Math.pow(10, level);
      chart.appendChild(svgNode('line', { x1: padding.left, y1: yAt(value), x2: width - padding.right, y2: yAt(value), stroke: '#252b35' }));
      var yLabel = svgNode('text', { x: padding.left - 7, y: yAt(value) + 4, fill: '#8991a0', 'font-size': 11, 'text-anchor': 'end' });
      yLabel.textContent = level >= 9 ? '$' + value / 1e9 + 'B' : level >= 6 ? '$' + value / 1e6 + 'M' : '$' + value / 1e3 + 'K';
      chart.appendChild(yLabel);
    }
    var model = DATA.model;
    var referenceOffset = model.categoryOffsets.Dexs || 0;
    var fittedValue = function (tvl) { return Math.exp(model.intercept + model.slope * Math.log(tvl) + referenceOffset); };
    var lowerLeft = fittedValue(1e6) * model.lowFactor;
    var lowerRight = fittedValue(2e10) * model.lowFactor;
    var upperLeft = fittedValue(1e6) * model.highFactor;
    var upperRight = fittedValue(2e10) * model.highFactor;
    chart.appendChild(svgNode('polygon', {
      points: [xAt(1e6), yAt(lowerLeft), xAt(2e10), yAt(lowerRight), xAt(2e10), yAt(upperRight), xAt(1e6), yAt(upperLeft)].join(' '),
      fill: 'rgba(232,163,61,0.13)'
    }));
    chart.appendChild(svgNode('line', { x1: xAt(1e6), y1: yAt(fittedValue(1e6)), x2: xAt(2e10), y2: yAt(fittedValue(2e10)), stroke: '#e8a33d', 'stroke-width': 2.5 }));
    DATA.comps.forEach(function (comp) {
      chart.appendChild(svgNode('circle', { cx: xAt(comp.tvl_usd), cy: yAt(comp.mcap_usd), r: 3.1, fill: '#5aa7ff', opacity: 0.86 }));
    });
    DATA.rows.forEach(function (row) {
      chart.appendChild(svgNode('circle', { cx: xAt(Math.max(row.tvl_usd, 1e6)), cy: yAt(row.implied_value_usd), r: 2.4, fill: '#ffc877', opacity: 0.72 }));
    });
    return chart;
  }

  function header() {
    return node('header', null,
      node('div', { class: 'brand' }, node('span', { class: 'brand-mark' }), node('span', { class: 'eyebrow', text: 'TOKEN RADAR / LAD' })),
      node('div', { class: 'header-meta' },
        node('span', { text: 'Snapshot ' + DATA.as_of }),
        node('span', { text: DATA.comps_count + ' tokenized comparables' }),
        node('span', { text: 'Median regression' })
      )
    );
  }

  function statStrip() {
    var model = DATA.model;
    var backtest = DATA.backtest;
    return node('section', { class: 'stats' },
      node('div', { class: 'stat' }, node('span', { text: 'Board' }), node('strong', { text: DATA.board_size + ' rows' })),
      node('div', { class: 'stat' }, node('span', { text: 'LAD equation' }), node('strong', { text: model.intercept.toFixed(2) + ' + ' + model.slope.toFixed(2) + '·log(TVL)' })),
      node('div', { class: 'stat' }, node('span', { text: 'Residual spread' }), node('strong', { text: 'σ ' + model.residualSd.toFixed(2) })),
      node('div', { class: 'stat' }, node('span', { text: 'Median error' }), node('strong', { text: backtest.medianPctError.toFixed(0) + '%' }))
    );
  }

  function introduction() {
    return node('section', { class: 'intro' },
      node('div', null,
        node('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        node('p', { text: 'The radar fits the median market-cap relationship among already-trading protocols, then scores every protocol whose record carries no token. Each row has a central estimate, a residual interval and a concrete farm path.' })
      ),
      statStrip()
    );
  }

  function spotlight() {
    return node('section', { class: 'spotlight', 'aria-label': 'Top ten protocols' }, DATA.rows.slice(0, 10).map(function (row) {
      return node('button', { class: 'spot', type: 'button', onclick: function () { openDetail(row.slug); } },
        node('span', { class: 'spot-rank', text: '#' + row.rank }),
        node('strong', { class: 'spot-name', text: row.name }),
        node('span', { class: 'spot-category', text: row.category || 'Other' }),
        node('span', { class: 'spot-value', text: money(row.implied_value_usd) })
      );
    }));
  }

  function scatterPanel() {
    var legend = node('div', { class: 'legend' },
      node('span', null, node('i', { class: 'blue' }), 'tokenized comparables'),
      node('span', null, node('i', { class: 'amber' }), 'pre-token board rows'),
      node('span', null, node('i', { class: 'line' }), 'LAD line'),
      node('span', null, node('i', { class: 'band' }), 'p25–p75 residual band')
    );
    return node('section', { class: 'panel scatter-panel' },
      node('div', { class: 'panel-heading' }, node('h2', { text: 'Where implied value sits' }), node('p', { text: 'Log-log view of TVL and value; category offsets move individual protocols around the fitted line.' })),
      node('div', { class: 'chart' }, scatterChart()),
      legend
    );
  }

  function viewTabs() {
    return node('div', { class: 'tabs' },
      node('button', { type: 'button', 'aria-pressed': state.view === 'board' ? 'true' : 'false', text: 'Board', onclick: function () { state.view = 'board'; state.selected = null; updateLocation(); render(); } }),
      node('button', { type: 'button', 'aria-pressed': state.view === 'comps' ? 'true' : 'false', text: 'Comps · ' + DATA.comps_count, onclick: function () { state.view = 'comps'; state.selected = null; updateLocation(); render(); } })
    );
  }

  function filteredRows() {
    var query = state.query.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category !== 'all' && row.category !== state.category) return false;
      if (state.band !== 'all' && bandFor(row) !== state.band) return false;
      if (state.watched && !watchlist.has(row.slug)) return false;
      if (!query) return true;
      var searchable = [row.name, row.slug, row.category || '', (row.chains || []).join(' ')].join(' ').toLowerCase();
      return searchable.indexOf(query) >= 0;
    });
  }

  function orderedRows(rows) {
    return rows.slice().sort(function (left, right) {
      var leftValue;
      var rightValue;
      if (state.sort === 'name') {
        leftValue = left.name.toLowerCase();
        rightValue = right.name.toLowerCase();
      } else if (state.sort === 'tvl') {
        leftValue = left.tvl_usd;
        rightValue = right.tvl_usd;
      } else if (state.sort === 'growth') {
        leftValue = left.change_7d === null ? -Infinity : left.change_7d;
        rightValue = right.change_7d === null ? -Infinity : right.change_7d;
      } else if (state.sort === 'age') {
        leftValue = left.age_days === null ? Infinity : left.age_days;
        rightValue = right.age_days === null ? Infinity : right.age_days;
      } else {
        leftValue = left.implied_value_usd;
        rightValue = right.implied_value_usd;
      }
      if (leftValue < rightValue) return -state.direction;
      if (leftValue > rightValue) return state.direction;
      return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
    });
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (row) { return row.category || 'Other'; }))).sort();
    var search = node('input', { id: 'query', type: 'search', value: state.query, placeholder: 'Search protocol, slug, or chain', 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.query = search.value; updateLocation(); render(); });
    var category = node('select', { id: 'category', 'aria-label': 'Filter by category' },
      node('option', { value: 'all', text: 'Every category' }),
      categories.map(function (name) { return node('option', { value: name, text: name }); })
    );
    category.value = state.category;
    category.addEventListener('change', function () { state.category = category.value; render(); });
    var bands = [['all', 'All'], ['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']].map(function (entry) {
      return node('button', { type: 'button', 'aria-pressed': state.band === entry[0] ? 'true' : 'false', text: entry[1], onclick: function () { state.band = entry[0]; render(); } });
    });
    var watchedButton = node('button', { type: 'button', 'aria-pressed': state.watched ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watched = !state.watched; render(); } });
    return node('div', { class: 'controls' },
      node('label', { class: 'search-field', for: 'query' }, node('span', { text: 'Search' }), search),
      node('label', { class: 'category-field', for: 'category' }, node('span', { text: 'Category' }), category),
      node('div', { class: 'filter-field' }, node('span', { text: 'Interval' }), node('div', { class: 'chips' }, bands)),
      node('div', { class: 'filter-field' }, node('span', { text: 'Coverage' }), node('div', { class: 'chips' }, watchedButton)),
      node('span', { class: 'result-count', text: filteredRows().length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return node('th', { scope: 'col' }, node('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.direction = -state.direction;
      else { state.sort = key; state.direction = -1; }
      render();
    } }, label, state.sort === key ? node('span', { text: state.direction < 0 ? ' ▼' : ' ▲' }) : null));
  }

  function intervalBar(row) {
    var low = Math.log(row.low_value_usd);
    var high = Math.log(row.high_value_usd);
    var middle = Math.log(row.implied_value_usd);
    var offset = (middle - low) / (high - low || 1) * 50;
    return node('div', { class: 'interval', 'aria-hidden': 'true' },
      node('i', { style: 'left:' + Math.max(0, 50 - offset) + '%;width:' + Math.max(4, offset * 2) + '%' }),
      node('s', { style: 'left:50%' })
    );
  }

  function boardTable() {
    var rows = orderedRows(filteredRows());
    if (rows.length === 0) {
      return node('section', { class: 'panel empty' }, node('h2', { text: 'Nothing matches these filters' }), node('button', { class: 'primary', type: 'button', text: 'Reset filters', onclick: resetFilters }));
    }
    var body = node('tbody');
    rows.forEach(function (row) {
      var trendClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'positive' : 'negative';
      body.appendChild(node('tr', {
        tabindex: '0',
        'data-selected': state.selected === row.slug ? 'true' : 'false',
        onclick: function () { openDetail(row.slug); },
        onkeydown: function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(row.slug); } }
      },
        node('td', { class: 'number', text: String(row.rank) }),
        node('td', null, node('div', { class: 'protocol-name' }, node('b', { text: row.name }), node('span', { text: (row.category || 'Other') + ' · ' + (row.chains.length ? row.chains.slice(0, 2).join(', ') : 'unnamed chain') }))),
        node('td', { class: 'number', text: money(row.tvl_usd) }),
        node('td', { class: 'number ' + trendClass, text: percent(row.change_7d) }),
        node('td', { class: 'number', text: age(row.age_days) }),
        node('td', { class: 'number value', text: money(row.implied_value_usd) }),
        node('td', null, intervalBar(row))
      ));
    });
    return node('section', { class: 'panel table-panel' },
      node('div', { class: 'table-scroll' },
        node('table', null,
          node('caption', { text: 'Pre-token protocols ordered by the model’s implied value. Open any row for its calculation and farm plan.' }),
          node('thead', null, node('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7-day'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'),
            node('th', { scope: 'col', text: 'Interval' })
          )),
          body
        )
      )
    );
  }

  function resetFilters() {
    state.query = '';
    state.category = 'all';
    state.band = 'all';
    state.watched = false;
    updateLocation();
    render();
  }

  var drawer = node('aside', { class: 'drawer', id: 'detail', hidden: true, 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    updateLocation();
    drawer.hidden = true;
  }

  function nearestComparables(row) {
    var sameCategory = DATA.comps.filter(function (comp) { return (comp.category || '') === (row.category || ''); });
    var pool = sameCategory.length >= 4 ? sameCategory : DATA.comps;
    return pool.slice().sort(function (left, right) {
      return Math.abs(left.tvl_usd - row.tvl_usd) - Math.abs(right.tvl_usd - row.tvl_usd);
    }).slice(0, 4);
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (item) { return item.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    updateLocation();
    drawer.textContent = '';
    drawer.appendChild(node('div', { class: 'drawer-head' },
      node('div', null,
        node('span', { class: 'eyebrow', text: 'RANK ' + row.rank + ' / ' + DATA.board_size }),
        node('h2', { text: row.name }),
        node('p', { text: (row.category || 'Other') + ' · ' + (row.chains.length ? row.chains.join(', ') : 'unnamed chain') })
      ),
      node('button', { class: 'close', type: 'button', 'aria-label': 'Close detail', text: '×', onclick: closeDetail })
    ));
    drawer.appendChild(node('section', { class: 'detail-section valuation' },
      node('h3', { text: 'Valuation' }),
      node('div', { class: 'valuation-grid' },
        node('div', null, node('span', { text: 'Low' }), node('b', { text: money(row.low_value_usd) })),
        node('div', null, node('span', { text: 'Central' }), node('b', { class: 'central', text: money(row.implied_value_usd) })),
        node('div', null, node('span', { text: 'High' }), node('b', { text: money(row.high_value_usd) }))
      ),
      intervalBar(row),
      node('p', { class: 'fine', text: 'Residual interval: central × ' + DATA.model.lowFactor.toFixed(2) + ' to central × ' + DATA.model.highFactor.toFixed(2) + '.' })
    ));
    drawer.appendChild(node('section', { class: 'detail-section breakdown' },
      node('h3', { text: 'Model breakdown' }),
      node('div', { class: 'equation' },
        node('div', null, node('span', { text: 'Fitted log value' }), node('b', { text: fittedLog(row).toFixed(2) })),
        node('div', null, node('span', { text: 'Category offset' }), node('b', { text: (categoryOffset(row) >= 0 ? '+' : '') + categoryOffset(row).toFixed(2) })),
        node('div', null, node('span', { text: '7-day growth' }), node('b', { text: percent(row.change_7d) })),
        node('div', null, node('span', { text: 'Growth multiplier' }), node('b', { text: String(row.growth_multiplier) })),
        node('div', null, node('span', { text: 'Maturity multiplier' }), node('b', { text: String(row.maturity_multiplier) }))
      ),
      node('p', { class: 'fine', text: 'Growth is bounded to ±25%; age adds at most 8% over three years. These are priors, not fitted coefficients.' })
    ));
    drawer.appendChild(node('section', { class: 'detail-section farm' },
      node('h3', { text: 'Farm plan' }),
      node('ul', { class: 'steps' }, row.farm_steps.map(function (step, index) {
        return node('li', null, node('span', { class: 'n', text: (index + 1) + '.' }), node('span', { text: step }));
      }))
    ));
    var comparisons = nearestComparables(row);
    drawer.appendChild(node('section', { class: 'detail-section' },
      node('h3', { text: 'Nearest tokenized comps' }),
      node('p', { class: 'fine', text: 'Closest already-trading protocols by TVL. They are the model’s evidence base, never board rows.' }),
      node('table', { class: 'comp-table' },
        node('thead', null, node('tr', null, node('th', { text: 'Comp' }), node('th', { text: 'TVL' }), node('th', { text: 'Multiple' }), node('th', { text: 'Residual' }))),
        node('tbody', null, comparisons.map(function (comp) {
          return node('tr', null,
            node('td', { text: comp.name }),
            node('td', { class: 'number', text: money(comp.tvl_usd) }),
            node('td', { class: 'number', text: comp.multiple.toFixed(2) + '×' }),
            node('td', { class: 'number', text: (comp.ladResidual >= 0 ? '+' : '') + comp.ladResidual.toFixed(2) })
          );
        }))
      )
    ));
    drawer.hidden = false;
  }

  function comparablesView() {
    var body = node('tbody');
    DATA.comps.forEach(function (comp) {
      body.appendChild(node('tr', null,
        node('td', null, node('div', { class: 'protocol-name' }, node('b', { text: comp.name }), node('span', { text: comp.slug + ' · ' + (comp.category || 'Other') }))),
        node('td', { class: 'number', text: money(comp.tvl_usd) }),
        node('td', { class: 'number', text: money(comp.mcap_usd) }),
        node('td', { class: 'number', text: comp.multiple.toFixed(2) + '×' }),
        node('td', { class: 'number', text: (comp.ladResidual >= 0 ? '+' : '') + comp.ladResidual.toFixed(2) })
      ));
    });
    return node('section', { class: 'panel table-panel' },
      node('div', { class: 'comps-note' }, node('b', { text: DATA.comps_count + ' tokenized comparables' }), node('span', { text: 'These are already-trading protocols used to fit the LAD model. They are shown here for evidence and never ranked on the board. ' + DATA.backtest.within2x + ' fall within 2× and ' + DATA.backtest.within3x + ' within 3× in-sample.' })),
      node('div', { class: 'table-scroll' },
        node('table', null,
          node('caption', { text: 'Comparable protocols, largest TVL first. Multiple is market cap divided by TVL; residual is the log error against the fitted line.' }),
          node('thead', null, node('tr', null,
            node('th', { text: 'Comparable' }), node('th', { text: 'TVL' }), node('th', { text: 'Market cap' }),
            node('th', { text: 'Multiple' }), node('th', { text: 'LAD residual' })
          )),
          body
        )
      )
    );
  }

  function methodology() {
    var model = DATA.model;
    var backtest = DATA.backtest;
    var offsets = Object.keys(model.categoryOffsets).map(function (category) {
      return category + ' ' + (model.categoryOffsets[category] >= 0 ? '+' : '') + model.categoryOffsets[category].toFixed(2);
    }).join(', ');
    return node('section', { class: 'panel methodology' },
      node('div', { class: 'panel-heading' }, node('h2', { text: 'Methodology' }), node('p', { text: 'Every displayed coefficient is fitted at runtime from the sealed snapshot.' })),
      node('div', { class: 'method-grid' },
        node('p', { class: 'formula', text: 'log(mcap) = ' + model.intercept.toFixed(3) + ' + ' + model.slope.toFixed(3) + '·log(TVL) + category offset. IRLS LAD fit on ' + DATA.comps_count + ' comparables; ' + model.referenceCategory + ' is the zero reference; offsets: ' + offsets + '.' }),
        node('p', { class: 'formula', text: 'implied = round(exp(fitted log value) × growth prior × maturity prior). The interval uses fitted residual p25/p75: ×' + model.lowFactor.toFixed(3) + ' and ×' + model.highFactor.toFixed(3) + '.' })
      ),
      node('div', { class: 'method-stats' },
        node('div', null, node('span', { text: 'Residual SD' }), node('b', { text: model.residualSd.toFixed(2) })),
        node('div', null, node('span', { text: 'p25 / p75' }), node('b', { text: model.residualP25.toFixed(2) + ' / ' + model.residualP75.toFixed(2) })),
        node('div', null, node('span', { text: 'Median |log error|' }), node('b', { text: backtest.medianAbsLogError.toFixed(2) })),
        node('div', null, node('span', { text: 'Median % error' }), node('b', { text: backtest.medianPctError.toFixed(0) + '%' })),
        node('div', null, node('span', { text: 'Within 2× / 3×' }), node('b', { text: backtest.within2x + ' / ' + backtest.within3x })),
        node('div', null, node('span', { text: 'IRLS rounds' }), node('b', { text: String(model.iterations) }))
      ),
      node('p', { class: 'fine', text: 'Board eligibility is strict: no recorded token and not a CEX. The strict house-style pool has 289 protocols; 11 additional pre-token non-CEX protocols with version-marked names are admitted only so the board reaches 300 rows. Tokenized protocols stay in Comps and never enter the ranking.' })
    );
  }

  function render() {
    mount.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(introduction());
    shell.appendChild(viewTabs());
    if (state.view === 'comps') {
      shell.appendChild(scatterPanel());
      shell.appendChild(comparablesView());
    } else {
      shell.appendChild(spotlight());
      shell.appendChild(scatterPanel());
      shell.appendChild(controls());
      shell.appendChild(boardTable());
    }
    shell.appendChild(methodology());
    mount.appendChild(shell);
    mount.appendChild(drawer);
    mount.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readLocation();
  render();
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !drawer.hidden) closeDetail();
  });
})();
