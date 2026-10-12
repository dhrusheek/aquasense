/* AquaSense-WSN dashboard — vanilla JS, no build step, offline.
 * Structure: constants → utils (safe getters, formatting) → state → data accessors →
 * chart registry → view builders (skeleton, once) + renderers (every poll) → router →
 * polling / mock → commands → boot.
 */
(function () {
  'use strict';

  /* ======================= constants ======================= */
  var POLL_MS = 1000, TIMEOUT_MS = 1500;
  var QS = new URLSearchParams(location.search);
  var MOCK = QS.has('mock') && QS.get('mock') !== '0';
  var NODE_IDS = ['N1', 'N2', 'N3', 'N4'];
  var ALLOWED = { 1: [2, 3], 2: [1, 3, 4], 3: [1, 2, 4], 4: [2, 3] };
  var ALL_PAIRS = [[1, 2], [1, 3], [2, 3], [2, 4], [3, 4], [1, 4]];
  var DEFAULT_POS = { N1: [50, 30], N2: [0, 0], N3: [120, 0], N4: [60, 90] };
  var NODE_COLOR = { N1: '--n1', N2: '--n2', N3: '--n3', N4: '--n4' };
  var SHORT_ROLE = { N1: 'Sensor · Temp alert', N2: 'Relay · Turbidity', N3: 'Cluster head · Temp', N4: 'Sink · Light' };
  var READING_LABEL = { N1: 'Enclosure temperature (N1, pond edge)', N2: 'Turbidity', N3: 'Enclosure temperature (N3, bank)' };
  /* N1 over-temperature alert threshold (spec §1.2, §9.1 TEMP_WARN{a:1, v}); v is °C × 100 */
  var TEMP_WARN = { def: 6000, minC: 0, maxC: 150, step: 0.5 };
  var WIRING = { /* exact pins from docs/PROTOCOL_SPEC.md §1 */
    N1: ['no wiring: ESP32 on-chip temperature sensor', 'USB power only', 'LED GPIO2 = awake / TX'],
    N2: ['V → 3V3', 'G → GND', 'A → GPIO34 (ADC1_CH6, 11 dB)', 'D → GPIO27 (INPUT_PULLUP)', 'probe 1/2/3/4 → board 1/2/3/4', 'LED GPIO2 = awake / TX'],
    N3: ['no wiring: ESP32 on-chip temperature sensor', 'LED GPIO2 = awake / TX'],
    N4: ['GPIO25 → green LED, GPIO27 → red LED, each via a resistor, cathodes → GND (GPIO26 unused)', 'USB → laptop (power + Serial 115200)', 'Wi-Fi STA → laptop hotspot, HTTP POST /api/data every 3 s', 'LED GPIO2 = awake / TX']
  };
  /* pond status light at N4 (spec §9.3), two LEDs (red and green): label, chip tone, rule.
   * Each flag is the freshest one the sink holds for that node, from an AGG or a direct DATA. */
  var LIGHT = {
    green: { label: 'Green', tone: 'ok', rule: 'everything else: all nominal' },
    hot: { label: 'Hot · red blinking', tone: 'bad', rule: 'freshest N1 flag is 1 (N1 enclosure ≥ its TEMP_WARN threshold), water not turbid' },
    red: { label: 'Red', tone: 'bad', rule: 'freshest N2 flag is 1 (turbidity comparator D): water turbid' },
    stale: { label: 'Stale · green blinking', tone: 'warn', rule: 'no AGG and no direct DATA for 3 superframes (9 s)' },
    test: { label: 'Test · cycling', tone: 'info', rule: 'LIGHT_TEST: red, then green, 1 s each' },
    off: { label: 'Off', tone: '', rule: 'not time-synced yet / no sample received' }
  };

  var VIEWS = {
    overview: { n: '', title: 'Overview', marks: '', proves: 'The integrated system runs end-to-end: a real-time dashboard of node status, BLE localization, sensor data, routing path, aggregated data, MAC activity and key performance metrics.' },
    r1: { n: 1, title: 'WSN Architecture & ESP32 Setup', marks: '2 marks', proves: '4 ESP32 nodes configured correctly; sensor, cluster-head/aggregator, router and sink roles clearly implemented; proper network topology and addressing.' },
    r2: { n: 2, title: 'BLE-Based Localization', marks: '3 marks', proves: 'BLE advertising/scanning, RSSI measurement, distance estimation, nearest-node identification and localization-error calculation.' },
    r3: { n: 3, title: 'Wi-Fi MAC Protocol', marks: '3 marks', proves: 'Channel sensing, back-off mechanism, ACK, timeout, retransmission and collision-handling implemented and demonstrated.' },
    r4: { n: 4, title: 'Dynamic Schedule-Based Communication', marks: '2 marks', proves: 'TDMA-style slot allocation, dynamic schedule update, unused-slot handling and sleep/wake operation.' },
    r5: { n: 5, title: 'Broadcast & Unicast Communication', marks: '1 mark', proves: 'Correct broadcast of control/schedule messages and reliable unicast sensor-data transmission with destination/ACK handling.' },
    r6: { n: 6, title: 'Data Aggregation', marks: '2 marks', proves: 'Aggregator receives data from multiple nodes, applies aggregation function and demonstrates reduction in transmitted data.' },
    r7: { n: 7, title: 'Adaptive Multi-Hop Routing', marks: '2 marks', proves: 'Neighbor discovery/table, route metric, multi-hop forwarding, route selection and alternate-route recovery after link failure.' },
    r8: { n: 8, title: 'Performance Analysis', marks: '2 marks', proves: 'Minimum 4 metrics measured and analyzed: PDR, packet loss, delay, throughput, retransmission, localization error, etc. (all 7 are measured here).' },
    r9: { n: 9, title: 'Technical Demonstration & Viva', marks: '3 marks', proves: 'Technical explanation and viva: the integrated sequence BLE Discovery → … → Performance Analysis, shown live.' }
  };

  var DEMO_STEPS = [
    { k: 'BLE Discovery', v: 'r2', mod: 'ble_loc.h', see: 'Every node advertises as WSN-N<k> and scans; the RSSI matrix fills with the neighbour pairs.' },
    { k: 'RSSI Measurement', v: 'r2', mod: 'ble_loc.h', see: 'EMA-smoothed RSSI in dBm for every pair in the RSSI matrix.' },
    { k: 'Localization', v: 'r2', mod: 'sink.h', see: 'N1 estimated position (filled) vs true position (hollow) with the error in cm on the 2-D map.' },
    { k: 'Wi-Fi Initialization', v: 'r1', mod: 'mac.h', see: 'All four nodes show MAC address, channel and uptime; the sink shows its IP on the hotspot.' },
    { k: 'Dynamic Schedule Assignment', v: 'r4', mod: 'tdma.h', see: 'The slot strip shows the SCHED broadcast by N3: owner per slot, version and reason.' },
    { k: 'Channel Sensing', v: 'r3', mod: 'mac.h', see: 'CS_BUSY events in the MAC timeline and the per-node channel-busy counter.' },
    { k: 'Random Backoff', v: 'r3', mod: 'mac.h', see: 'BACKOFF n slots events, total backoff ms and the two contention-test lanes.' },
    { k: 'Scheduled Transmission', v: 'r4', mod: 'tdma.h', see: 'The live cursor sweeps the slots; each node sends DATA only in its own slot, sleeps otherwise.' },
    { k: 'Unicast Communication', v: 'r5', mod: 'mac.h', see: 'Message feed: DATA / AGG / STAT unicast with destination and ACK ✓.' },
    { k: 'Data Aggregation', v: 'r6', mod: 'aggregation.h', see: 'N1 + N2 + N3 inputs fused into one AGG frame; packet and byte reduction %.' },
    { k: 'Multi-Hop Routing', v: 'r7', mod: 'routing.h', see: 'Route strings such as 1>3>4 and hop counts per node; packets animate along the path.' },
    { k: 'Sink', v: 'r1', mod: 'sink.h', see: 'N4 collects AGG/STAT, computes PDR and delay, and posts JSON every 3 s (online pill green).' },
    { k: 'Link Failure', v: 'r7', mod: 'routing.h', see: 'Press "Simulate link failure N1–N3": the link turns dashed red on the map.' },
    { k: 'Failure Detection', v: 'r7', mod: 'routing.h', see: 'ACK timeouts lead to a LINK_DOWN event in the failure / recovery timeline.' },
    { k: 'Alternate Route Selection', v: 'r7', mod: 'routing.h', see: 'N1 switches to 1>2>3>4 (next hop N2) with its new route cost.' },
    { k: 'Route Recovery', v: 'r7', mod: 'routing.h', see: 'Press "Restore": HELLOs resume and ROUTE RESTORED brings 1>3>4 back.' },
    { k: 'Performance Analysis', v: 'r8', mod: 'sink.h', see: 'Metric table with formulas, measured values and interpretation; Export CSV.' }
  ];

  /* ======================= utils ======================= */
  function get(o, path, d) {
    if (o == null) return d;
    var parts = String(path).split('.');
    var cur = o;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return d;
      cur = cur[parts[i]];
    }
    return cur === undefined || cur === null ? d : cur;
  }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
  function num(x) {
    if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v, dec, unit) {
    var n = num(v);
    if (n === null) return '—';
    if (dec === undefined) dec = 1;
    var s = n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return unit ? s + ' ' + unit : s;
  }
  function fmtI(v, unit) { return fmt(v, 0, unit); }
  function fmtU(v, dec, unit) { // value + small unit, for KPI tiles
    var n = num(v);
    if (n === null) return '—';
    return esc(fmt(n, dec)) + (unit ? '<small>' + esc(unit) + '</small>' : '');
  }
  function fmtSec(ms) { var n = num(ms); return n === null ? '—' : fmt(n / 1000, 1, 's'); }
  function fmtAgo(s) {
    var n = num(s);
    if (n === null) return '—';
    if (n < 0) n = 0;
    if (n < 60) return fmt(n, 1) + ' s ago';
    if (n < 3600) return Math.floor(n / 60) + ' min ' + Math.floor(n % 60) + ' s ago';
    return fmt(n / 3600, 1) + ' h ago';
  }
  function fmtDur(s) {
    var n = num(s);
    if (n === null) return '—';
    n = Math.floor(n);
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
    return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + sec + 's';
  }
  function mean(a) {
    var v = arr(a).map(num).filter(function (x) { return x !== null; });
    return v.length ? v.reduce(function (p, c) { return p + c; }, 0) / v.length : null;
  }
  function sum(a) {
    var v = arr(a).map(num).filter(function (x) { return x !== null; });
    return v.length ? v.reduce(function (p, c) { return p + c; }, 0) : null;
  }
  function nNum(id) { // "N1" | 1 | "1" → 1
    if (typeof id === 'number') return id;
    var m = /(\d+)/.exec(String(id == null ? '' : id));
    return m ? Number(m[1]) : null;
  }
  function nId(x) { var n = nNum(x); return n ? 'N' + n : '—'; }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }
  function $(id) { return document.getElementById(id); }
  function setHTML(id, html) { var el = $(id); if (el && el.innerHTML !== html) el.innerHTML = html; }
  function setText(id, t) { var el = $(id); if (el && el.textContent !== t) el.textContent = t; }
  function dist(a, b) {
    if (!a || !b) return null;
    var dx = num(a[0]) - num(b[0]), dy = num(a[1]) - num(b[1]);
    return isFinite(dx) && isFinite(dy) ? Math.sqrt(dx * dx + dy * dy) : null;
  }
  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>'; }
  function statusChip(st) {
    var s = String(st || '').toLowerCase();
    if (s === 'active') return chip('● Active', 'ok');
    if (s === 'inactive') return chip('● Inactive', 'bad');
    return chip(st ? st : 'Unknown', '');
  }
  function pathHTML(p) {
    if (p == null || p === '') return '<span class="faint">—</span>';
    var hops = String(p).split('>').filter(Boolean);
    return '<span class="path">' + hops.map(function (h, i) {
      var cls = 'hop' + (h.trim() === '2' && i > 0 && i < hops.length - 1 ? ' via2' : '');
      return '<span class="' + cls + '">N' + esc(h.trim()) + '</span>';
    }).join('<span class="arr">→</span>') + '</span>';
  }
  function evClass(ev) {
    var e = String(ev || '').toUpperCase();
    if (e.indexOf('NEAR_COLLISION') >= 0 || e.indexOf('COLLISION') >= 0) return 'NEAR_COLLISION';
    if (e.indexOf('ACK_TIMEOUT') >= 0 || e.indexOf('TIMEOUT') >= 0) return 'ACK_TIMEOUT';
    if (e.indexOf('ACK_OK') >= 0) return 'ACK_OK';
    if (e.indexOf('DEFER') >= 0) return 'DEFER';
    if (e.indexOf('CS_BUSY') >= 0) return 'CS_BUSY';
    if (e.indexOf('RETX') >= 0) return 'RETX';
    if (e.indexOf('BACKOFF') >= 0) return 'BACKOFF';
    if (/(^|\W)TX(\W|$)/.test(e)) return 'TX';
    return 'OTHER';
  }
  var EV_LABEL = { CS_BUSY: 'Channel busy', BACKOFF: 'Backoff', TX: 'Transmit', ACK_OK: 'ACK received', ACK_TIMEOUT: 'ACK timeout', RETX: 'Retransmit', DEFER: 'Defer', NEAR_COLLISION: 'Near-collision', OTHER: 'Event' };
  function evChip(ev) { var c = evClass(ev); return '<span class="chip ev-' + c + '">' + esc(EV_LABEL[c]) + '</span>'; }
  function tempC(v) { // ESP32 die temperature ×100 integer → °C (heuristic: a die below 200 °C)
    var n = num(v);
    if (n === null || n <= -100 || n === -1) return null;
    return Math.abs(n) > 200 ? n / 100 : n;
  }

  /* ======================= state ======================= */
  var S = {
    data: null, fetchOk: false, everOk: false, recvPerf: 0, view: 'overview',
    built: {}, charts: {}, routeKey: {}, mock: null, mockTick: 0, feedFilter: 'all', locTarget: 'N1', twPending: null
  };

  /* ======================= data accessors ======================= */
  function D() { return S.data || {}; }
  function DV() { return obj(get(D(), 'derived', {})); }
  function M() { return obj(get(DV(), 'metrics', {})); }
  function SER() { return obj(get(DV(), 'series', {})); }
  function nodes() { return arr(get(D(), 'nodes', [])); }
  function node(id) {
    var n = nNum(id), list = nodes();
    for (var i = 0; i < list.length; i++) {
      var x = list[i] || {};
      if (nNum(x.id) === n || num(x.num) === n) return x;
    }
    return {};
  }
  function macAddr(n) {
    if (typeof n.mac === 'string') return n.mac;
    return n.mac_addr || n.macaddr || n.mac_address || (nNum(n.id) === 4 ? get(D(), 'sink_mac', null) : null);
  }
  function macCnt(n) { return obj(typeof n.mac === 'object' ? n.mac : (n.mac_counters || n.mac_stats)); }
  function positions() {
    var p = obj(get(D(), 'localization.positions_true', null));
    var out = {};
    NODE_IDS.forEach(function (id) {
      var v = p[id];
      out[id] = Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null ? [num(v[0]), num(v[1])] : DEFAULT_POS[id];
    });
    return out;
  }
  function link(a, b) {
    var A = nNum(a), B = nNum(b), L = arr(get(D(), 'links', []));
    for (var i = 0; i < L.length; i++) {
      var l = L[i] || {};
      var la = nNum(l.a), lb = nNum(l.b);
      if ((la === A && lb === B) || (la === B && lb === A)) return l;
    }
    return null;
  }
  function linkState(a, b) {
    var l = link(a, b);
    if (!l) return 'unknown';
    if (l.blocked === true || l.up === false) return 'down';
    return 'up';
  }
  function sensorText(n) {
    var id = nId(n.id || n.num);
    if (id === 'N4') { var L = lightOf(); return { v: (LIGHT[L.state] || LIGHT.off).label.split(' · ')[0], u: 'status light' }; }
    if (id === 'N1' || id === 'N3') { var t = tempC(n.value); return { v: t === null ? '—' : fmt(t, 2), u: '°C' }; }
    var unit = String(n.unit || 'raw ADC');
    unit = /raw\s*adc/i.test(unit) ? 'raw ADC' : unit.replace(/\s*\(.*\)\s*$/, '');
    return { v: num(n.value) === null ? '—' : fmtI(n.value), u: unit };
  }
  /* §9.1 nodes[].threshold → chip: N1 hot/normal (TEMP_WARN), N2 turbid/clear; null for N3/N4 */
  function thresholdChip(n) {
    var id = nId(n.id || n.num), th = n.threshold;
    if (id !== 'N1' && id !== 'N2') return '';
    if (th !== true && th !== false) return chip(id === 'N1' ? 'alert flag: —' : 'turbidity flag: —', '');
    if (id === 'N1') return th ? chip('hot', 'warn') : chip('normal', '');
    return th ? chip('turbid', 'bad') : chip('clear', '');
  }
  function lightOf() {
    var l = obj(get(D(), 'light', {}));
    var st = String(l.state || 'off').toLowerCase();
    return { state: LIGHT[st] ? st : 'off', reason: l.reason || '', since: num(l.since), pins: obj(l.pins) };
  }
  function netNow() {
    var d = D(), base = num(d.net_time);
    if (base === null) return null;
    var age = num(get(d, 'derived.age_s', 0)) || 0;
    var elapsed = S.fetchOk ? performance.now() - S.recvPerf : 0;
    return base + age * 1000 + elapsed;
  }
  function ageNow() {
    if (!S.everOk) return null;
    return (num(get(D(), 'derived.age_s', 0)) || 0) + (performance.now() - S.recvPerf) / 1000;
  }
  function isOnline() { return S.fetchOk && get(D(), 'derived.online', true) !== false; }
  function whenStr(row) { // prefer the server wall-clock received_at ("2026-10-11T10:00:00")
    var rr = row && row.received_at;
    if (rr) { var mm = /(\d{2}:\d{2}:\d{2})/.exec(String(rr)); return mm ? mm[1] : String(rr); }
    return tAgo(row && row.t);
  }
  function tAgo(t) { var nn = netNow(), tt = num(t); return nn === null || tt === null ? '—' : fmtAgo((nn - tt) / 1000); }
  function netT(t) { var tt = num(t); return tt === null ? '—' : 't=' + fmt(tt / 1000, 1) + ' s'; }
  function demoFlow() { return obj(get(DV(), 'demo_flow', {})); }

  /* ======================= chart registry ======================= */
  function chartColorsBase() {
    return { grid: cssVar('--border'), tick: cssVar('--muted'), text: cssVar('--text'), surface: cssVar('--surface'), border: cssVar('--border-strong') };
  }
  /* area fill: series colour at ~22 % alpha at the top fading to 0 at the bottom (Grafana "opacity" gradient) */
  function areaFill(col) {
    return function (ctx) {
      var area = ctx.chart.chartArea;
      if (!area) return 'transparent';
      var g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, col + '3a'); g.addColorStop(1, col + '00');
      return g;
    };
  }
  function tooltipStyle(c, cb) {
    return { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, cornerRadius: 8, padding: 10,
      titleColor: c.tick, titleFont: { size: 11, weight: '500' }, bodyColor: c.text, bodyFont: { family: MONO_FONT, size: 12 },
      displayColors: true, boxWidth: 8, boxHeight: 8, boxPadding: 4, usePointStyle: true, callbacks: cb || {} };
  }
  var MONO_FONT = '"Geist Mono", ui-monospace, Menlo, monospace';
  function lineChart(id, sets, opt) {
    if (S.charts[id]) return S.charts[id];
    var el = $(id);
    if (!el || !window.Chart) return null;
    opt = opt || {};
    var c = chartColorsBase();
    var scales = {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: c.tick, maxTicksLimit: 6, maxRotation: 0, font: { size: 11, family: MONO_FONT }, padding: 6 } },
      y: { grid: { color: c.grid, drawTicks: false }, border: { display: false, dash: [3, 4] }, ticks: { color: c.tick, font: { size: 11, family: MONO_FONT }, padding: 8 }, title: { display: !!opt.yTitle, text: opt.yTitle || '', color: c.tick, font: { size: 11 } }, suggestedMin: opt.min, suggestedMax: opt.max }
    };
    if (opt.y2) scales.y2 = { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: c.tick, font: { size: 11, family: MONO_FONT }, padding: 8 }, title: { display: true, text: opt.y2, color: c.tick, font: { size: 11 } } };
    if (opt.y3) scales.y3 = { position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: c.tick, font: { size: 11, family: MONO_FONT }, padding: 8 }, title: { display: true, text: opt.y3, color: c.tick, font: { size: 11 } } };
    var ch = new Chart(el, {
      type: 'line',
      data: {
        labels: [], datasets: sets.map(function (s) {
          var col = cssVar(s.cv);
          return { label: s.label, data: [], borderColor: col, backgroundColor: s.fill ? areaFill(col) : col + '33', fill: !!s.fill, yAxisID: s.axis || 'y', _cv: s.cv, borderWidth: s.width || (s.dash ? 2 : 1.75), order: s.dash ? 0 : 1, borderDash: s.dash || [], pointStyle: s.point || 'circle', pointRadius: s.point ? 2.5 : 0, pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBackgroundColor: c.surface, tension: .3, spanGaps: true, stepped: !!s.stepped };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 16 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: sets.length > 1, position: 'bottom', align: 'start', labels: { color: c.tick, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', padding: 14, font: { size: 11.5 } } },
          tooltip: tooltipStyle(c, { label: function (ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y, opt.dec == null ? 1 : opt.dec) + (opt.unit ? ' ' + opt.unit : ''); } })
        },
        scales: scales
      }
    });
    ch._sets = sets;
    S.charts[id] = ch;
    return ch;
  }
  function seriesLabels(n) {
    var t = arr(SER().t);
    t = t.slice(Math.max(0, t.length - n));
    if (!t.length) return new Array(n).fill('');
    var last = num(t[t.length - 1]);
    var scale = last !== null && last > 1e9 && last < 1e11 ? 1000 : 1; // epoch seconds → ms
    if (typeof t[t.length - 1] === 'string' && num(t[t.length - 1]) === null) {
      var lab = t.map(function (x) { return x == null ? '' : String(x); });
      while (lab.length < n) lab.unshift('');
      return lab;
    }
    var out = t.map(function (x) {
      var v = num(x);
      if (v === null || last === null) return '';
      var rel = Math.round((v - last) * scale / 1000);
      return rel === 0 ? 'now' : rel + ' s';
    });
    while (out.length < n) out.unshift('');
    return out;
  }
  function updateLine(id, sets) {
    var ch = S.charts[id];
    if (!ch) return;
    var ser = SER();
    var data = ch._sets.map(function (s) {
      var a = typeof s.key === 'function' ? s.key(ser) : arr(ser[s.key]);
      return a.map(function (v) { var n = num(v); return n === null ? null : (s.map ? s.map(n) : n); });
    });
    var n = Math.max.apply(null, data.map(function (a) { return a.length; }).concat([0]));
    ch.data.labels = seriesLabels(n);
    data.forEach(function (a, i) {
      while (a.length < n) a.unshift(null);
      ch.data.datasets[i].data = a;
    });
    ch.update('none');
  }
  function donutChart(id) {
    if (S.charts[id]) return S.charts[id];
    var el = $(id);
    if (!el || !window.Chart) return null;
    var c = chartColorsBase();
    var ch = new Chart(el, {
      type: 'doughnut',
      data: { labels: ['HELLO', 'SCHED', 'CTRL', 'DATA', 'AGG', 'STAT', 'ACK'], datasets: [{ data: [0, 0, 0, 0, 0, 0, 0], borderWidth: 2, borderColor: cssVar('--surface'), hoverOffset: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, cutout: '72%',
        plugins: { legend: { position: 'right', labels: { color: c.tick, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', padding: 10, font: { size: 11.5 } } }, tooltip: tooltipStyle(c) }
      }
    });
    S.charts[id] = ch;
    recolorDonut(ch);
    return ch;
  }
  function recolorDonut(ch) {
    var a = cssVar('--accent'), b = cssVar('--n2');
    ch.data.datasets[0].backgroundColor = [a, a + 'b0', a + '70', b, b + 'c8', b + '90', b + '58'];
    ch.data.datasets[0].borderColor = cssVar('--surface');
  }
  function recolorCharts() {
    var c = chartColorsBase();
    Object.keys(S.charts).forEach(function (k) {
      var ch = S.charts[k];
      if (ch.config.type === 'doughnut') { recolorDonut(ch); ch.options.plugins.legend.labels.color = c.tick; var dt = ch.options.plugins.tooltip; dt.backgroundColor = c.surface; dt.borderColor = c.border; dt.bodyColor = c.text; }
      else {
        ch.data.datasets.forEach(function (ds) { var col = cssVar(ds._cv); ds.borderColor = col; ds.backgroundColor = ds.fill ? areaFill(col) : col + '33'; ds.pointHoverBackgroundColor = c.surface; });
        var tt = ch.options.plugins.tooltip; tt.backgroundColor = c.surface; tt.borderColor = c.border; tt.bodyColor = c.text; tt.titleColor = c.tick;
        ['x', 'y', 'y2', 'y3'].forEach(function (ax) {
          var s = ch.options.scales[ax];
          if (!s) return;
          if (s.ticks) s.ticks.color = c.tick;
          if (s.grid && s.grid.color) s.grid.color = c.grid;
          if (s.title) s.title.color = c.tick;
        });
        ch.options.plugins.legend.labels.color = c.tick;
      }
      ch.update('none');
    });
  }

  /* ======================= shared rendering pieces ======================= */
  function header(v) {
    var m = VIEWS[v];
    return '<div class="vh"><h1 id="h-' + v + '">' + esc(m.title) +
      (m.marks ? ' <span class="marks">Rubric ' + m.n + ' · ' + esc(m.marks) + '</span>' : '') +
      '</h1><div class="proves"><b>What this proves</b><span>' + esc(m.proves) + '</span></div></div>';
  }
  function card(title, sub, body, cls, extraHead) {
    return '<div class="card ' + (cls || '') + '"><div class="card-head"><div><h2>' + esc(title) + '</h2>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (extraHead || '') + '</div>' + body + '</div>';
  }
  function cmdBtn(label, cmd, cls) {
    return '<button type="button" class="btn ' + (cls || '') + '" data-cmd=\'' + esc(JSON.stringify(cmd)) + '\'>' + esc(label) + '</button>';
  }
  function kpi(id, label, cls) {
    return '<div class="card kpi ' + (cls || '') + '" id="' + id + '"><span class="k">' + esc(label) + '</span><span class="v">—</span><span class="s">&nbsp;</span></div>';
  }
  function setKpi(id, label, valueHTML, sub, tone) {
    var el = $(id);
    if (!el) return;
    el.className = 'card kpi ' + (tone || '');
    var html = '<span class="k">' + esc(label) + '</span><span class="v">' + valueHTML + '</span><span class="s">' + (sub || '&nbsp;') + '</span>';
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  function toneHi(v, good, ok) { var n = num(v); if (n === null) return ''; return n >= good ? 'ok' : n >= ok ? 'warn' : 'bad'; }
  function toneLo(v, good, ok) { var n = num(v); if (n === null) return ''; return n <= good ? 'ok' : n <= ok ? 'warn' : 'bad'; }

  /* ---------- topology SVG (overview + routing) ---------- */
  function topoGeom(W, H, pad, marginCm) {
    var P = positions(), xs = [], ys = [], mc = marginCm || 0;
    NODE_IDS.forEach(function (id) { xs.push(P[id][0]); ys.push(P[id][1]); });
    var minX = Math.min.apply(null, xs) - mc, maxX = Math.max.apply(null, xs) + mc;
    var minY = Math.min.apply(null, ys) - mc, maxY = Math.max.apply(null, ys) + mc;
    var sx = (W - 2 * pad) / Math.max(1, maxX - minX), sy = (H - 2 * pad) / Math.max(1, maxY - minY);
    var s = Math.min(sx, sy);
    var ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
    function m(p) { return [ox + (p[0] - minX) * s, H - (oy + (p[1] - minY) * s)]; } // y up
    return { P: P, m: m, s: s, minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }
  function buildTopoSVG(id) {
    return '<svg id="' + id + '" viewBox="0 0 640 420" role="img" aria-label="Network topology map, nodes at their true positions in cm">' +
      '<g class="g-grid"></g><g class="g-links"></g><g class="g-routes"></g><g class="g-nodes"></g></svg>';
  }
  function renderTopo(id) {
    var svg = $(id);
    if (!svg) return;
    var W = 640, H = 420, G = topoGeom(W, H, 72);
    // grid every 30 cm
    var grid = '';
    for (var gx = Math.ceil((G.minX - 30) / 30) * 30; gx <= G.maxX + 30; gx += 30) {
      var a = G.m([gx, G.minY - 40]), b = G.m([gx, G.maxY + 40]);
      grid += '<line class="grid-line" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
    }
    for (var gy = Math.ceil((G.minY - 30) / 30) * 30; gy <= G.maxY + 30; gy += 30) {
      var c = G.m([G.minX - 60, gy]), e = G.m([G.maxX + 60, gy]);
      grid += '<line class="grid-line" x1="' + c[0] + '" y1="' + c[1] + '" x2="' + e[0] + '" y2="' + e[1] + '"/>';
    }
    grid += '<text class="axis" x="8" y="14">grid = 30 cm · positions from NODE_POS</text>';
    var gg = svg.querySelector('.g-grid');
    if (gg.innerHTML !== grid) gg.innerHTML = grid;

    // links
    var links = '';
    var cen = [0, 0];
    NODE_IDS.forEach(function (id) { var q = G.m(G.P[id]); cen[0] += q[0] / 4; cen[1] += q[1] / 4; });
    ALL_PAIRS.forEach(function (pr) {
      var A = G.m(G.P['N' + pr[0]]), B = G.m(G.P['N' + pr[1]]);
      var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      var dx = B[0] - A[0], dy = B[1] - A[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len, ny = dx / len;
      if (nx * (mx - cen[0]) + ny * (my - cen[1]) < 0) { nx = -nx; ny = -ny; }
      if (pr[0] === 1 && pr[1] === 4) { // not allowed: label near N1 (¼ of the way), to the right, clear of the N3–N4 line
        nx = 1; ny = 0; mx = A[0] + dx * 0.25; my = A[1] + dy * 0.25;
      }
      mx += nx * 12; my += ny * 12 + 4;
      var anc = nx > 0.3 ? 'start' : nx < -0.3 ? 'end' : 'middle'; // grow the text away from the line
      if (pr[0] === 1 && pr[1] === 4) {
        links += '<line class="link" stroke-dasharray="2 6" x1="' + A[0] + '" y1="' + A[1] + '" x2="' + B[0] + '" y2="' + B[1] + '" opacity=".6"/>' +
          '<text class="link-lbl" style="text-anchor:start" x="' + mx + '" y="' + my + '">not in range</text>';
        return;
      }
      var st = linkState(pr[0], pr[1]), l = link(pr[0], pr[1]) || {};
      links += '<line class="link ' + st + '" x1="' + A[0] + '" y1="' + A[1] + '" x2="' + B[0] + '" y2="' + B[1] + '"><title>N' + pr[0] + '–N' + pr[1] + ': ' + (st === 'down' ? 'DOWN / blocked' : st) + '</title></line>';
      var lbl = st === 'down' ? '✕ link down' : (num(l.ack_pct) !== null ? 'ACK ' + fmtI(l.ack_pct) + ' %' : '');
      if (lbl) links += '<text class="link-lbl' + (st === 'down' ? ' bad' : '') + '" style="text-anchor:' + anc + '" x="' + mx + '" y="' + my + '">' + esc(lbl) + '</text>';
    });
    var gl = svg.querySelector('.g-links');
    if (gl.innerHTML !== links) gl.innerHTML = links;

    // routes (rebuilt only when changed so the animation does not restart)
    var routes = [], key = '';
    ['N1', 'N2', 'N3'].forEach(function (nid) {
      var n = node(nid);
      if (String(n.status || '').toLowerCase() === 'inactive') return;
      var r = String(n.route || '');
      var hops = r.split('>').map(function (h) { return nNum(h); }).filter(function (h) { return h >= 1 && h <= 4; });
      if (hops.length < 2) return;
      key += nid + ':' + hops.join('>') + ';';
      routes.push({ nid: nid, hops: hops });
    });
    if (S.routeKey[id] !== key) {
      S.routeKey[id] = key;
      var html = '';
      routes.forEach(function (rt, idx) {
        var off = (idx - 1) * 4; // small offset so overlapping routes stay visible
        var pts = rt.hops.map(function (h) { var p = G.m(G.P['N' + h]); return [p[0] + off, p[1] + off]; });
        var d = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
        var col = 'var(' + NODE_COLOR[rt.nid] + ')';
        var dur = (0.9 * (rt.hops.length - 1) + 0.6).toFixed(1);
        html += '<path class="route" d="' + d + '" style="stroke:' + col + '"/><path class="route-core" d="' + d + '" style="stroke:' + col + '"/>';
        html += '<circle class="pkt" r="6" style="fill:' + col + '"><animateMotion dur="' + dur + 's" begin="-' + (idx * 0.45 + 0.01).toFixed(2) + 's" repeatCount="indefinite" path="' + d + '"/></circle>';
      });
      svg.querySelector('.g-routes').innerHTML = html;
    }

    // nodes
    var nh = '';
    NODE_IDS.forEach(function (nid) {
      var n = node(nid), p = G.m(G.P[nid]);
      var inactive = String(n.status || '').toLowerCase() === 'inactive';
      var sv = sensorText(n);
      var pl = nid === 'N4' ? { x: p[0], cy: p[1] - 32, vy: null, a: 'middle' } :
        nid === 'N1' ? { x: p[0] + 30, cy: p[1] - 8, vy: p[1] + 8, a: 'start' } :
          { x: p[0], cy: p[1] + 38, vy: p[1] + 53, a: 'middle' };
      nh += '<g>' + (inactive ? '' : '<circle class="halo" cx="' + p[0] + '" cy="' + p[1] + '" r="27" style="stroke:var(' + NODE_COLOR[nid] + ')"/>') +
        '<circle class="node-circle' + (inactive ? ' inactive' : '') + '" cx="' + p[0] + '" cy="' + p[1] + '" r="21" style="fill:var(' + NODE_COLOR[nid] + ')"><title>' + nid + ' ' + esc(n.role || SHORT_ROLE[nid]) + '</title></circle>' +
        '<text class="node-label" x="' + p[0] + '" y="' + p[1] + '">' + nid + '</text>' +
        '<text class="node-cap" style="text-anchor:' + pl.a + '" x="' + pl.x + '" y="' + pl.cy + '">' + esc(SHORT_ROLE[nid]) + (inactive ? ' · inactive' : '') + '</text>' +
        (pl.vy !== null ? '<text class="node-val" style="text-anchor:' + pl.a + '" x="' + pl.x + '" y="' + pl.vy + '">' + esc(sv.v + ' ' + sv.u) + '</text>' : '') +
        '</g>';
    });
    var gn = svg.querySelector('.g-nodes');
    if (gn.innerHTML !== nh) gn.innerHTML = nh;
  }
  var TOPO_LEGEND = '<div class="legend"><span><i class="sw"></i>link up</span><span><i class="sw dash"></i>link down / blocked</span>' +
    '<span><i class="sw route"></i>current route</span><span><i class="sw dot" style="background:var(--n1);color:var(--n1)"></i>N1 packet</span>' +
    '<span><i class="sw dot" style="background:var(--n2);color:var(--n2)"></i>N2 packet</span><span><i class="sw dot" style="background:var(--n3);color:var(--n3)"></i>N3 AGG</span></div>';

  /* ---------- slot helpers ---------- */
  function schedule() { return obj(get(D(), 'schedule', {})); }
  function slotInfo(i, slots, master) {
    var o = num(slots[i]);
    if (o === 0) return { cls: 'control', owner: 'ALL', kind: 'CONTROL · CSMA (HELLO, CTRL)' };
    if (o === 255 || o === null) return { cls: 'unused', owner: 'UNUSED', kind: 'Everyone sleeps' };
    if (i === 0) return { cls: 'beacon', owner: 'N' + o, kind: 'BEACON · SCHED broadcast' + (num(master) === 4 ? ' (backup)' : '') };
    var first = slots.indexOf(slots[i], 1) === i; // first non-beacon slot of this owner
    var kind = o === 3 ? 'AGG + STAT → N4' : o === 4 ? 'Sink TX' : (first ? 'DATA + STAT' : 'Retransmission slot');
    return { cls: 'owner-' + o, owner: 'N' + o, kind: kind };
  }
  function currentSlot() {
    var sc = schedule(), t0 = num(sc.t0), sl = num(sc.slot_ms) || 500, n = arr(sc.slots).length || 6, nn = netNow();
    if (t0 === null || nn === null) return null;
    var sfMs = sl * n, ph = ((nn - t0) % sfMs + sfMs) % sfMs;
    return { idx: Math.floor(ph / sl), frac: ph / sfMs, n: n, sl: sl, sfOff: Math.floor((nn - t0) / sfMs) };
  }

  /* ======================= views: build (skeleton) + render ======================= */
  var V = {};

  /* ---------- Overview ---------- */
  V.overview = {
    build: function () {
      return header('overview') +
        '<div class="grid g-main">' +
        '<div class="card hero-map"><div class="card-head"><div><h2>Live network topology</h2><p class="sub">Nodes at their true positions in cm. Moving dots follow each node\'s current route to the sink.</p></div><span class="chip accent" id="ovRouteChip">—</span></div>' +
        '<div class="map-stage"><div class="topo">' + buildTopoSVG('topoMain') + '</div></div>' + TOPO_LEGEND + '</div>' +
        '<div class="hero-side">' +
        card('Live readings', 'Latest sample from each sensor node.', '<div class="readouts" id="ovSensors"></div>') +
        lightCard('ov', true) +
        card('Network at a glance', '', '<dl class="kv" id="ovGlance"></dl>') +
        '</div></div>' +
        '<div class="grid g6 mt" id="ovKpis">' +
        kpi('k-pdr', 'Packet delivery ratio') + kpi('k-delay', 'End-to-end delay') + kpi('k-thr', 'Throughput at sink') +
        kpi('k-retx', 'Retransmissions') + kpi('k-loc', 'Localization error N1') + kpi('k-red', 'Data reduction') +
        '</div>' +
        '<div class="mt">' + card('Demonstration flow', 'The integrated sequence required by the guideline (§5). Steps tick automatically when the network shows the behaviour. Click a step to open its view.',
          '<div class="progress"><i id="ovProg" style="width:0"></i></div><div class="stepper" id="ovSteps"></div>', '', '<span class="chip accent" id="ovProgTxt">—</span>') + '</div>' +
        '<div class="mt">' + card('What AquaSense does', 'Hybrid BLE + Wi-Fi wireless sensor network for fish-pond water quality.',
          '<div class="usecase"><p>Two sensor nodes sit at the pond edge: N2 holds the <b>turbidity probe</b> in the water (the only external sensor), N1 reports the <b>temperature inside its own electronics enclosure</b> from the ESP32 on-chip sensor, with an <b>over-temperature alert</b> whose threshold the farmer sets from this dashboard. The cluster head on the bank (N3) aggregates both and adds its own enclosure temperature (same on-chip sensor). The sink in the farm office (N4) feeds this dashboard and drives a <b>pond status light</b> (a red and a green LED). BLE localization shows where a sensor float sits relative to the fixed anchors, and multi-hop routing with route recovery keeps data flowing when a bank-side link is blocked.</p></div>') + '</div>';
    },
    render: function () {
      renderTopo('topoMain');
      var sens = ['N1', 'N2', 'N3'].map(function (id) {
        var n = node(id), s = sensorText(n), k = nNum(id);
        var st = String(n.status || '').toLowerCase() === 'active' ? 'active' : 'inactive';
        var flag = thresholdChip(n) || (id === 'N3' ? chip('uncalibrated', '') : '');
        return '<div class="readout"><div class="rl"><span class="rk">' + esc(READING_LABEL[id]) + '</span><span class="rs">' + id + ' · ' + st + ' ' + flag + '</span></div>' +
          '<span class="rv"><i class="ri n' + k + '"></i>' + esc(s.v) + '<small>' + esc(s.u) + '</small></span></div>';
      }).join('');
      setHTML('ovSensors', sens);
      renderLight('ov');
      var r1 = String(node('N1').route || ''); setText('ovRouteChip', r1 ? 'N1 route ' + r1.split('>').map(function (h) { return 'N' + nNum(h); }).join(' → ') : 'Waiting for routes');
      var d = D(), active = nodes().filter(function (n) { return String(n.status).toLowerCase() === 'active'; }).length;
      setHTML('ovGlance',
        '<dt>Active nodes</dt><dd>' + active + ' / 4</dd>' +
        '<dt>Data source</dt><dd>' + esc(sourceLabel()) + '</dd>' +
        '<dt>Wi-Fi channel</dt><dd>' + esc(get(d, 'channel', '—')) + '</dd>' +
        '<dt>Scheduler (time master)</dt><dd>' + esc(nId(get(d, 'sched_master', get(d, 'schedule.master', null)))) + '</dd>' +
        '<dt>Schedule version</dt><dd>v' + esc(get(d, 'schedule.ver', '—')) + ' · ' + esc(get(d, 'schedule.why', '—')) + '</dd>' +
        '<dt>N1 route</dt><dd>' + pathHTML(node('N1').route) + '</dd>' +
        '<dt>Sink uptime</dt><dd>' + esc(fmtDur(get(d, 'uptime_s', null))) + '</dd>');
      renderKpis();
      var df = demoFlow(), done = 0;
      var steps = DEMO_STEPS.map(function (s, i) {
        var ok = df[s.k] === true;
        if (ok) done++;
        return '<a class="step' + (ok ? ' done' : '') + '" href="#' + s.v + '" title="' + esc(s.see) + '"><span class="sn">' + (ok ? '✓' : i + 1) + '</span><span>' + esc(s.k) + '</span></a>';
      }).join('');
      setHTML('ovSteps', steps);
      var p = $('ovProg'); if (p) p.style.width = (done / DEMO_STEPS.length * 100).toFixed(1) + '%';
      setText('ovProgTxt', done + ' of ' + DEMO_STEPS.length + ' shown');
    }
  };
  function renderKpis() {
    var m = M();
    var pdr = mean(Object.keys(obj(m.pdr)).map(function (k) { return m.pdr[k]; }));
    var lost = num(m.lost_total), rx = num(m.rx_total);
    setKpi('k-pdr', 'Packet delivery ratio', fmtU(pdr, 1, '%'), lost !== null && rx !== null ? esc(fmtI(lost) + ' lost of ' + fmtI(lost + rx) + ' expected') : 'average of N1–N3', toneHi(pdr, 95, 85));
    var dl = obj(m.delay_ms);
    var davg = mean(Object.keys(dl).map(function (k) { return get(dl[k], 'avg', null); }));
    setKpi('k-delay', 'End-to-end delay', fmtU(davg, 0, 'ms'), 'avg · N3 ' + esc(fmtI(get(dl, 'N3.avg', null), 'ms')) + ' (1 hop)');
    var thr = num(get(m, 'throughput_bps.total', null));
    var thrB = num(get(m, 'throughput_Bps.total', null)); if (thrB === null && thr !== null) thrB = thr / 8;
    setKpi('k-thr', 'Throughput at sink', fmtU(thr, 0, 'bps'), thrB !== null ? esc('= ' + fmt(thrB, 1) + ' B/s · 30 s window') : '30 s window');
    var to = num(get(m, 'timeouts.total', null)); if (to === null) to = sum(nodes().map(function (n) { return macCnt(n).to; }));
    setKpi('k-retx', 'Retransmissions', fmtU(get(m, 'retransmissions.total', null), 0, ''), 'ACK timeouts: ' + esc(fmtI(to)));
    var le = get(m, 'loc_err_cm.N1', {});
    setKpi('k-loc', 'Localization error N1', fmtU(get(le, 'last', null), 1, 'cm'), 'avg ' + esc(fmt(get(le, 'avg', null), 1, 'cm')), toneLo(get(le, 'last', null), 20, 40));
    setKpi('k-red', 'Data reduction', fmtU(get(m, 'reduction_pct.packets', null), 1, '%'), 'packets · bytes ' + esc(fmt(get(m, 'reduction_pct.bytes', null), 1, '%')));
  }

  /* ---------- R1 Architecture ---------- */
  V.r1 = {
    build: function () {
      return header('r1') +
        '<div class="grid g4" id="r1Nodes"></div>' +
        '<div class="grid g2 mt">' + lightCard('r1', false) + '<div class="stack">' + tempWarnCard('r1') +
        card('Status light history', 'Every change of the light state reported by the sink, newest first (last 30).', '<div class="feed" id="r1LightHist"></div>') +
        '</div></div>' +
        '<div class="grid g2 mt">' +
        card('Addressing', 'Logical IDs are fixed in config.h; ESP-NOW MACs are learned from HELLO frames (none hard-coded).', '<div class="tbl-wrap" id="r1Addr"></div>') +
        card('Allowed topology (simulated radio range)', 'Frames from a non-allowed neighbour are dropped and counted as out-of-range, forcing real multi-hop.', '<div class="tbl-wrap" id="r1Allowed"></div>') +
        '</div>' +
        '<div class="mt">' + card('Wiring summary', 'All boards: ESP32 DevKit V1 (ESP32-WROOM-32, 30-pin). One sketch, role chosen by NODE_ID in config.h. The only external parts are the turbidity module and two LEDs.', '<div class="grid g4" id="r1Wiring"></div>') + '</div>';
    },
    render: function () {
      var d = D(), sc = schedule(), slots = arr(sc.slots);
      setHTML('r1Nodes', NODE_IDS.map(function (id) {
        var n = node(id), s = sensorText(n), k = nNum(id);
        var own = slots.map(function (o, i) { return num(o) === k ? i : null; }).filter(function (x) { return x !== null; });
        return '<div class="card node-card"><div class="node-top"><div class="node-avatar n' + k + '">' + id + '</div><div><div class="node-title">' + esc(SHORT_ROLE[id]) + '</div><div class="node-role">' + esc(n.role || '—') + '</div></div>' + statusChip(n.status) + '</div>' +
          '<div class="node-value">' + esc(s.v) + ' <small>' + esc(s.u) + '</small></div>' +
          nodeFlags(n) +
          '<dl class="kv">' +
          '<dt>Sensor</dt><dd>' + esc(n.sensor || '—') + '</dd>' +
          (n.unit ? '<dt>Unit</dt><dd>' + esc(n.unit) + '</dd>' : '') +
          (id === 'N1' ? '<dt>Alert threshold</dt><dd>' + esc(twText(n.temp_warn)) + '</dd>' : '') +
          '<dt>MAC</dt><dd>' + esc(macAddr(n) || '—') + '</dd>' +
          (id === 'N4' ? '<dt>IP (hotspot)</dt><dd>' + esc(get(d, 'sink_ip', '—')) + '</dd>' : '') +
          '<dt>Channel</dt><dd>' + esc(get(d, 'channel', '—')) + '</dd>' +
          '<dt>Uptime</dt><dd>' + esc(fmtDur(n.uptime_s)) + '</dd>' +
          '<dt>Last heard</dt><dd>' + esc(num(n.last_seen_s) === null ? '—' : fmtAgo(n.last_seen_s)) + '</dd>' +
          '<dt>TDMA slot</dt><dd>' + (own.length ? own.join(', ') : (id === 'N4' ? 'listens' : '—')) + '</dd>' +
          '<dt>Next hop</dt><dd>' + (id === 'N4' ? 'is the sink' : esc(nId(n.next_hop))) + '</dd>' +
          '</dl></div>';
      }).join(''));
      setHTML('r1Addr', '<table><thead><tr><th>Node</th><th>ID</th><th>BLE name</th><th>ESP-NOW MAC</th><th>IP</th><th>Slot</th></tr></thead><tbody>' +
        NODE_IDS.map(function (id) {
          var n = node(id), k = nNum(id);
          var own = slots.map(function (o, i) { return num(o) === k ? i : null; }).filter(function (x) { return x !== null; });
          return '<tr><td><b>' + id + '</b></td><td class="num">' + k + '</td><td class="mono">WSN-N' + k + '</td><td class="mono">' + esc(macAddr(n) || '—') + '</td><td class="mono">' + (id === 'N4' ? esc(get(d, 'sink_ip', '—')) : '—') + '</td><td class="num">' + (own.length ? own.join(', ') : '—') + '</td></tr>';
        }).join('') +
        '<tr><td><b>All</b></td><td class="num">0</td><td>—</td><td class="mono">FF:FF:FF:FF:FF:FF</td><td>—</td><td>broadcast</td></tr></tbody></table>');
      setHTML('r1Allowed', '<table><thead><tr><th>Link</th><th>Allowed</th><th>Status now</th><th>Note</th></tr></thead><tbody>' +
        ALL_PAIRS.map(function (p) {
          if (p[0] === 1 && p[1] === 4) return '<tr><td><b>N1–N4</b></td><td>' + chip('No', 'bad') + '</td><td>—</td><td class="small muted">N1 must multi-hop to reach the sink</td></tr>';
          var st = linkState(p[0], p[1]);
          var stc = st === 'up' ? chip('Up', 'ok') : st === 'down' ? chip('Down / blocked', 'bad') : chip('Not seen', '');
          var note = { '1-2': 'alternate path for N1', '1-3': 'N1 primary to cluster head', '2-3': 'N2 primary to cluster head', '2-4': 'N2 alternate direct to sink', '3-4': 'cluster head → sink (AGG)' }[p[0] + '-' + p[1]];
          return '<tr><td><b>N' + p[0] + '–N' + p[1] + '</b></td><td>' + chip('Yes', 'ok') + '</td><td>' + stc + '</td><td class="small muted">' + note + '</td></tr>';
        }).join('') + '</tbody></table>');
      setHTML('r1Wiring', NODE_IDS.map(function (id) {
        return '<div class="wiring"><div class="wiring-title">' + id + ' · ' + esc(SHORT_ROLE[id]) + '</div><ul class="wiring-list">' + WIRING[id].map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
      }).join(''));
      renderLight('r1');
      renderTempWarn('r1');
      var lh = arr(get(DV(), 'light_history', [])).slice().reverse();
      setHTML('r1LightHist', lh.length ? '<ul class="tl">' + lh.map(function (h) {
        var st = LIGHT[String(h.state || '').toLowerCase()] ? String(h.state).toLowerCase() : 'off';
        return '<li class="' + (LIGHT[st].tone || 'off') + '"><div class="when">' + esc(netT(h.t)) + ' · ' + esc(whenStr(h)) + '</div><b>' + esc(LIGHT[st].label) + '</b> <span class="muted">' + esc(h.reason || '') + '</span></li>';
      }).join('') + '</ul>' : '<div class="empty">No light changes yet. The sink reports the light with every uplink; each change of state is listed here.</div>');
    }
  };
  function nodeFlags(n) {
    var id = nId(n.id || n.num);
    var why = { N1: 'th = enclosure temperature ≥ the TEMP_WARN threshold', N2: 'th = LM393 comparator output D (trimmer pot)', N3: 'on-chip sensor, offset of several °C', N4: 'value = pond status light state, LEDs on GPIO25 (green) and GPIO27 (red)' }[id];
    var c = thresholdChip(n) || (id === 'N3' ? chip('uncalibrated', '') : '');
    return '<div class="node-flags">' + c + '<span class="small muted">' + esc(why) + '</span></div>';
  }

  /* ---------- pond status light widget (spec §9.3) — Overview + view 1 ---------- */
  var BULB_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
  function lightCard(p, compact) {
    var btn = '<button type="button" class="btn sm" id="' + p + 'LightBtn" data-light-test>' + BULB_SVG + '<span class="spinner" aria-hidden="true"></span><span>Test light</span></button>';
    var rules = compact ? '' : '<ul class="light-rules">' + ['test', 'off', 'stale', 'red', 'hot', 'green'].map(function (k) {
      return '<li>' + chip(LIGHT[k].label.split(' · ')[0], LIGHT[k].tone) + '<span>' + esc(LIGHT[k].rule) + '</span></li>';
    }).join('') + '</ul>';
    return card('Pond status light (N4)', compact ? 'Two LEDs on the sink, red and green, driven by the freshest alert flag of each sensor node.' :
      'A green and a red LED on N4 (GPIO25 / 27). The sink re-evaluates on every sample, from the freshest flag it holds per node (AGG or direct DATA), in this priority:',
      '<div class="light' + (compact ? ' compact' : '') + '">' +
        '<div class="lamp is-off' + (compact ? ' h' : '') + '" id="' + p + 'Lamp" role="img" aria-label="Status light off"><span class="lamp-dot red"></span><span class="lamp-dot green"></span></div>' +
        '<div class="light-text"><div class="light-state" id="' + p + 'LightState" aria-live="polite">—</div><div class="light-reason" id="' + p + 'LightReason">waiting for the first uplink</div><div class="light-since mono" id="' + p + 'LightSince">&nbsp;</div></div>' +
      '</div>' + rules, 'light-card', btn);
  }
  function renderLight(p) {
    var L = lightOf(), meta = LIGHT[L.state], lamp = $(p + 'Lamp');
    if (lamp) {
      var cls = 'lamp is-' + L.state + (lamp.classList.contains('h') ? ' h' : '');
      if (lamp.className !== cls) { lamp.className = cls; lamp.setAttribute('aria-label', 'Status light ' + meta.label); }
    }
    var st = $(p + 'LightState');
    if (st) { st.className = 'light-state ' + meta.tone; setText(p + 'LightState', meta.label); }
    setText(p + 'LightReason', L.reason || meta.rule);
    var nn = netNow(), pins = L.pins;
    setText(p + 'LightSince', (L.since !== null && nn !== null ? 'since ' + fmtAgo((nn - L.since) / 1000).replace(' ago', '') : 'since —') +
      (num(pins.green) !== null && num(pins.red) !== null ? ' · GPIO ' + pins.green + ' green / ' + pins.red + ' red' : ''));
    var b = $(p + 'LightBtn');
    if (b && !b.classList.contains('loading')) b.disabled = !isOnline();
  }

  /* ---------- N1 over-temperature alert threshold form (spec §9.1 TEMP_WARN) — view 1 + view 6 ---------- */
  function twText(v) { var n = num(v); return n === null ? '— (not reported yet)' : fmt(n / 100, 2, '°C'); }
  function tempWarnCard(p) {
    return card('N1 over-temperature alert threshold', 'N1 sets its alert flag th when its enclosure temperature reaches this value, and the sink then blinks its red LED (light state hot). Sent as the TEMP_WARN control broadcast (°C × 100).',
      '<form class="tw-form" id="' + p + 'TwForm" data-temp-warn="' + p + '" novalidate>' +
        '<dl class="kv" id="' + p + 'TwNow"></dl>' +
        '<div class="field" id="' + p + 'TwField">' +
          '<label for="' + p + 'TwInput">Alert threshold (°C)</label>' +
          '<div class="tw-row"><input class="input mono" id="' + p + 'TwInput" name="temp_warn" type="number" inputmode="decimal" step="' + TEMP_WARN.step + '" min="' + TEMP_WARN.minC + '" max="' + TEMP_WARN.maxC + '" placeholder="60" autocomplete="off" aria-describedby="' + p + 'TwHint ' + p + 'TwErr">' +
          '<button type="submit" class="btn primary" id="' + p + 'TwBtn"><span class="spinner" aria-hidden="true"></span><span>Set threshold</span></button></div>' +
          '<span class="hint" id="' + p + 'TwHint">Set it just below the live reading to make the pond light blink red (hot).</span>' +
          '<span class="err" id="' + p + 'TwErr" role="alert"></span>' +
        '</div>' +
      '</form>', 'tw-card');
  }
  function renderTempWarn(p) {
    var n1 = node('N1'), tw = num(n1.temp_warn), live = tempC(n1.value), pend = S.twPending;
    if (pend && (tw === pend.v || performance.now() - pend.at > 30000)) pend = S.twPending = null;
    setHTML(p + 'TwNow',
      '<dt>Current threshold</dt><dd>' + esc(twText(tw)) + (tw === TEMP_WARN.def ? ' <span class="muted small">default</span>' : '') +
        (pend ? ' ' + chip('sent ' + fmt(pend.v / 100, 2) + ' °C · waiting for N1', 'info') : '') + '</dd>' +
      '<dt>Live N1 reading</dt><dd>' + (live === null ? '—' : esc(fmt(live, 2, '°C'))) + ' ' + thresholdChip(n1) + '</dd>');
    var inp = $(p + 'TwInput'), b = $(p + 'TwBtn');
    if (inp && document.activeElement !== inp && !inp.getAttribute('data-dirty')) {
      var val = tw === null ? '' : String(Math.round(tw) / 100);
      if (inp.value !== val) inp.value = val;
    }
    if (b && !b.classList.contains('loading')) b.disabled = !isOnline();
  }
  function twValidate(p, serverMsg) {
    var inp = $(p + 'TwInput'), f = $(p + 'TwField'), err = $(p + 'TwErr');
    if (!inp || !f) return null;
    var raw = String(inp.value).trim(), c = raw === '' ? NaN : Number(raw);
    var ok = !serverMsg && isFinite(c) && c >= TEMP_WARN.minC && c <= TEMP_WARN.maxC;
    var msg = serverMsg || (raw === '' ? 'Enter a temperature in °C, from 0 to 150.' : 'Use a value from 0 to 150 °C.');
    f.classList.toggle('invalid', !ok);
    inp.setAttribute('aria-invalid', ok ? 'false' : 'true');
    if (err) err.textContent = ok ? '' : msg;
    return ok ? Math.round(c * 100) : null;
  }
  function submitTempWarn(p) {
    var inp = $(p + 'TwInput'), b = $(p + 'TwBtn');
    if (!inp || !b || b.classList.contains('loading')) return;
    var v = twValidate(p);
    if (v === null) { inp.focus(); return; }
    if (MOCK) { toast('Preview mode: “TEMP_WARN ' + fmt(v / 100, 2) + ' °C” not sent (no server). With the server running N1 gets it in the next control slot.'); return; }
    b.classList.add('loading'); b.disabled = true; b.setAttribute('aria-busy', 'true');
    fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: 'TEMP_WARN', a: 1, v: v }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (res) { if (!r.ok || res.ok === false) throw new Error(res.error || 'HTTP ' + r.status); return res; }); })
      .then(function (res) {
        S.twPending = { v: v, at: performance.now() };
        ['r1', 'r6'].forEach(function (q) { var i = $(q + 'TwInput'); if (i) { i.removeAttribute('data-dirty'); if (q !== p) i.value = String(v / 100); } });
        toast('Threshold ' + fmt(v / 100, 2) + ' °C queued' + (res && res.id != null ? ' (#' + res.id + ')' : '') + ' → the sink broadcasts TEMP_WARN in the next control slot; N1 reports it back within about two superframes');
        renderView(S.view);
      })
      .catch(function (err) { var m = err && err.message ? err.message : String(err); twValidate(p, 'Not sent: ' + m); toast('Threshold not set: ' + m, true); })
      .then(function () { b.classList.remove('loading'); b.removeAttribute('aria-busy'); b.disabled = !isOnline(); });
  }

  /* ---------- R2 BLE Localization ---------- */
  function bleMatrix() {
    var out = {};
    arr(get(D(), 'localization.matrix', [])).forEach(function (e) {
      var f = nId(e.from), t = nId(e.to);
      out[f + '>' + t] = e;
    });
    nodes().forEach(function (n) { // fall back to node.ble lists
      var f = nId(n.id);
      arr(n.ble).forEach(function (b) { var k = f + '>' + nId(b.id); if (!out[k]) out[k] = { from: f, to: nId(b.id), rssi: b.rssi, dist_cm: b.dist_cm }; });
    });
    return out;
  }
  function rssiHeat(r) {
    var n = num(r);
    if (n === null) return '';
    var t = Math.max(0, Math.min(1, (n + 90) / 45)); // -90 → 0, -45 → 1
    return 'background:color-mix(in srgb, var(--accent) ' + Math.round(10 + t * 45) + '%, transparent)';
  }
  V.r2 = {
    build: function () {
      return header('r2') +
        '<div class="grid g-main">' +
        card('2-D localization map', 'Anchors = the other three nodes. Rings = distance estimated from RSSI. Hollow = true position, filled = estimate.', '<div class="topo map-fill"><svg id="r2Map" viewBox="0 0 640 580" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Localization map"></svg></div><div class="legend" id="r2Legend"></div><div class="btns mt" id="r2TargetBtns"></div>') +
        '<div class="grid">' +
        card('Distance formula (log-distance path loss)', 'Each RSSI is EMA-smoothed first: rssi = 0.7·rssi + 0.3·new.', '<div class="formula" id="r2Formula"></div>') +
        card('Localization result', 'Weighted centroid: est = Σ wᵢ·Pᵢ / Σ wᵢ, wᵢ = 1/dᵢ². Error = <code class="mono">| est − true |</code> (Euclidean distance, cm).', '<div class="tbl-wrap" id="r2Targets"></div>') +
        '</div></div>' +
        '<div class="grid g2 mt">' +
        card('RSSI matrix (dBm)', 'Row = scanning node, column = advertiser heard. Stronger = darker.', '<div class="tbl-wrap" id="r2Matrix"></div>') +
        card('Nearest node', 'Nearest = neighbour with the highest smoothed RSSI, compared with the true geometry.', '<div class="tbl-wrap" id="r2Near"></div>') +
        '</div>' +
        '<div class="grid g2 mt">' +
        card('Distance estimates', 'Estimated from RSSI vs true distance from the table layout.', '<div class="tbl-wrap feed" id="r2Dist"></div>') +
        card('Localization error of N1 over time', 'Last 120 superframes (one sample per 3 s).', '<div class="chart-box"><canvas id="c-locerr"></canvas></div>') +
        '</div>';
    },
    init: function () { lineChart('c-locerr', [{ label: 'N1 error', key: 'loc_err_N1', cv: '--n1', fill: true }], { unit: 'cm', yTitle: 'cm', min: 0 }); },
    render: function () {
      var loc = obj(get(D(), 'localization', {})), P = positions(), mat = bleMatrix();
      var rssi1m = num(get(loc, 'params.rssi_1m', -59)), pn = num(get(loc, 'params.n', 2.2));
      // formula with a worked example
      var ex = mat['N1>N2'] || mat[Object.keys(mat)[0]];
      var exTxt = '';
      if (ex && num(ex.rssi) !== null && rssi1m !== null && pn) {
        var dm = Math.pow(10, (rssi1m - num(ex.rssi)) / (10 * pn));
        exTxt = '\n\nexample ' + nId(ex.from) + '→' + nId(ex.to) + ':  RSSI = ' + fmtI(ex.rssi) + ' dBm\nd = 10^((' + fmtI(rssi1m) + ' − (' + fmtI(ex.rssi) + ')) / (10 × ' + fmt(pn, 1) + '))\n  = <span class="hl">' + fmt(dm * 100, 0) + ' cm</span>';
      }
      setHTML('r2Formula', 'd = 10^((RSSI<sub>1m</sub> − RSSI) / (10 · n))\n\nRSSI<sub>1m</sub> = <span class="hl">' + esc(fmt(rssi1m, 0, 'dBm')) + '</span>   n = <span class="hl">' + esc(fmt(pn, 1)) + '</span>\nresult clamped to 5…1000 cm' + exTxt);

      // targets table
      var targets = arr(loc.targets);
      var t1 = null, others = [], allTargets = targets;
      targets.forEach(function (t) { if (nId(t.id) === 'N1') t1 = t; else others.push(t); });
      var head = t1 ? '<div class="grid g3" style="margin-bottom:12px"><div class="kpi ' + toneLo(t1.err_cm, 20, 40) + '"><span class="k">N1 error (demo target)</span><span class="v">' + fmtU(t1.err_cm, 1, 'cm') + '</span></div>' +
        '<div class="kpi"><span class="k">True position</span><span class="v" style="font-size:18px;white-space:normal">(' + fmt(get(t1, 'true.0', null), 0) + ', ' + fmt(get(t1, 'true.1', null), 0) + ')</span><span class="s">cm</span></div>' +
        '<div class="kpi"><span class="k">Estimated</span><span class="v" style="font-size:18px;white-space:normal">(' + fmt(get(t1, 'est.0', null), 1) + ', ' + fmt(get(t1, 'est.1', null), 1) + ')</span><span class="s">cm</span></div></div>' +
        '<p class="small muted" style="margin:0 0 6px">N1 sits inside the triangle of its anchors N2, N3, N4, so the weighted centroid works well. The other nodes are corners of the layout: a centroid can never land outside its anchors&#39; hull, so their error is large by construction (shown for completeness).</p>' : '';
      targets = others;
      setHTML('r2Targets', head + (targets.length ? '<table><thead><tr><th>Other nodes</th><th class="r">True (cm)</th><th class="r">Estimated (cm)</th><th class="r">Error</th></tr></thead><tbody>' +
        targets.map(function (t) {
          var e = num(t.err_cm);
          return '<tr><td><b>' + esc(nId(t.id)) + '</b>' + '' + '</td><td class="r num">(' + fmt(get(t, 'true.0', null), 0) + ', ' + fmt(get(t, 'true.1', null), 0) + ')</td><td class="r num">(' + fmt(get(t, 'est.0', null), 1) + ', ' + fmt(get(t, 'est.1', null), 1) + ')</td><td class="r">' + '<span class="muted num" style="white-space:nowrap">' + esc(fmt(e, 1, 'cm')) + '</span>' + '</td></tr>';
        }).join('') + '</tbody></table>' : (t1 ? '' : '<div class="empty">No localization result yet</div>')));
      targets = allTargets;

      // target buttons
      var tb = targets.map(function (t) { var id = nId(t.id); return '<button type="button" class="btn' + (id === S.locTarget ? ' primary' : '') + '" data-loc="' + id + '">Show ' + id + '</button>'; }).join('');
      setHTML('r2TargetBtns', tb);

      // matrix
      var mh = '<table class="matrix"><thead><tr><th>scanner ↓ / heard →</th>' + NODE_IDS.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
      NODE_IDS.forEach(function (r) {
        mh += '<tr><th>' + r + '</th>' + NODE_IDS.map(function (c) {
          if (r === c) return '<td class="diag">—</td>';
          var e = mat[r + '>' + c];
          return e && num(e.rssi) !== null ? '<td><span class="heat num" style="' + rssiHeat(e.rssi) + '">' + fmtI(e.rssi) + '</span></td>' : '<td class="faint">—</td>';
        }).join('') + '</tr>';
      });
      setHTML('r2Matrix', mh + '</tbody></table><p class="small muted" style="margin:8px 0 0">' + Object.keys(mat).length + ' of 12 directed pairs heard.</p>');

      // nearest
      var near = obj(loc.nearest);
      setHTML('r2Near', '<table><thead><tr><th>Node</th><th>Nearest (BLE)</th><th class="r">RSSI</th><th>Nearest (true)</th><th>Match</th></tr></thead><tbody>' +
        NODE_IDS.map(function (id) {
          var nb = near[id] || node(id).nearest;
          var e = nb ? mat[id + '>' + nId(nb)] : null;
          var best = null, bd = Infinity;
          NODE_IDS.forEach(function (o) { if (o !== id) { var dd = dist(P[id], P[o]); if (dd < bd) { bd = dd; best = o; } } });
          var ok = nb && nId(nb) === best;
          return '<tr><td><b>' + id + '</b></td><td>' + esc(nb ? nId(nb) : '—') + '</td><td class="r num">' + (e ? fmt(e.rssi, 0, 'dBm') : '—') + '</td><td>' + best + ' <span class="faint small">(' + fmt(bd, 0, 'cm') + ')</span></td><td>' + (nb ? (ok ? chip('✓', 'ok') : chip('differs', 'warn')) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>');

      // distances
      var rows = Object.keys(mat).sort().map(function (k) {
        var e = mat[k], f = nId(e.from), t = nId(e.to);
        var td = dist(P[f], P[t]), ed = num(e.dist_cm);
        return '<tr><td><b>' + f + ' → ' + t + '</b></td><td class="r num">' + fmt(e.rssi, 0, 'dBm') + '</td><td class="r num">' + fmt(ed, 0, 'cm') + '</td><td class="r num">' + fmt(td, 0, 'cm') + '</td><td class="r num">' + (ed !== null && td !== null ? fmt(ed - td, 0, 'cm') : '—') + '</td></tr>';
      }).join('');
      setHTML('r2Dist', '<table><thead><tr><th>Pair</th><th class="r">RSSI</th><th class="r">Estimated</th><th class="r">True</th><th class="r">Difference</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="empty">No BLE measurements yet</td></tr>') + '</tbody></table>');

      renderLocMap(targets);
      updateLine('c-locerr');
    }
  };
  function renderLocMap(targets) {
    var svg = $('r2Map');
    if (!svg) return;
    var W = 640, H = 580, G = topoGeom(W, H, 16, 110); // 110 cm margin keeps ~100 cm rings inside the map
    var t = null;
    targets.forEach(function (x) { if (nId(x.id) === S.locTarget) t = x; });
    if (!t) t = targets[0] || null;
    var tid = t ? nId(t.id) : 'N1';
    var html = '';
    for (var gx = Math.ceil(G.minX / 30) * 30; gx <= G.maxX; gx += 30) {
      var a = G.m([gx, G.minY - 200]), b = G.m([gx, G.maxY + 200]);
      html += '<line class="grid-line" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/><text class="axis" x="' + (a[0] + 2) + '" y="' + (H - 4) + '">' + gx + '</text>';
    }
    for (var gy = Math.ceil(G.minY / 30) * 30; gy <= G.maxY; gy += 30) {
      var c = G.m([G.minX - 200, gy]), e = G.m([G.maxX + 200, gy]);
      html += '<line class="grid-line" x1="' + c[0] + '" y1="' + c[1] + '" x2="' + e[0] + '" y2="' + e[1] + '"/><text class="axis" x="4" y="' + (c[1] - 2) + '">' + gy + '</text>';
    }
    // anchor range rings
    arr(t && t.anchors).forEach(function (an) {
      var aid = nId(an.id), r = num(an.dist_cm);
      if (!G.P[aid] || r === null) return;
      var p = G.m(G.P[aid]);
      html += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (r * G.s) + '" fill="none" style="stroke:var(' + NODE_COLOR[aid] + ')" stroke-opacity=".45" stroke-dasharray="4 4"/>' +
        '<text class="ring-lbl" x="' + (p[0] + 24) + '" y="' + (p[1] - 18) + '">d = ' + fmt(r, 0) + ' cm</text>';
    });
    // anchors
    NODE_IDS.forEach(function (id) {
      if (id === tid) return;
      var p = G.m(G.P[id]);
      html += '<rect x="' + (p[0] - 16) + '" y="' + (p[1] - 16) + '" width="32" height="32" rx="8" style="fill:var(' + NODE_COLOR[id] + ')"/><text class="node-label" x="' + p[0] + '" y="' + p[1] + '" style="font-size:12px">' + id + '</text>' +
        '<text class="node-cap" x="' + p[0] + '" y="' + (p[1] + 30) + '">anchor</text>';
    });
    if (t) {
      var tp = G.m(arr(t['true']).length === 2 ? t['true'] : G.P[tid]);
      var est = arr(t.est);
      var col = 'var(' + NODE_COLOR[tid] + ')';
      html += '<circle cx="' + tp[0] + '" cy="' + tp[1] + '" r="13" fill="none" stroke-width="3" style="stroke:' + col + '"><title>True position</title></circle>' +
        '<text class="node-cap" x="' + tp[0] + '" y="' + (Math.min(tp[1], est.length === 2 ? G.m([num(est[0]), num(est[1])])[1] : tp[1]) - 20) + '">' + tid + ' true ○ / estimate ●</text>';
      if (est.length === 2 && num(est[0]) !== null) {
        var ep = G.m([num(est[0]), num(est[1])]);
        var mx = (tp[0] + ep[0]) / 2, my = (tp[1] + ep[1]) / 2;
        html += '<line x1="' + tp[0] + '" y1="' + tp[1] + '" x2="' + ep[0] + '" y2="' + ep[1] + '" stroke-width="2" stroke-dasharray="3 3" style="stroke:var(--bad)"/>' +
          '<circle cx="' + ep[0] + '" cy="' + ep[1] + '" r="8" style="fill:' + col + '"><title>Estimated position</title></circle>' +
          '<text class="link-lbl bad" style="font-size:12.5px;text-anchor:start" x="' + (Math.max(tp[0], ep[0]) + 18) + '" y="' + (my + 22) + '">error ' + esc(fmt(t.err_cm, 1, 'cm')) + '</text>';
      }
    }
    if (svg.innerHTML !== html) svg.innerHTML = html;
    setHTML('r2Legend', '<span><i class="sw hollow" style="border-color:var(' + NODE_COLOR[tid] + ')"></i>' + tid + ' true position</span><span><i class="sw dot" style="background:var(' + NODE_COLOR[tid] + ')"></i>' + tid + ' estimated (weighted centroid)</span><span><i class="sw" style="border-top:2px dashed var(--bad)"></i>error</span><span>axes in cm · dashed rings = estimated distance from each anchor</span>');
  }

  /* ---------- R3 Wi-Fi MAC ---------- */
  function parseCT(list) {
    return arr(list).map(function (x) {
      if (x && typeof x === 'object') return { us: num(x.us != null ? x.us : x.t) || 0, ev: String(x.ev || x.e || '') };
      var m = /^\s*\+?\s*(-?\d+(?:\.\d+)?)\s*(us|µs|ms)?\s*(.*)$/i.exec(String(x));
      if (!m) return { us: 0, ev: String(x) };
      var v = Number(m[1]); if ((m[2] || '').toLowerCase() === 'ms') v *= 1000;
      return { us: v, ev: m[3] || '' };
    }).sort(function (a, b) { return a.us - b.us; });
  }
  function laneHTML(name, evs, maxUs) {
    var segs = '', marks = '', groups = [];
    evs.forEach(function (e) {
      var g = groups[groups.length - 1];
      if (g && Math.abs(g.us - e.us) < maxUs * 0.03) g.evs.push(e.ev); else groups.push({ us: e.us, evs: [e.ev] });
    });
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], nx = evs[i + 1];
      if (!nx || nx.us <= e.us) continue;
      var c = evClass(e.ev);
      var cls = c === 'BACKOFF' ? 'backoff' : (c === 'DEFER' || c === 'CS_BUSY') ? 'defer' : c === 'TX' ? 'wait' : c === 'RETX' ? 'retx' : c === 'ACK_TIMEOUT' ? 'retx' : '';
      if (!cls) continue;
      segs += '<i class="seg ' + cls + '" style="left:' + (e.us / maxUs * 100) + '%;width:' + ((nx.us - e.us) / maxUs * 100) + '%" title="' + esc(e.ev) + '"></i>';
      if (c === 'TX') segs += '<i class="seg tx" style="left:' + (e.us / maxUs * 100) + '%;width:' + Math.min(1.5, (nx.us - e.us) / maxUs * 100) + '%"></i>';
    }
    groups.forEach(function (g, gi) {
      var left = g.us / maxUs * 100;
      marks += '<i class="mark" style="left:' + left + '%"></i><span class="mark-lbl" style="left:' + Math.min(92, Math.max(6, left)) + '%;top:' + (46 + (gi % 3) * 14) + 'px">+' + fmt(g.us / 1000, 1) + ' ms ' + esc(g.evs.join(' · ')) + '</span>';
    });
    return '<div class="lane"><b>' + esc(name) + '</b><div class="lane-track">' + segs + marks + '</div></div><div class="lane-gap" style="height:44px"></div>';
  }
  function explainCT(ct) {
    var a = parseCT(ct.N1), b = parseCT(ct.N2);
    if (!a.length && !b.length) return '';
    function info(evs) { // split a lane into attempts: backoff → TX → ACK_OK | ACK_TIMEOUT
      var r = { bo: [], tx: [], ack: null, to: [], defer: [] };
      evs.forEach(function (e) {
        var c = evClass(e.ev), m;
        if (c === 'BACKOFF') { m = /BACKOFF\s*(\d+)/i.exec(e.ev); r.bo.push(m ? Number(m[1]) : null); }
        else if (c === 'TX' || c === 'RETX') r.tx.push(e.us);
        else if (c === 'ACK_OK') r.ack = e.us;
        else if (c === 'ACK_TIMEOUT') r.to.push(e.us);
        else if (c === 'DEFER' || c === 'CS_BUSY') r.defer.push(e.us);
      });
      return r;
    }
    function ms(us) { return us == null ? '?' : '+' + fmt(us / 1000, 1) + ' ms'; }
    function bo(x, i) { return x.bo[i] == null ? '?' : x.bo[i] + ' slot' + (x.bo[i] === 1 ? '' : 's'); }
    var A = info(a), B = info(b), li = [];
    li.push('At network time ' + fmtSec(ct.at) + ' N1 and N2 both called macSend() for a DATA frame to N3 at the same instant (CTRL CONTENTION_TEST).');
    li.push('Both sensed the channel idle for DIFS and drew a random backoff: N1 = ' + bo(A, 0) + ', N2 = ' + bo(B, 0) + ' (1 slot = 1 ms)' +
      (A.bo[0] != null && A.bo[0] === B.bo[0] ? ' — the same value, so their counters expired together.' : '.'));
    var collided = A.tx.length && B.tx.length && A.to.length && B.to.length && A.to[0] > A.tx[0] && B.to[0] > B.tx[0] && Math.abs(A.tx[0] - B.tx[0]) < 2000;
    var nodesI = [['N1', A], ['N2', B]];
    if (collided) {
      li.push('Both transmitted at ' + ms(A.tx[0]) + ' / ' + ms(B.tx[0]) + ' → the frames collided at N3 and neither was ACKed.');
      li.push('At ' + ms(Math.min(A.to[0], B.to[0])) + ' both hit ACK_TIMEOUT (40 ms), doubled the contention window and drew new backoffs: N1 = ' + bo(A, 1) + ', N2 = ' + bo(B, 1) + '.');
      nodesI.sort(function (x, y) { return (x[1].tx[1] == null ? 1e12 : x[1].tx[1]) - (y[1].tx[1] == null ? 1e12 : y[1].tx[1]); });
      var w = nodesI[0], l = nodesI[1];
      li.push(w[0] + '\'s new backoff expired first → it retransmitted at ' + ms(w[1].tx[1]) + (w[1].ack != null ? ', ACK at ' + ms(w[1].ack) + '.' : '.'));
      var ld = l[1].defer.filter(function (t) { return t > (l[1].to[0] || 0); }).length;
      li.push(l[0] + (ld ? ' sensed the channel busy, froze its backoff (DEFER) and' : '') + ' retransmitted at ' + ms(l[1].tx[1]) + (l[1].ack != null ? ', ACK at ' + ms(l[1].ack) + '.' : '.'));
    } else {
      nodesI.sort(function (x, y) { return (x[1].tx[0] == null ? 1e12 : x[1].tx[0]) - (y[1].tx[0] == null ? 1e12 : y[1].tx[0]); });
      var f = nodesI[0], s2 = nodesI[1];
      li.push(f[0] + '\'s backoff expired first → it transmitted at ' + ms(f[1].tx[0]) + (f[1].ack != null && !f[1].to.length ? ' and got the ACK at ' + ms(f[1].ack) + '.' : '.'));
      if (s2[1].tx[0] == null) li.push(s2[0] + ' did not transmit in the recorded window.');
      else li.push(s2[0] + (s2[1].defer.length ? ' sensed the channel busy, froze its backoff counter (DEFER) and' : '') + ' transmitted at ' + ms(s2[1].tx[0]) + (s2[1].ack != null ? ', ACK at ' + ms(s2[1].ack) + '.' : '.'));
    }
    var okBoth = A.ack != null && B.ack != null;
    var verdict = collided ? 'Collision detected by the missing ACK and resolved by retransmission with binary exponential backoff' + (okBoth ? ' — both frames were finally delivered.' : '.') :
      (A.to.length + B.to.length ? 'ACK timeouts occurred and were recovered by retransmission.' : 'No collision — carrier sensing + random backoff serialised the two transmissions' + (okBoth ? ' and both frames were ACKed.' : '.'));
    return '<div class="explain"><b>How the MAC resolved the simultaneous attempt</b><ol>' + li.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol><div style="margin-top:6px"><b>' + esc(verdict) + '</b></div></div>';
  }
  V.r3 = {
    build: function () {
      return header('r3') +
        '<div class="grid g4" id="r3Counters"></div>' +
        '<div class="mt">' + card('Contention / collision test', 'N1 and N2 both try to send to N3 at the same network time. Timelines are µs offsets from the trigger.',
          '<div class="lanes" id="r3Lanes"></div><div class="legend"><span><i class="sw" style="border-top:8px solid color-mix(in srgb, var(--info) 35%, transparent)"></i>random backoff</span><span><i class="sw" style="border-top:8px dashed var(--warn)"></i>deferred (channel busy)</span><span><i class="sw" style="border-top:8px solid var(--accent)"></i>transmit → ACK wait</span><span><i class="sw" style="border-top:8px solid var(--bad)"></i>timeout / retransmission</span></div><div id="r3Explain"></div>',
          '', cmdBtn('Run contention test', { c: 'CONTENTION_TEST' }, 'primary')) + '</div>' +
        '<div class="grid g2 mt">' +
        card('MAC event timeline', 'Newest first. Every frame goes through: sense → backoff → transmit → wait for ACK → retry.', '<div class="tbl-wrap feed" id="r3Log"></div>') +
        '<div class="grid">' +
        card('Retransmissions over time', 'Total MAC retries across all nodes (cumulative).', '<div class="chart-box short"><canvas id="c-retx"></canvas></div>') +
        card('CSMA/CA parameters', 'From config.h (spec §4).', '<dl class="kv"><dt>Backoff slot</dt><dd>1 ms</dd><dt>DIFS (idle before TX)</dt><dd>2 ms</dd><dt>Channel busy window</dt><dd>3 ms since last frame</dd><dt>Contention window</dt><dd>4 → 32 slots (×2 per retry)</dd><dt>ACK timeout</dt><dd>40 ms</dd><dt>Max retries</dt><dd>3</dd><dt>TX deadline</dt><dd>400 ms (fits a slot)</dd></dl>') +
        '</div></div>';
    },
    init: function () { lineChart('c-retx', [{ label: 'Retransmissions', key: 'retx_total', cv: '--bad', fill: true, stepped: true }], { dec: 0, min: 0 }); },
    render: function () {
      setHTML('r3Counters', NODE_IDS.map(function (id) {
        var c = macCnt(node(id)), k = nNum(id);
        var att = (num(c.tx) || 0) + (num(c.retx) || 0);
        var ackPct = att ? (num(c.ok) || 0) / att * 100 : null;
        return '<div class="card"><div class="node-top" style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><div class="node-avatar n' + k + '" style="width:30px;height:30px;font-size:12px">' + id + '</div><div style="font-weight:650">' + esc(SHORT_ROLE[id]) + '</div></div>' +
          '<dl class="kv nw">' +
          '<dt>Frames sent (1st try)</dt><dd>' + fmtI(c.tx) + '</dd>' +
          '<dt>Retransmissions</dt><dd>' + fmtI(c.retx) + '</dd>' +
          '<dt>ACKs received</dt><dd>' + fmtI(c.ok)  + '</dd>' +
          '<dt>ACK timeouts</dt><dd>' + fmtI(c.to) + '</dd>' +
          '<dt>Channel busy</dt><dd>' + fmtI(c.busy) + '</dd>' +
          '<dt>Backoff total</dt><dd>' + fmtI(c.bo, 'ms') + '</dd>' +
          '<dt>Deferrals</dt><dd>' + fmtI(c.def) + '</dd>' +
          '<dt>Near-collisions seen</dt><dd>' + fmtI(c.col) + '</dd>' +
          '</dl></div>';
      }).join(''));
      var ct = get(D(), 'contention_test', null);
      if (ct && (arr(ct.N1).length || arr(ct.N2).length)) {
        var a = parseCT(ct.N1), b = parseCT(ct.N2);
        var mx = Math.max.apply(null, a.concat(b).map(function (e) { return e.us; }).concat([1000])) * 1.08;
        var axis = '<div class="lane-axis">';
        for (var i = 0; i <= 4; i++) axis += '<span style="left:' + (i * 25) + '%">' + fmt(mx * i / 4 / 1000, 1) + ' ms</span>';
        setHTML('r3Lanes', laneHTML('N1', a, mx) + laneHTML('N2', b, mx) + axis + '</div>');
        setHTML('r3Explain', explainCT(ct));
      } else {
        setHTML('r3Lanes', '<div class="empty">No contention test yet — press “Run contention test”. The sink schedules it ≥ 1.5 s ahead inside the CONTROL slot; results arrive with the next STAT frames.</div>');
        setHTML('r3Explain', '');
      }
      var log = arr(get(D(), 'mac_log', [])).slice().sort(function (x, y) { return (num(y.t) || 0) - (num(x.t) || 0); });
      setHTML('r3Log', '<table><thead><tr><th>When</th><th>Node</th><th>Event</th><th>Detail</th></tr></thead><tbody>' +
        (log.length ? log.slice(0, 60).map(function (e) {
          return '<tr><td class="mono small">' + esc(tAgo(e.t)) + '</td><td><b>' + esc(nId(e.node)) + '</b></td><td>' + evChip(e.ev) + '</td><td class="mono small">' + esc(e.ev) + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="empty">No MAC events yet</td></tr>') + '</tbody></table>');
      updateLine('c-retx');
    }
  };

  /* ---------- R4 Schedule ---------- */
  V.r4 = {
    build: function () {
      return header('r4') +
        card('Superframe (live)', 'Slot owners announced in the SCHED beacon. The cursor is the current network time.',
          '<div class="slotstrip" id="r4Strip"></div><div class="legend slot-legend"><span><i class="sw dot" style="background:var(--info-soft);border:1px solid var(--info)"></i>beacon</span><span><i class="sw dot" style="background:var(--warn-soft);border:1px solid var(--warn)"></i>control / contention</span><span><i class="sw dot" style="background:var(--surface-3)"></i>unused → sleep</span><span>colored = owned by that node</span></div><dl class="kv mt" id="r4Meta"></dl>', '', '<span class="chip accent" id="r4Ver">—</span>') +
        '<div class="grid g2 mt">' +
        card('Sleep / wake per node', 'Awake in beacon, own, control and children\'s slots; asleep otherwise (LED off, BLE scan paused, modem sleep).', '<div id="r4Duty"></div>') +
        card('Trigger a schedule change', 'Each command is broadcast by the sink in the next CONTROL slot; the scheduler re-plans at the next superframe.',
          '<div class="btns">' + cmdBtn('Request schedule update', { c: 'SCHED_UPDATE' }, 'primary') + '</div>' +
          '<h3>Node leaves / joins (unused-slot handling)</h3><div class="btns">' +
          cmdBtn('Kill N1 (30 s)', { c: 'NODE_KILL', a: 1, dur: 30 }, 'danger') + cmdBtn('Wake N1', { c: 'NODE_WAKE', a: 1 }) +
          cmdBtn('Kill N2 (30 s)', { c: 'NODE_KILL', a: 2, dur: 30 }, 'danger') + cmdBtn('Wake N2', { c: 'NODE_WAKE', a: 2 }) + '</div>' +
          '<p class="small muted" style="margin:10px 0 0">Rules: a member silent for 3 superframes loses its slot (→ UNUSED, everyone sleeps); it regains it when heard again; an extra retransmission slot is granted when ACK timeouts exceed 20 %.</p>') +
        '</div>' +
        '<div class="mt">' + card('Schedule version history', 'Why and how the schedule was updated (newest first).', '<div class="tbl-wrap feed" id="r4Hist"></div>') + '</div>';
    },
    render: function () {
      var sc = schedule(), slots = arr(sc.slots), sl = num(sc.slot_ms) || 500;
      if (!slots.length) slots = [3, 1, 2, 3, 0, 255];
      var cs = currentSlot();
      var strip = slots.map(function (o, i) {
        var si = slotInfo(i, slots, sc.master);
        return '<div class="slot ' + si.cls + '" data-i="' + i + '"><span class="si">slot ' + i + ' · ' + fmtI(i * sl) + '–' + fmtI((i + 1) * sl) + ' ms</span><span class="so">' + esc(si.owner) + '</span><span class="sk">' + esc(si.kind) + '</span></div>';
      }).join('') + '<div class="cursor" id="r4Cursor" style="left:0"></div>';
      var el = $('r4Strip');
      if (el && el.getAttribute('data-k') !== JSON.stringify(slots) + sc.master) { el.innerHTML = strip; el.setAttribute('data-k', JSON.stringify(slots) + sc.master); }
      setText('r4Ver', 'version ' + (sc.ver != null ? sc.ver : '—'));
      setHTML('r4Meta',
        '<dt>Current reason</dt><dd>' + esc(sc.why || '—') + '</dd>' +
        '<dt>Scheduler / time master</dt><dd>' + esc(nId(sc.master || get(D(), 'sched_master', null))) + (num(sc.master) === 4 ? ' (backup — N3 not heard)' : '') + '</dd>' +
        '<dt>Superframe</dt><dd>#' + esc(get(sc, 'sf', get(D(), 'sf', '—'))) + ' · ' + slots.length + ' × ' + fmtI(sl) + ' ms = ' + fmtI(slots.length * sl) + ' ms</dd>' +
        '<dt>Current slot</dt><dd>' + (cs ? cs.idx + ' (' + esc(slotInfo(cs.idx, slots, sc.master).owner) + ')' : '—') + '</dd>' +
        '<dt>Unused slots</dt><dd>' + (slots.filter(function (o) { return num(o) === 255; }).length) + '</dd>');
      setHTML('r4Duty', NODE_IDS.map(function (id) {
        var t = obj(node(id).tdma);
        var duty = num(t.duty);
        if (duty === null && num(t.awake_ms) !== null && num(t.sleep_ms) !== null) duty = t.awake_ms / Math.max(1, t.awake_ms + t.sleep_ms) * 100;
        return '<div class="duty-row"><b>' + id + '</b><div class="bar" title="awake ' + fmt(duty, 1) + ' %"><i class="awake" style="width:' + (duty || 0) + '%"></i></div><span class="num r">' + fmt(duty, 1, '%') + '</span></div>' +
          '<div class="small muted" style="margin:-4px 0 6px 54px">awake ' + fmtSec(t.awake_ms) + ' · asleep ' + fmtSec(t.sleep_ms) + '</div>';
      }).join(''));
      var hist = arr(get(DV(), 'schedule_history', null));
      if (!hist.length) hist = arr(sc.history);
      hist = hist.slice().sort(function (a, b) { return (num(b.ver) || 0) - (num(a.ver) || 0); });
      setHTML('r4Hist', '<table><thead><tr><th>Version</th><th>Why it changed</th><th>Network time</th><th>Received</th></tr></thead><tbody>' +
        (hist.length ? hist.map(function (h, i) {
          return '<tr><td>' + chip('v' + (h.ver != null ? h.ver : '?'), i === 0 ? 'accent' : '') + '</td><td>' + esc(h.why || '—') + '</td><td class="mono small">' + esc(netT(h.t)) + '</td><td class="mono small">' + esc(whenStr(h)) + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="empty">No schedule history yet</td></tr>') + '</tbody></table>');
    }
  };

  /* ---------- R5 Broadcast & Unicast ---------- */
  V.r5 = {
    build: function () {
      return header('r5') +
        '<div class="grid g-main">' +
        '<div class="grid">' +
        card('Broadcast (to FF:FF:FF:FF:FF:FF, not ACKed)', 'Control and schedule information for every node.', '<div class="grid g3" id="r5B"></div>') +
        card('Unicast (to one MAC, hop-by-hop ACK)', 'Sensor data, aggregated data and status — reliable delivery with retransmission.', '<div class="grid g4" id="r5U"></div>') +
        '</div>' +
        card('Message mix', '', '<div class="chart-box donut"><canvas id="c-cast"></canvas></div><p class="small muted" id="r5Rel" style="margin:8px 0 0"></p>') +
        '</div>' +
        '<div class="mt">' + card('Live message feed', 'Newest first. Destination and ACK status for every frame seen by the sink.', '<div class="tbl-wrap feed" id="r5Feed"></div>', '',
          '<div class="btns" role="group" aria-label="Filter messages"><button type="button" class="btn" data-feed="all">All</button><button type="button" class="btn" data-feed="broadcast">Broadcast</button><button type="button" class="btn" data-feed="unicast">Unicast</button></div>') + '</div>';
    },
    init: function () { donutChart('c-cast'); },
    render: function () {
      var c = obj(get(D(), 'counters', {})), b = obj(c.bcast), u = obj(c.ucast);
      var BD = { HELLO: 'neighbour discovery + route control', SCHED: 'schedule beacon from N3', CTRL: 'dashboard commands' };
      var UD = { DATA: 'sensor readings', AGG: 'aggregated N3 → N4', STAT: 'node counters', ACK: 'link-layer acks' };
      setHTML('r5B', Object.keys(BD).map(function (k) { return '<div class="kpi"><span class="k">' + k + '</span><span class="v">' + fmtI(b[k]) + '</span><span class="s">' + BD[k] + '</span></div>'; }).join(''));
      setHTML('r5U', Object.keys(UD).map(function (k) { return '<div class="kpi"><span class="k">' + k + '</span><span class="v">' + fmtI(u[k]) + '</span><span class="s">' + UD[k] + '</span></div>'; }).join(''));
      var ch = S.charts['c-cast'];
      if (ch) {
        ch.data.datasets[0].data = ['HELLO', 'SCHED', 'CTRL'].map(function (k) { return num(b[k]) || 0; }).concat(['DATA', 'AGG', 'STAT', 'ACK'].map(function (k) { return num(u[k]) || 0; }));
        ch.update('none');
      }
      var msgs = arr(get(D(), 'msg_log', [])).slice().sort(function (x, y) { return (num(y.t) || 0) - (num(x.t) || 0); });
      var acked = msgs.filter(function (m) { return m.acked === true; }).length, ackable = msgs.filter(function (m) { return m.acked === true || m.acked === false; }).length;
      setHTML('r5Rel', ackable ? 'Unicast frames in the feed acknowledged: <b>' + acked + ' / ' + ackable + '</b> (' + fmt(acked / ackable * 100, 1) + ' %). Unacknowledged frames are retransmitted by the MAC.' : '');
      document.querySelectorAll('[data-feed]').forEach(function (bt) { bt.classList.toggle('primary', bt.getAttribute('data-feed') === S.feedFilter); });
      var f = msgs.filter(function (m) { return S.feedFilter === 'all' || String(m.cast).toLowerCase() === S.feedFilter; });
      setHTML('r5Feed', '<table><thead><tr><th>When</th><th>Type</th><th>Cast</th><th>From → To</th><th class="r">Seq</th><th>ACK</th><th>Path</th></tr></thead><tbody>' +
        (f.length ? f.slice(0, 60).map(function (m) {
          var bc = String(m.cast).toLowerCase() === 'broadcast';
          var to = bc || m.to === '*' || nNum(m.to) === 0 ? 'all nodes' : nId(m.to);
          var ack = m.acked === true ? chip('✓ ACK', 'ok') : m.acked === false ? chip('✗ no ACK', 'bad') : '<span class="faint small">' + (bc ? 'not ACKed' : '—') + '</span>';
          return '<tr><td class="mono small">' + esc(tAgo(m.t)) + '</td><td><b>' + esc(m.type || '—') + '</b></td><td>' + chip(bc ? 'broadcast' : 'unicast', bc ? 'accent' : 'info') + '</td><td>' + esc(nId(m.from)) + ' → ' + esc(to) + '</td><td class="r num">' + fmtI(m.seq) + '</td><td>' + ack + '</td><td>' + (m.path ? pathHTML(m.path) : '<span class="faint">—</span>') + '</td></tr>';
        }).join('') : '<tr><td colspan="7" class="empty">No messages yet</td></tr>') + '</tbody></table>');
    }
  };

  /* ---------- R6 Aggregation ---------- */
  V.r6 = {
    build: function () {
      return header('r6') +
        card('This window at the cluster head (N3)', 'Aggregation function: latest-value fusion + window statistics (count / mean / min / max) + OR-fused alert flags (th). N1 and N3 measure two different enclosures and N2 measures turbidity, so the three are fused, not averaged together.',
          '<div class="agg-flow"><div class="agg-in" id="r6In"></div><div class="agg-arrow"><svg viewBox="0 0 52 24" aria-hidden="true"><path d="M2 12h44M36 3l11 9-11 9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>aggregate<br>at N3</span></div><div id="r6Out"></div></div>') +
        '<div class="grid g2 mt">' +
        card('Reduction in transmitted data', '', '<div class="gauges" id="r6G"></div><div class="formula mt">window red  = (in − 1) / in × 100\npackets red = (aggIn − aggOut) / aggIn\nbytes red   = (bytesIn − bytesOut) / bytesIn</div>') +
        card('Cumulative data reduction over time', 'Packets saved by aggregation (%).', '<div class="chart-box tall"><canvas id="c-red"></canvas></div>') +
        '</div>' +
        '<div class="grid g2 mt">' + tempWarnCard('r6') +
        card('Alert flags → status light', 'The th flags of the window are OR-fused at N3 and travel in the AGG; the sink drives the light from the freshest flag per node, AGG or direct DATA (turbid red beats hot).', '<dl class="kv" id="r6Flags"></dl>') +
        '</div>';
    },
    init: function () { lineChart('c-red', [{ label: 'Reduction', key: 'reduction', cv: '--accent', fill: true }], { unit: '%', yTitle: '%', min: 0, max: 100 }); },
    render: function () {
      var a = obj(get(D(), 'aggregation', {}));
      var ins = [['N1', 'Enclosure temperature (pond edge)', a.n1, '°C', ['hot', 'warn'], 'normal', true], ['N2', 'Turbidity', a.n2, 'raw ADC', ['turbid', 'bad'], 'clear', false]];
      var html = ins.map(function (x) {
        var s = obj(x[2]), th = num(s.th);
        var T = x[6] ? function (v) { var t = tempC(v); return t === null ? '—' : fmt(t, 2); } : null;
        var flag = th === 1 ? chip('th 1 · ' + x[4][0], x[4][1]) : th === 0 ? chip('th 0 · ' + x[5], '') : '';
        return '<div class="card"><div class="agg-in-head"><b>' + x[0] + ' · ' + x[1] + '</b><span class="btns">' + flag + chip('cnt ' + fmtI(s.cnt), 'accent') + '</span></div>' +
          '<div class="node-value sm">' + (T ? T(s.v) : fmtI(s.v)) + ' <small>' + esc(x[3]) + '</small></div>' +
          '<div class="small muted mono">mean ' + (T ? T(s.mean) : fmt(s.mean, 1)) + ' · min ' + (T ? T(s.min) : fmtI(s.min)) + ' · max ' + (T ? T(s.max) : fmtI(s.max)) + ' · seq ' + fmtI(s.q) + '</div></div>';
      }).join('');
      var t3 = tempC(get(a, 'n3.v', null));
      html += '<div class="card"><div class="agg-in-head"><b>N3 · Enclosure temperature (own sensor)</b>' + chip('uncalibrated', '') + '</div><div class="node-value sm">' + (t3 === null ? '—' : fmt(t3, 2)) + ' <small>°C</small></div><div class="small muted">ESP32 on-chip die sensor, read locally (no radio frame); n3.v = °C × 100</div></div>';
      setHTML('r6In', html);
      var bi = num(a.bytes_in), bo = num(a.bytes_out), inN = num(a['in']);
      setHTML('r6Out', '<div class="card agg-out"><b>Aggregated output · one AGG frame</b><p class="sub">window = superframe #' + esc(get(a, 'window', '—')) + ', sent in slot 3 to N4 · alert flags th are OR-fused, never averaged</p>' +
        '<div class="grid g2"><div class="kpi"><span class="k">Packets</span><span class="v">' + fmtI(inN) + '<small>→ 1</small></span></div><div class="kpi"><span class="k">Bytes</span><span class="v">' + fmtI(bi) + '<small>→ ' + fmtI(bo) + '</small></span></div></div>' +
        '<dl class="kv mt"><dt>Window reduction</dt><dd>' + fmt(a.reduction_pct, 1, '%') + '</dd><dt>Path to sink</dt><dd>' + pathHTML(a.path) + '</dd><dt>Delay to sink</dt><dd>' + fmtI(a.delay_ms, 'ms') + '</dd><dt>Cumulative in → out</dt><dd>' + fmtI(get(a, 'cum.in', null)) + ' → ' + fmtI(get(a, 'cum.out', null)) + ' frames</dd><dt>Cumulative bytes</dt><dd>' + fmtI(get(a, 'cum.bytes_in', null)) + ' → ' + fmtI(get(a, 'cum.bytes_out', null)) + ' B</dd></dl></div>');
      var g = [['This window (packets)', a.reduction_pct], ['Cumulative packets', get(a, 'cum.reduction_packets_pct', get(M(), 'reduction_pct.packets', null))], ['Cumulative bytes', get(a, 'cum.reduction_bytes_pct', get(M(), 'reduction_pct.bytes', null))]];
      setHTML('r6G', g.map(function (x) {
        var v = num(x[1]);
        return '<div class="gauge"><div class="ring" style="--p:' + (v === null ? 0 : Math.max(0, Math.min(100, v))) + '"><div>' + (v === null ? '—' : fmt(v, 1) + '%') + '</div></div><span class="small muted">' + x[0] + '</span></div>';
      }).join(''));
      var L = lightOf(), f1 = num(get(a, 'n1.th', null)), f2 = num(get(a, 'n2.th', null));
      setHTML('r6Flags',
        '<dt>n1.th · N1 enclosure</dt><dd>' + (f1 === 1 ? chip('1 · hot', 'warn') : f1 === 0 ? chip('0 · normal', '') : '—') + '</dd>' +
        '<dt>n2.th · N2 turbidity</dt><dd>' + (f2 === 1 ? chip('1 · turbid', 'bad') : f2 === 0 ? chip('0 · clear', '') : '—') + '</dd>' +
        '<dt>Pond status light</dt><dd>' + chip(LIGHT[L.state].label, LIGHT[L.state].tone) + ' <span class="muted small">' + esc(L.reason || LIGHT[L.state].rule) + '</span></dd>' +
        '<dt>N1 threshold</dt><dd>' + esc(twText(node('N1').temp_warn)) + '</dd>');
      renderTempWarn('r6');
      updateLine('c-red');
    }
  };

  /* ---------- R7 Routing ---------- */
  function candidates(id) {
    var k = nNum(id), out = [];
    var chUp = k !== 3 && linkState(k, 3) === 'up';
    (ALLOWED[k] || []).forEach(function (nb) {
      var l = link(k, nb) || {}, st = linkState(k, nb);
      var h = nb === 4 ? 0 : num(node(nb).hops);
      var ack = num(l.ack_pct), rssi = num(l.wifi_rssi);
      var loop = nb !== 4 && num(node(nb).next_hop) === k;
      var row = { nb: nb, st: st, h: h, ack: ack, rssi: rssi, loop: loop, cost: null, parts: '' };
      if (st === 'up' && h !== null && h < 255 && !loop) {
        var a = 10 * (h + 1), b = (100 - (ack === null ? 100 : ack)) / 5, c = Math.max(0, -70 - (rssi === null ? -50 : rssi)) / 2;
        var d = (k === 1 || k === 2) && nb !== 3 && chUp ? 20 : 0;
        row.cost = a + b + c + d;
        row.parts = fmtI(a) + ' + ' + fmt(b, 1) + ' + ' + fmt(c, 1) + ' + ' + d;
      }
      out.push(row);
    });
    return out;
  }
  V.r7 = {
    build: function () {
      return header('r7') +
        '<div class="grid g4" id="r7Routes"></div>' +
        '<div class="grid g-main mt">' +
        card('Routes on the map', 'Dashed red = failed / blocked link. Dots show packets travelling the current path.', '<div class="topo">' + buildTopoSVG('topoRoute') + '</div>' + TOPO_LEGEND) +
        '<div class="grid">' +
        card('Simulate failure & recovery', 'Both ends drop each other\'s frames → ACK timeouts → LINK_DOWN → alternate route.',
          '<div class="btns">' + cmdBtn('Simulate link failure N1–N3 (40 s)', { c: 'LINK_FAIL', a: 1, b: 3, dur: 40 }, 'danger') + cmdBtn('Restore N1–N3', { c: 'LINK_RESTORE', a: 1, b: 3 }) + '</div>' +
          '<div class="btns mt">' + cmdBtn('Simulate link failure N2–N3 (40 s)', { c: 'LINK_FAIL', a: 2, b: 3, dur: 40 }, 'danger') + cmdBtn('Restore N2–N3', { c: 'LINK_RESTORE', a: 2, b: 3 }) + '</div>') +
        card('Route metric (lower is better)', '', '<div class="formula" style="font-size:12.5px">cost = 10·(hops+1)            <span class="faint">hops</span>\n     + (100 − ACK%) / 5        <span class="faint">loss</span>\n     + max(0, −70 − RSSI) / 2  <span class="faint">RSSI</span>\n     + 20 if a member (N1/N2)  <span class="faint">prefer CH</span>\n       bypasses cluster head N3\nnext hop  = argmin cost\nalternate = 2nd best\nlink down: 2 failed sends in a row\n           or no HELLO for 9 s</div>') +
        '</div></div>' +
        '<div class="mt">' + card('Neighbour tables with cost per candidate', 'Recomputed live from the reported link statistics with the formula above. ★ = chosen next hop reported by the node.', '<div class="grid g3" id="r7Cand"></div>') + '</div>' +
        '<div class="grid g2 mt">' +
        card('Links', 'Wi-Fi RSSI from the promiscuous sniffer, BLE RSSI from scanning, ACK % over the sliding window.', '<div class="tbl-wrap" id="r7Links"></div>') +
        card('Failure / recovery timeline', 'Newest first.', '<div class="feed" id="r7Tl"></div>') +
        '</div>' +
        '<div class="mt">' + card('Path trace of the last 10 data packets', 'Proof of delivery through the alternate route: the path field grows as each relay forwards the frame.', '<div class="tbl-wrap" id="r7Trace"></div>') + '</div>';
    },
    render: function () {
      renderTopo('topoRoute');
      setHTML('r7Routes', NODE_IDS.map(function (id) {
        var n = node(id), k = nNum(id);
        if (id === 'N4') return '<div class="card"><div class="node-top" style="display:flex;gap:10px;align-items:center"><div class="node-avatar n4">N4</div><div><div class="node-title">Sink</div><div class="node-role">hops = 0, advertises cost 0</div></div></div><p class="small muted" style="margin:10px 0 0">Destination of every route. Consumes AGG / STAT; N3 forwards no raw DATA.</p></div>';
        var viaAlt = String(n.route || '').indexOf('>2>') > 0 && id === 'N1';
        return '<div class="card"><div class="node-top" style="display:flex;gap:10px;align-items:center;margin-bottom:8px"><div class="node-avatar n' + k + '">' + id + '</div><div><div class="node-title">' + esc(SHORT_ROLE[id]) + '</div>' + (viaAlt ? chip('alternate route', 'warn') : chip('primary route', 'ok')) + '</div></div>' +
          '<div style="margin:6px 0 10px">' + pathHTML(n.route) + '</div>' +
          '<dl class="kv"><dt>Next hop</dt><dd>' + esc(nId(n.next_hop)) + '</dd><dt>Hops to sink</dt><dd>' + fmtI(n.hops) + '</dd><dt>Route cost</dt><dd>' + fmt(n.route_cost, 0) + '</dd><dt>Alternate</dt><dd>' + (nNum(n.alt_next_hop) ? 'N' + nNum(n.alt_next_hop) + ' · cost ' + fmt(n.alt_cost, 0) : 'none') + '</dd><dt>Forwarded</dt><dd>' + fmtI(n.fwd_count) + '</dd><dt>Out-of-range drops</dt><dd>' + fmtI(n.oor) + '</dd></dl></div>';
      }).join(''));
      setHTML('r7Cand', ['N1', 'N2', 'N3'].map(function (id) {
        var n = node(id), rows = candidates(id);
        var best = null; rows.forEach(function (r) { if (r.cost !== null && (best === null || r.cost < best)) best = r.cost; });
        return '<div><div style="font-weight:650;margin-bottom:6px">' + id + ' neighbour table</div><table><thead><tr><th>Via</th><th>Link</th><th class="r">Hops</th><th class="r">Cost</th></tr></thead><tbody>' +
          rows.map(function (r) {
            var chosen = nNum(n.next_hop) === r.nb;
            var st = r.st === 'up' ? chip('up', 'ok') : r.st === 'down' ? chip('down', 'bad') : chip('unseen', '');
            var cost = r.cost !== null ? '<b>' + fmt(r.cost, 1) + '</b><div class="faint small mono">' + esc(r.parts) + '</div>' : '<span class="faint small">' + (r.loop ? 'loop (routes via ' + id + ')' : 'excluded') + '</span>';
            return '<tr><td><b>' + (chosen ? '★ ' : '') + 'N' + r.nb + '</b></td><td>' + st + '</td><td class="r num">' + fmtI(r.h) + '</td><td class="r">' + cost + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      }).join(''));
      setHTML('r7Links', '<table><thead><tr><th>Link</th><th>Status</th><th class="r">Wi-Fi RSSI</th><th class="r">BLE RSSI</th><th class="r">ACK</th></tr></thead><tbody>' +
        ALL_PAIRS.slice(0, 5).map(function (p) {
          var l = link(p[0], p[1]) || {}, st = linkState(p[0], p[1]);
          var sc = st === 'up' ? chip('Up', 'ok') : st === 'down' ? chip(l.blocked ? 'Blocked' : 'Down', 'bad') : chip('Not seen', '');
          return '<tr><td><b>N' + p[0] + '–N' + p[1] + '</b></td><td>' + sc + '</td><td class="r num">' + fmt(l.wifi_rssi, 0, 'dBm') + '</td><td class="r num">' + fmt(l.ble_rssi, 0, 'dBm') + '</td><td class="r num">' + fmt(l.ack_pct, 0, '%') + '</td></tr>';
        }).join('') + '</tbody></table>');
      var tl = [];
      arr(get(DV(), 'route_history', [])).forEach(function (r) {
        var restored = /RESTOR/i.test(r.reason || '');
        tl.push({ t: num(r.t), when: r.received_at, cls: restored ? 'ok' : 'bad', html: '<b>' + esc(nId(r.node)) + '</b> route ' + pathHTML(r.from) + ' → ' + pathHTML(r.to) + '<div class="small muted">' + esc(r.reason || '') + '</div>' });
      });
      arr(get(D(), 'events', [])).forEach(function (e) {
        if (String(e.type).toLowerCase() !== 'route') return;
        var m = String(e.msg || '');
        tl.push({ t: num(e.t), cls: /DOWN|FAIL/i.test(m) ? 'bad' : /RESTOR|UP/i.test(m) ? 'ok' : 'info', html: '<b>' + esc(nId(e.node)) + '</b> ' + esc(m) });
      });
      tl.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
      setHTML('r7Tl', tl.length ? '<ul class="tl">' + tl.slice(0, 40).map(function (x) { return '<li class="' + x.cls + '"><div class="when">' + esc(netT(x.t)) + ' · ' + esc(x.when ? whenStr({ received_at: x.when }) : tAgo(x.t)) + '</div>' + x.html + '</li>'; }).join('') + '</ul>' : '<div class="empty">No route changes yet. Press “Simulate link failure”.</div>');
      var trace = arr(get(D(), 'msg_log', [])).filter(function (m) { return m.type === 'DATA' || m.type === 'AGG'; })
        .sort(function (x, y) { return (num(y.t) || 0) - (num(x.t) || 0); }).slice(0, 10);
      setHTML('r7Trace', '<table><thead><tr><th>When</th><th>Type</th><th>Hop</th><th class="r">Seq</th><th>Path so far</th><th>ACK</th></tr></thead><tbody>' +
        (trace.length ? trace.map(function (m) {
          return '<tr><td class="mono small">' + esc(tAgo(m.t)) + '</td><td><b>' + esc(m.type) + '</b></td><td>' + esc(nId(m.from)) + ' → ' + esc(nId(m.to)) + '</td><td class="r num">' + fmtI(m.seq) + '</td><td>' + pathHTML(m.path) + '</td><td>' + (m.acked === true ? chip('✓', 'ok') : m.acked === false ? chip('✗', 'bad') : '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="6" class="empty">No DATA / AGG frames yet</td></tr>') + '</tbody></table>');
    }
  };

  /* ---------- R8 Performance ---------- */
  function interpretations() {
    var m = M(), pdr = obj(m.pdr), out = {};
    var parts = Object.keys(pdr).sort().map(function (k) {
      var n = node(k), exp = num(n.max_seq) !== null && num(n.first_seq) !== null ? n.max_seq - n.first_seq + 1 : null;
      var lost = num(n.lost);
      return k + ' ' + fmt(pdr[k], 1) + ' %' + (exp !== null && lost !== null ? (lost ? ' (' + lost + ' of ' + exp + ' lost)' : ' (lossless, ' + exp + ' packets)') : '');
    });
    out.pdr = parts.length ? parts.join(' · ') + '.' : 'No data yet.';
    var lt = num(m.lost_total), rx = num(m.rx_total);
    out.loss = lt !== null && rx !== null ? 'Total loss ' + fmt(lt / Math.max(1, lt + rx) * 100, 1) + ' % — ' + lt + ' of ' + (lt + rx) + ' expected packets missing' + (lt && arr(get(DV(), 'route_history', [])).length ? '; losses coincide with link failures before the alternate route took over.' : '.') : 'No data yet.';
    var d = obj(m.delay_ms);
    out.delay = Object.keys(d).length ? Object.keys(d).sort().map(function (k) { return k + ' avg ' + fmtI(get(d[k], 'avg', null)) + ' ms'; }).join(', ') +
      '. N1/N2 include the aggregation hold at N3 (up to one 3 s superframe) and extra hops; N3 is one hop from the sink.' : 'No data yet.';
    var thr = num(get(m, 'throughput_bps.total', null));
    out.thr = thr !== null ? fmtI(thr) + ' bps (' + fmt(thr / 8, 1) + ' B/s) delivered at the sink — the duty-cycled TDMA carries roughly one AGG + one STAT per node per superframe, so throughput is small by design.' : 'No data yet.';
    var r = obj(m.retransmissions), worst = null;
    Object.keys(r).forEach(function (k) { if (k !== 'total' && (worst === null || (num(r[k]) || 0) > (num(r[worst]) || 0))) worst = k; });
    out.retx = num(r.total) !== null ? fmtI(r.total) + ' retransmissions in total' + (worst && num(r[worst]) ? '; most on ' + worst + ' (' + fmtI(r[worst]) + '), the node whose link was failed/contended.' : '; the channel was clean.') : 'No data yet.';
    var le = obj(get(m, 'loc_err_cm.N1', {}));
    out.loc = num(le.last) !== null ? 'N1 estimated ' + fmt(le.last, 1) + ' cm from its true position (avg ' + fmt(le.avg, 1) + ', range ' + fmt(le.min, 1) + '–' + fmt(le.max, 1) + ' cm) using a weighted centroid of 3 anchors.' : 'No data yet.';
    var a = obj(get(D(), 'aggregation.cum', {}));
    out.red = num(get(m, 'reduction_pct.packets', null)) !== null ? 'N3 sent ' + fmtI(a.out) + ' AGG frames instead of forwarding ' + fmtI(a['in']) + ' DATA frames → ' + fmt(get(m, 'reduction_pct.packets', null), 1) + ' % fewer packets and ' + fmt(get(m, 'reduction_pct.bytes', null), 1) + ' % fewer bytes.' : 'No data yet.';
    return out;
  }
  V.r8 = {
    build: function () {
      return header('r8') +
        card('Measured metrics', 'Formulas from spec §11. Interpretation is generated from the live values.', '<div class="tbl-wrap" id="r8T"></div>', '',
          '<div class="btns"><a class="btn" href="/api/export.csv" download id="r8Csv">Export CSV</a>' + cmdBtn('Reset statistics', { c: 'RESET_STATS' }, 'danger') + '</div>') +
        '<div class="grid g2 mt">' +
        card('Packet delivery ratio', 'per origin node (%)', '<div class="chart-box"><canvas id="c-pdr"></canvas></div>') +
        card('Packet loss', '100 − PDR (%)', '<div class="chart-box"><canvas id="c-loss"></canvas></div>') +
        card('End-to-end delay', 'per origin node (ms)', '<div class="chart-box"><canvas id="c-delay"></canvas></div>') +
        card('Throughput at sink', 'bits per second, 30 s window', '<div class="chart-box"><canvas id="c-thr"></canvas></div>') +
        card('Retransmissions', 'cumulative, all nodes', '<div class="chart-box"><canvas id="c-retx2"></canvas></div>') +
        card('Localization error N1', 'cm', '<div class="chart-box"><canvas id="c-loc2"></canvas></div>') +
        card('Data reduction', 'packets saved by aggregation (%)', '<div class="chart-box"><canvas id="c-red2"></canvas></div>') +
        card('Sensor values', 'Turbidity raw ADC (left axis); N1 and N3 enclosure temperatures in °C (shared right axis)', '<div class="chart-box"><canvas id="c-val"></canvas></div>') +
        '</div>';
    },
    init: function () {
      lineChart('c-pdr', [{ label: 'N1', key: 'pdr_N1', cv: '--n1' }, { label: 'N2', key: 'pdr_N2', cv: '--n2' }, { label: 'N3', key: 'pdr_N3', cv: '--n3', dash: [8, 6], width: 3.5 }], { unit: '%', max: 100 });
      lineChart('c-loss', [{ label: 'N1', key: function (s) { return arr(s.pdr_N1).map(function (v) { var n = num(v); return n === null ? null : 100 - n; }); }, cv: '--n1' },
        { label: 'N2', key: function (s) { return arr(s.pdr_N2).map(function (v) { var n = num(v); return n === null ? null : 100 - n; }); }, cv: '--n2' }], { unit: '%', min: 0, max: 10 });
      lineChart('c-delay', [{ label: 'N1', key: 'delay_N1', cv: '--n1' }, { label: 'N2', key: 'delay_N2', cv: '--n2' }, { label: 'N3', key: 'delay_N3', cv: '--n3' }], { unit: 'ms', dec: 0, min: 0 });
      lineChart('c-thr', [{ label: 'Throughput', key: 'throughput', cv: '--accent', fill: true }], { unit: 'bps', dec: 0, min: 0 });
      lineChart('c-retx2', [{ label: 'Retransmissions', key: 'retx_total', cv: '--bad', fill: true, stepped: true }], { dec: 0, min: 0 });
      lineChart('c-loc2', [{ label: 'N1 error', key: 'loc_err_N1', cv: '--n1', fill: true }], { unit: 'cm', min: 0 });
      lineChart('c-red2', [{ label: 'Reduction', key: 'reduction', cv: '--accent', fill: true }], { unit: '%', min: 0, max: 100 });
      /* N1 and N3 are both ESP32 die temperatures (°C × 100 → °C): one shared °C axis on the right */
      var toC = function (v) { var t = tempC(v); return t === null ? null : t; };
      lineChart('c-val', [{ label: 'N2 turbidity (raw ADC)', key: 'value_N2', cv: '--n2' }, { label: 'N1 enclosure temp (°C)', key: 'value_N1', cv: '--n1', axis: 'y2', map: toC }, { label: 'N3 enclosure temp (°C)', key: 'value_N3', cv: '--n3', axis: 'y2', map: toC }], { y2: '°C', yTitle: 'raw ADC', dec: 1 });
    },
    render: function () {
      var m = M(), it = interpretations();
      var pdrAvg = mean(Object.keys(obj(m.pdr)).map(function (k) { return m.pdr[k]; }));
      var d = obj(m.delay_ms), le = obj(get(m, 'loc_err_cm.N1', {}));
      var rows = [
        ['Packet delivery ratio', 'rx_unique / (max_seq − first_seq + 1) × 100', fmt(pdrAvg, 1, '% avg'), it.pdr],
        ['Packet loss', '100 − PDR;  lost = expected − rx_unique', fmtI(m.lost_total) + ' packets', it.loss],
        ['End-to-end delay', 't_sink_rx − t_created (network time)', fmtI(mean(Object.keys(d).map(function (k) { return get(d[k], 'avg', null); })), 'ms avg'), it.delay],
        ['Throughput', 'Σ payload bytes at sink in 30 s / 30 × 8', fmtI(get(m, 'throughput_bps.total', null), 'bps'), it.thr],
        ['Retransmissions', 'Σ STAT.mac.retx (MAC retries)', fmtI(get(m, 'retransmissions.total', null)), it.retx],
        ['Localization error', '|est − true| (weighted centroid)', fmt(le.last, 1, 'cm'), it.loc],
        ['Data reduction', '(in − out) / in × 100', fmt(get(m, 'reduction_pct.packets', null), 1, '% pkts') + ' · ' + fmt(get(m, 'reduction_pct.bytes', null), 1, '% bytes'), it.red]
      ];
      setHTML('r8T', '<table><thead><tr><th>Metric</th><th>Formula</th><th class="r">Measured</th><th>Interpretation</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td><b>' + esc(r[0]) + '</b></td><td class="mono small">' + esc(r[1]) + '</td><td class="r num"><b>' + esc(r[2]) + '</b></td><td class="small">' + esc(r[3]) + '</td></tr>'; }).join('') + '</tbody></table>');
      ['c-pdr', 'c-loss', 'c-delay', 'c-thr', 'c-retx2', 'c-loc2', 'c-red2', 'c-val'].forEach(function (c) { updateLine(c); });
    }
  };

  /* ---------- R9 Demo & Viva ---------- */
  V.r9 = {
    build: function () {
      return header('r9') +
        '<div class="grid g-main">' +
        card('Integrated demonstration sequence', 'Ticks automatically as the network shows each behaviour. Click a step to open the view to show the evaluator.', '<div class="progress"><i id="r9Prog" style="width:0"></i></div><ol class="checklist" id="r9List"></ol>', '', '<span class="chip accent" id="r9ProgTxt">—</span>') +
        card('Viva cheat-sheet', 'One card per rubric item, with the key numbers live.', '<div class="cheat one" id="r9Cheat"></div>') +
        '</div>';
    },
    render: function () {
      var df = demoFlow(), done = 0;
      setHTML('r9List', DEMO_STEPS.map(function (s, i) {
        var ok = df[s.k] === true; if (ok) done++;
        return '<li class="' + (ok ? 'done' : '') + '"><span class="sn">' + (ok ? '✓' : i + 1) + '</span><div><div class="t">' + esc(s.k) + '</div><div class="d">' + esc(s.see) + '</div></div>' +
          '<div class="meta">' + (ok ? chip('shown', 'ok') : chip('pending', '')) + '<a href="#' + s.v + '" class="small">' + esc(VIEWS[s.v].title) + ' →</a><span class="code">' + esc(s.mod) + '</span></div></li>';
      }).join(''));
      var p = $('r9Prog'); if (p) p.style.width = (done / DEMO_STEPS.length * 100).toFixed(1) + '%';
      setText('r9ProgTxt', done + ' / ' + DEMO_STEPS.length);
      var m = M(), d = D(), sc = schedule(), act = nodes().filter(function (n) { return String(n.status).toLowerCase() === 'active'; }).length;
      var c = obj(get(d, 'counters', {}));
      var cards = [
        [1, 'Architecture', act + '/4 active · ch ' + esc(get(d, 'channel', '—')) + ' · light ' + esc(LIGHT[lightOf().state].label.split(' · ')[0].toLowerCase()), 'One sketch, NODE_ID selects role. ESP-NOW for data, BLE for ranging. N1–N4 not allowed → forced multi-hop. Sensors are ESP32 on-chip peripherals: N1 and N3 die temperature (N1 adds an over-temperature alert set from the dashboard by TEMP_WARN), N2 ADC1 + comparator pin for the turbidity module; N4 drives a 2-LED pond status light (red and green).', 'config.h · sensors.h · wsn_node.ino'],
        [2, 'BLE localization', 'N1 error ' + fmt(get(m, 'loc_err_cm.N1.last', null), 1, 'cm'), 'RSSI → distance by log-distance model (RSSI₁ₘ, n), weighted centroid with w = 1/d².', 'ble_loc.h · sink.h'],
        [3, 'Wi-Fi MAC', 'retx ' + fmtI(get(m, 'retransmissions.total', null)) + ' · busy ' + fmtI(sum(nodes().map(function (n) { return macCnt(n).busy; }))), 'CSMA/CA: sense DIFS, random backoff (CW 4→32), ACK in 40 ms, up to 3 retries with BEB.', 'mac.h'],
        [4, 'TDMA schedule', 'v' + esc(sc.ver != null ? sc.ver : '—') + ' · ' + esc(sc.why || '—'), '6 × 500 ms slots, N3 broadcasts SCHED in slot 0, unused slots → sleep, re-plan each superframe.', 'tdma.h'],
        [5, 'Broadcast & unicast', 'bcast ' + fmtI(sum(Object.keys(obj(c.bcast)).map(function (k) { return c.bcast[k]; }))) + ' · ucast ' + fmtI(sum(Object.keys(obj(c.ucast)).map(function (k) { return c.ucast[k]; }))), 'HELLO/SCHED/CTRL to FF:FF:… unACKed; DATA/AGG/STAT to a learned MAC, ACKed hop by hop, duplicates suppressed.', 'mac.h'],
        [6, 'Aggregation', fmt(get(m, 'reduction_pct.packets', null), 1, '%') + ' fewer packets', 'N3 fuses the latest N1 enclosure temperature, N2 turbidity ADC and its own die temperature per window into one AGG with count/mean/min/max; the th alert flags (N1 ≥ TEMP_WARN, N2 comparator D) are OR-fused, and the sink turns them into the status light.', 'aggregation.h · sink.h'],
        [7, 'Adaptive routing', 'N1 ' + String(node('N1').route || '—'), 'cost = hops + loss + RSSI + CH-bypass penalty; LINK_DOWN after 2 failed sends or 9 s without HELLO.', 'routing.h'],
        [8, 'Performance', 'PDR ' + fmt(mean(Object.keys(obj(m.pdr)).map(function (k) { return m.pdr[k]; })), 1, '%') + ' · ' + fmtI(get(m, 'throughput_bps.total', null), 'bps'), 'All 7 metrics measured at the sink/server; CSV export for the report.', 'sink.h · server']
      ];
      setHTML('r9Cheat', cards.map(function (x) {
        return '<div class="card"><div class="cn">RUBRIC ' + x[0] + '</div><div class="ct">' + esc(x[1]) + '</div><div class="cv">' + x[2] + '</div><p>' + esc(x[3]) + '</p><p><span class="code">' + esc(x[4]) + '</span></p></div>';
      }).join(''));
    }
  };

  /* ======================= topbar + cursor ======================= */
  function sourceLabel() {
    if (MOCK) return 'Preview (mock data)';
    var s = String(get(DV(), 'source', get(D(), 'source', '')) || '').toLowerCase();
    return s === 'hardware' ? 'ESP32 hardware' : s === 'simulator' ? 'Simulator' : '—';
  }
  function renderTopbar() {
    var b = $('srcBadge'), s = String(get(DV(), 'source', get(D(), 'source', '')) || '').toLowerCase();
    if (b) {
      var txt = s === 'hardware' ? 'HARDWARE' : s === 'simulator' ? 'SIMULATOR' : '—';
      if (MOCK) txt = 'PREVIEW · ' + (txt === '—' ? 'MOCK' : txt);
      b.textContent = txt;
      b.className = 'badge ' + (MOCK ? 'mock' : s === 'hardware' ? 'hw' : s === 'simulator' ? 'sim' : '');
    }
    var pill = $('onlinePill'), age = ageNow(), on = isOnline();
    if (pill) {
      pill.className = 'pill ' + (!S.everOk ? '' : on ? 'on' : 'off');
      var t = !S.everOk ? (S.fetchFailed ? 'Offline · dashboard server unreachable' : 'Connecting…') :
        on ? 'Online · last update ' + fmtAgo(age) :
          (S.fetchOk ? (get(DV(), 'received_at', null) == null ? 'Offline · waiting for the first uplink from the sink' : 'Offline · sink silent, last data ' + fmtAgo(age)) : 'Offline · server unreachable, showing last data');
      setText('onlineText', t);
    }
    setText('tbSf', get(D(), 'sf', null) != null ? '#' + get(D(), 'sf', '') : '—');
    var nn = netNow();
    setText('tbNet', nn === null ? '—' : fmt(nn / 1000, 1, 's'));
  }
  function tickCursor() { try { updateCursor(); } catch (e) { /* never throw */ } requestAnimationFrame(tickCursor); }
  function updateCursor() {
    var cs = currentSlot(), stale = !isOnline();
    var mini = $('tbSlots');
    if (mini) {
      var slots = arr(schedule().slots);
      if (!slots.length) slots = [3, 1, 2, 3, 0, 255];
      if (mini.childElementCount !== slots.length) {
        mini.innerHTML = slots.map(function (o, i) { return '<span class="ms" title="slot ' + i + '">' + i + '</span>'; }).join('');
      }
      for (var i = 0; i < mini.children.length; i++) {
        var o = num(slots[i]);
        mini.children[i].textContent = o === 0 ? 'C' : o === 255 ? '·' : String(o);
        var inf = slotInfo(i, slots, schedule().master);
        mini.children[i].title = 'slot ' + i + ' · ' + inf.owner + ' — ' + inf.kind + (cs && cs.idx === i && !stale ? ' (now)' : '');
        mini.children[i].setAttribute('aria-label', mini.children[i].title);
        mini.children[i].classList.toggle('now', !!cs && cs.idx === i && !stale);
      }
    }
    var cur = $('r4Cursor');
    if (cur && cs) {
      cur.style.left = 'calc(' + (cs.frac * 100).toFixed(2) + '% - 1px)';
      cur.classList.toggle('stale', stale);
      var strip = $('r4Strip');
      if (strip) strip.querySelectorAll('.slot').forEach(function (el) { el.classList.toggle('now', Number(el.getAttribute('data-i')) === cs.idx && !stale); });
    }
  }

  /* ======================= router ======================= */
  function ensureBuilt(v) {
    if (S.built[v]) return;
    var el = $('view-' + v);
    if (!el || !V[v]) return;
    el.innerHTML = V[v].build();
    S.built[v] = true;
    if (V[v].init) { try { V[v].init(); } catch (e) { console.warn('init ' + v, e); } }
  }
  function renderView(v) {
    try { renderTopbar(); } catch (e) { console.warn('topbar', e); }
    if (!S.data) return;
    try { V[v].render(); } catch (e) { console.warn('render ' + v, e); }
    try { updateCursor(); } catch (e) { /* never throw */ }
  }
  function route() {
    var v = (location.hash || '#overview').slice(1);
    if (!VIEWS[v]) v = 'overview';
    S.view = v;
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-view') === v); });
    document.querySelectorAll('#nav a').forEach(function (a) {
      var on = a.getAttribute('data-view') === v;
      a.setAttribute('aria-selected', on ? 'true' : 'false');
      a.setAttribute('tabindex', on ? '0' : '-1');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    ensureBuilt(v);
    S.routeKey = {}; // force topology route redraw for the newly visible map
    renderView(v);
    Object.keys(S.charts).forEach(function (k) {
      var c = S.charts[k];
      if (c.canvas && c.canvas.closest('.view.active')) c.resize();
    });
    document.title = VIEWS[v].title + ' · AquaSense-WSN';
    closeMenu();
  }

  /* ======================= polling ======================= */
  function onData(d) {
    S.data = d;
    S.fetchOk = true; S.everOk = true; S.fetchFailed = false;
    S.recvPerf = performance.now();
    renderView(S.view);
  }
  function onFail() {
    S.fetchOk = false; S.fetchFailed = true;
    renderView(S.view);
  }
  function poll() {
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var p = MOCK ? mockNext() : fetch('/api/state', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    p.then(function (d) {
      clearTimeout(to);
      if (!d || typeof d !== 'object') throw new Error('bad payload');
      onData(d);
    }).catch(function (e) {
      clearTimeout(to);
      onFail(e);
    }).then(function () { setTimeout(poll, POLL_MS); });
  }

  /* ---------- mock mode (?mock=1): load mock_state.json and animate it ---------- */
  function mockNext() {
    if (!S.mock) {
      var mf = /^[\w-]+\.json$/.test(QS.get('mock') || '') ? QS.get('mock') : 'mock_state.json';
      return fetch((window.ASSET_BASE || '') + mf, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('mock_state.json HTTP ' + r.status);
        return r.json();
      }).then(function (d) { S.mock = d; return JSON.parse(JSON.stringify(d)); });
    }
    var d = S.mock, k = ++S.mockTick;
    function jit(v, a) { var n = num(v); return n === null ? v : Math.round((n + (Math.random() - .5) * a) * 10) / 10; }
    if (S.mockNet0 == null) S.mockNet0 = num(d.net_time) || 0;
    var age = Math.round((0.2 + Math.random() * 1.1) * 10) / 10;
    d.net_time = Math.round(S.mockNet0 + k * 1000 - age * 1000); // net_time + age stays continuous
    if (d.derived) d.derived.age_s = age;
    if (k % 3 === 0) {
      d.sf = (num(d.sf) || 0) + 1;
      if (d.schedule) { d.schedule.sf = d.sf; d.schedule.t0 = (num(d.schedule.t0) || 0) + 3000; }
      arr(d.nodes).forEach(function (n) {
        if (nNum(n.id) === 4) return;
        n.value = Math.round(jit(n.value, { 1: 30, 2: 30, 3: 30 }[nNum(n.id)] || 4));
        n.seq = (num(n.seq) || 0) + 1; n.max_seq = (num(n.max_seq) || 0) + 1; n.rx_count = (num(n.rx_count) || 0) + 1;
        n.uptime_s = (num(n.uptime_s) || 0) + 3;
        if (n.mac && typeof n.mac === 'object') { n.mac.tx = (num(n.mac.tx) || 0) + 2; n.mac.ok = (num(n.mac.ok) || 0) + 2; n.mac.bo = (num(n.mac.bo) || 0) + Math.round(Math.random() * 4); }
      });
      var ag = d.aggregation;
      if (ag) {
        ag.window = d.sf;
        if (ag.n1) ag.n1.v = get(d, 'nodes.0.value', ag.n1.v);
        if (ag.n2) ag.n2.v = get(d, 'nodes.1.value', ag.n2.v);
        if (ag.n3) ag.n3.v = get(d, 'nodes.2.value', ag.n3.v);
        if (ag.cum) { ag.cum['in'] += 2; ag.cum.out += 1; ag.cum.bytes_in += 214; ag.cum.bytes_out += 132; }
      }
      if (d.counters) { d.counters.bcast.HELLO += 4; d.counters.bcast.SCHED += 1; d.counters.ucast.DATA += 3; d.counters.ucast.AGG += 1; d.counters.ucast.STAT += 4; d.counters.ucast.ACK += 8; }
      var ser = get(d, 'derived.series', null);
      if (ser) {
        Object.keys(ser).forEach(function (key) {
          var a = ser[key];
          if (!Array.isArray(a) || !a.length) return;
          var last = a[a.length - 1];
          var nv = key === 't' ? (num(last) || 0) + 3000 :
            key === 'retx_total' ? last + (Math.random() < .2 ? 1 : 0) :
              /^pdr/.test(key) ? last :
                key === 'loc_err_N1' ? Math.max(0.5, jit(last, 3)) :
                  key === 'value_N3' || key === 'value_N1' ? Math.round(jit(last, 20)) : jit(last, Math.abs(num(last) || 1) * 0.04);
          a.push(nv);
          if (a.length > 120) a.shift();
        });
        var dv = d.derived.metrics;
        if (dv) {
          dv.retransmissions.total = ser.retx_total[ser.retx_total.length - 1];
          dv.loc_err_cm.N1.last = ser.loc_err_N1[ser.loc_err_N1.length - 1];
          dv.throughput_bps.total = ser.throughput[ser.throughput.length - 1];
        }
        var tgt = arr(get(d, 'localization.targets', []))[0];
        if (tgt && dv) { tgt.err_cm = dv.loc_err_cm.N1.last; var ang = k / 5; tgt.est = [Math.round((50 + Math.cos(ang) * tgt.err_cm) * 10) / 10, Math.round((30 + Math.sin(ang) * tgt.err_cm) * 10) / 10]; }
      }
      var types = [['DATA', 'unicast', 'N1', 'N2', '1>2'], ['DATA', 'unicast', 'N2', 'N3', '1>2>3'], ['AGG', 'unicast', 'N3', 'N4', '3>4'], ['HELLO', 'broadcast', 'N2', '*', ''], ['SCHED', 'broadcast', 'N3', '*', '']];
      var ty = types[k % types.length];
      arr(d.msg_log).unshift({ t: d.net_time - 200, type: ty[0], cast: ty[1], from: ty[2], to: ty[3], seq: d.sf, acked: ty[1] === 'unicast' ? Math.random() > 0.05 : null, path: ty[4] });
      if (d.msg_log.length > 60) d.msg_log.length = 60;
      var mevs = ['CS_BUSY', 'BACKOFF ' + Math.floor(Math.random() * 4) + ' slots', 'TX DATA q=' + d.sf, 'ACK_OK', 'DEFER'];
      arr(d.mac_log).unshift({ t: d.net_time - 150, node: ['N1', 'N2', 'N3'][k % 3], ev: mevs[k % mevs.length] });
      if (d.mac_log.length > 60) d.mac_log.length = 60;
    }
    return Promise.resolve(JSON.parse(JSON.stringify(d)));
  }

  /* ======================= commands ======================= */
  function toast(msg, err) {
    var box = $('toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }
  function sendCommand(btn, cmd) {
    if (btn) { btn.disabled = true; setTimeout(function () { btn.disabled = false; }, 3000); }
    if (MOCK) { toast('Preview mode: “' + cmd.c + '” not sent (no server). With the server running it is queued for the sink.'); return; }
    fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.ok === false) throw new Error(res.error || 'rejected');
        toast('Command queued' + (res && res.id != null ? ' (#' + res.id + ')' : '') + ' → sink will broadcast it in the next control slot');
      })
      .catch(function (e) { toast('Command failed: ' + (e && e.message ? e.message : e), true); });
  }

  /* ======================= UI wiring ======================= */
  function openMenu() { var s = $('sidebar'); s.classList.add('open'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); }
  function closeMenu() { var s = $('sidebar'); if (!s) return; s.classList.remove('open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }

  function testLight(btn) {
    if (!btn || btn.classList.contains('loading')) return;
    if (MOCK) { toast('Preview mode: “LIGHT_TEST” not sent (no server). With the server running N4 cycles red, then green.'); return; }
    btn.classList.add('loading'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: 'LIGHT_TEST' }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (res && res.ok === false) throw new Error(res.error || 'rejected');
        toast('Light test queued' + (res && res.id != null ? ' (#' + res.id + ')' : '') + ' → N4 cycles red, then green (1 s each) after its next uplink');
      })
      .catch(function (err) { toast('Light test failed: ' + (err && err.message ? err.message : err), true); })
      .then(function () { btn.classList.remove('loading'); btn.removeAttribute('aria-busy'); btn.disabled = !isOnline(); });
  }

  document.addEventListener('click', function (e) {
    var lt = e.target.closest('[data-light-test]');
    if (lt) { testLight(lt); return; }
    var b = e.target.closest('[data-cmd]');
    if (b) {
      var cmd; try { cmd = JSON.parse(b.getAttribute('data-cmd')); } catch (x) { return; }
      if (cmd.c === 'RESET_STATS' && !window.confirm('Reset all statistics on the server?')) return;
      sendCommand(b, cmd);
      return;
    }
    var f = e.target.closest('[data-feed]');
    if (f) { S.feedFilter = f.getAttribute('data-feed'); renderView(S.view); return; }
    var l = e.target.closest('[data-loc]');
    if (l) { S.locTarget = l.getAttribute('data-loc'); renderView(S.view); return; }
    var csv = e.target.closest('#r8Csv');
    if (csv && MOCK) { e.preventDefault(); toast('Preview mode: CSV export needs the server (GET /api/export.csv).'); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-temp-warn]');
    if (!f) return;
    e.preventDefault();
    submitTempWarn(f.getAttribute('data-temp-warn'));
  });
  document.addEventListener('input', function (e) {
    var f = e.target.closest('[data-temp-warn]');
    if (!f) return;
    var p = f.getAttribute('data-temp-warn');
    e.target.setAttribute('data-dirty', '1');
    var w = $(p + 'TwField');
    if (w && w.classList.contains('invalid')) twValidate(p);
  });
  $('menuBtn').addEventListener('click', function () { if ($('sidebar').classList.contains('open')) closeMenu(); else openMenu(); });
  $('scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  $('nav').addEventListener('keydown', function (e) { // arrow-key tab navigation
    var links = Array.prototype.slice.call(document.querySelectorAll('#nav a'));
    var i = links.indexOf(document.activeElement);
    if (i < 0) return;
    var j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    j = (j + links.length) % links.length;
    links[j].focus();
    location.hash = links[j].getAttribute('href');
  });
  window.addEventListener('hashchange', route);
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { S.routeKey = {}; recolorCharts(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
  }
  if (window.Chart) {
    Chart.defaults.font.family = 'Geist, Inter, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
  }
  /* theme toggle: dark is the default; the choice is remembered per browser */
  var themeBtn = $('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      var light = root.getAttribute('data-theme') === 'light' ||
        (!root.getAttribute('data-theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      var next = light ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('aq-theme', next); } catch (e) { /* private mode */ }
      S.routeKey = {}; recolorCharts();
    });
  }

  /* ======================= boot ======================= */
  route();
  poll();
  requestAnimationFrame(tickCursor);
  setInterval(function () { try { renderTopbar(); } catch (e) { /* never throw */ } }, 250);
})();
