/**
 * The `/stats` dashboard: one static page, no dependencies. It calls
 * `/stats/summary?days=N` on the same origin and draws stat tiles, a
 * daily column chart and ranked tables. Colours follow the single-hue
 * (blue) sequential ramp with selected light / dark steps.
 */
export const STATS_DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Mahjong Stats</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --bar: #2a78d6; --bar-hover: #1c5cab; --bar-soft: #cde2fb; --bad: #e34948;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    --bar: #3987e5; --bar-hover: #86b6ef; --bar-soft: #184f95; --bad: #e66767;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
  --bar: #3987e5; --bar-hover: #86b6ef; --bar-soft: #184f95; --bad: #e66767;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 48px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 20px; }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin: 0 0 12px; text-transform: uppercase; letter-spacing: .04em; }
.controls { display: flex; gap: 6px; flex-wrap: wrap; }
button { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button[aria-pressed="true"] { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
.tile .v { font-size: 28px; font-weight: 600; line-height: 1.2; }
.tile .l { color: var(--ink-2); font-size: 12px; }
.tile .s { color: var(--muted); font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-top: 12px; }
.wide { grid-column: 1 / -1; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 5px 6px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; white-space: normal; }
th { color: var(--muted); font-weight: 500; font-size: 12px; }
td.barcell { width: 40%; }
.bar { height: 10px; border-radius: 0 4px 4px 0; background: var(--bar); min-width: 2px; }
.empty { color: var(--muted); padding: 12px 0; }
.chart { position: relative; }
.chart svg { display: block; overflow: visible; }
.chart path.col { fill: var(--bar); }
.chart rect.hit { fill: transparent; }
.chart g:hover path.col { fill: var(--bar-hover); }
.chart text { fill: var(--muted); font-size: 11px; }
.chart line { stroke: var(--grid); }
.chart line.base { stroke: var(--axis); }
.tip { position: absolute; pointer-events: none; background: var(--ink); color: var(--surface); padding: 6px 8px;
  border-radius: 6px; font-size: 12px; white-space: nowrap; transform: translate(-50%, -100%); display: none; }
.err { color: var(--bad); }
.note { color: var(--muted); font-size: 12px; margin-top: 16px; }
</style>
</head>
<body>
<main id="app"></main>
<script>
(function () {
  var app = document.getElementById('app');
  var state = { days: 30, metric: 'hands', data: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString(); }
  function pct(a, b) { return b ? Math.round((100 * a) / b) + '%' : '–'; }
  function mins(ms) { if (!ms) return '–'; var m = ms / 60000; return m < 1 ? Math.round(ms / 1000) + 's' : m.toFixed(1) + ' min'; }
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}
  function country(code) {
    if (!code || code === 'unknown' || code === 'XX' || code === 'T1') return code === 'T1' ? 'Tor' : 'Unknown';
    var flag = code.length === 2 ? String.fromCodePoint.apply(null, code.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(0); })) : '';
    var name = code;
    try { name = regionNames ? regionNames.of(code) : code; } catch (e) {}
    return flag + '\u00a0' + name;
  }

  function load() {
    fetch('/stats/summary?days=' + state.days)
      .then(function (r) {
        if (!r.ok) throw new Error('Summary failed (' + r.status + ').');
        return r.json();
      })
      .then(function (d) { state.data = d; render(); })
      .catch(function (e) { app.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }

  function sum(rows, key) { return rows.reduce(function (a, r) { return a + Number(r[key] || 0); }, 0); }

  function barTable(rows, cols, valueKey, empty) {
    var withBar = valueKey !== null;
    if (!rows.length) return '<div class="empty">' + (empty || 'No data yet') + '</div>';
    var max = withBar ? Math.max.apply(null, rows.map(function (r) { return Number(r[valueKey] || 0); })) || 1 : 1;
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + (withBar ? '<th></th>' : '') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + cols.map(function (c) { return '<td>' + (c.html ? c.html(r) : esc(c.fmt ? c.fmt(r) : fmt(r[c.key]))) + '</td>'; }).join('') +
        (withBar ? '<td class="barcell"><div class="bar" style="width:' + (100 * Number(r[valueKey] || 0) / max) + '%"></div></td>' : '') + '</tr>';
    }).join('');
    return '<table>' + head + body + '</table>';
  }

  // Single-series column chart with hover tooltip. rows: [{label, value, tip}].
  // Drawn after insertion at the container's real pixel width so text
  // never stretches; \`render\` re-draws on resize.
  var charts = [];
  function columns(id, rows, opts) {
    if (!rows.length) return '<div class="empty">No data yet</div>';
    charts.push({ id: id, rows: rows, opts: opts || {} });
    return '<div class="chart" id="' + id + '"></div>';
  }
  function drawChart(c) {
    var el = document.getElementById(c.id); if (!el) return;
    var rows = c.rows, W = Math.max(200, el.clientWidth), H = 220, padL = 36, padB = 22, padT = 8;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.max(1, Math.ceil(max / step) * step);
    var ticks = top % 2 === 0 ? [0, top / 2, top] : [0, top];
    var slot = (W - padL) / rows.length, bw = Math.max(2, Math.min(slot - 2, 56));
    var y = function (v) { return H - padB - (v / top) * (H - padB - padT); };
    var grid = ticks.map(function (v) {
      var yy = y(v);
      return '<line ' + (v === 0 ? 'class="base" ' : '') + 'x1="' + padL + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '"/>' +
        '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmt(v) + '</text>';
    }).join('');
    var every = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor((W - padL) / 56))));
    var cols = rows.map(function (r, i) {
      var cx = padL + i * slot + slot / 2, x = cx - bw / 2, yy = y(r.value), h = H - padB - yy;
      var rad = Math.min(4, bw / 2, h);
      var path = h > 0 ? '<path class="col" d="M' + x + ',' + (H - padB) + 'V' + (yy + rad) + 'q0,-' + rad + ' ' + rad + ',-' + rad +
        'H' + (x + bw - rad) + 'q' + rad + ',0 ' + rad + ',' + rad + 'V' + (H - padB) + 'Z"/>' : '';
      var label = i % every === 0 ? '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(r.label) + '</text>' : '';
      return '<g data-i="' + i + '"><rect class="hit" x="' + (padL + i * slot) + '" y="' + padT + '" width="' + slot + '" height="' + (H - padB - padT) + '"/>' + path + label + '</g>';
    }).join('');
    el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + grid + cols + '</svg><div class="tip"></div>';
    wireTip(c.id, rows);
  }
  function wireTip(id, rows) {
    var el = document.getElementById(id); if (!el) return;
    var tip = el.querySelector('.tip');
    el.querySelectorAll('g[data-i]').forEach(function (g) {
      g.addEventListener('mouseenter', function () {
        var r = rows[Number(g.getAttribute('data-i'))];
        var box = g.getBoundingClientRect(), host = el.getBoundingClientRect();
        tip.innerHTML = r.tip; tip.style.display = 'block';
        var half = tip.offsetWidth / 2, cx = box.left - host.left + box.width / 2;
        tip.style.left = Math.min(Math.max(cx, half), host.width - half) + 'px';
        tip.style.top = Math.max(0, (box.top - host.top) - 4) + 'px';
      });
      g.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    });
  }

  function dailySeries(d) {
    var byDay = {};
    d.daily.forEach(function (r) { byDay[r.day] = r; });
    var out = [], start = new Date(d.since + 'T00:00:00Z');
    for (var i = 0; i < d.days; i++) {
      var day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      var r = byDay[day] || {};
      out.push({
        label: day.slice(5), value: Number(r[state.metric] || 0),
        tip: '<b>' + day + '</b><br>' + fmt(r.players || 0) + ' players · ' + fmt(r.matches || 0) + ' matches · ' + fmt(r.hands || 0) + ' hands',
      });
    }
    return out;
  }

  function render() {
    var d = state.data;
    charts = [];
    var matches = sum(d.modes, 'matches'), hands = sum(d.hands, 'hands');
    var solo = d.soloOutcomes, soloTotal = sum(solo, 'n');
    var me = solo.filter(function (r) { return r.winner === 'me'; })[0] || {};
    var drawn = solo.filter(function (r) { return r.winner === 'draw'; })[0] || {};
    var durRows = d.hands.filter(function (r) { return r.avgDurationMs; });
    var avgDur = durRows.length ? sum(durRows.map(function (r) { return { v: r.avgDurationMs * r.reports }; }), 'v') / sum(durRows, 'reports') : 0;
    var abandoned = sum(d.modes, 'abandoned');
    var rangeBtns = [7, 30, 90, 365].map(function (n) {
      return '<button data-days="' + n + '" aria-pressed="' + (state.days === n) + '">' + (n === 365 ? '1y' : n + 'd') + '</button>';
    }).join('');
    var metricBtns = ['players', 'matches', 'hands'].map(function (m) {
      return '<button data-metric="' + m + '" aria-pressed="' + (state.metric === m) + '">' + m[0].toUpperCase() + m.slice(1) + '</button>';
    }).join('');
    var tile = function (v, l, s) { return '<div class="card tile"><div class="v">' + v + '</div><div class="l">' + l + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; };
    var countries = d.countries.slice().sort(function (a, b) { return (b.players || 0) - (a.players || 0) || (b.hands || 0) - (a.hands || 0); }).slice(0, 25);

    app.innerHTML =
      '<header><h1>Mahjong stats <span class="note">since ' + esc(d.since) + '</span></h1>' +
      '<div class="controls">' + rangeBtns + '</div></header>' +
      '<section class="tiles">' +
        tile(fmt(d.players), 'Active players', fmt(d.newPlayers) + ' new') +
        tile(fmt(matches), 'Matches started', pct(abandoned, matches) + ' left before a hand finished') +
        tile(fmt(hands), 'Hands played', 'online hands counted once per table') +
        tile(soloTotal ? pct(me.n || 0, soloTotal) : '–', 'Player win rate vs bots', pct(drawn.n || 0, soloTotal) + ' drawn games') +
        tile(mins(avgDur), 'Average hand length') +
      '</section>' +
      '<section class="card"><header style="margin-bottom:8px"><h2 style="margin:0">Daily activity</h2><div class="controls">' + metricBtns + '</div></header>' +
        columns('daily', dailySeries(d), { maxLabels: 12 }) + '</section>' +
      '<section class="grid">' +
        '<div class="card"><h2>Where players are</h2>' + barTable(countries, [
          { label: 'Country', html: function (r) { return esc(country(r.country)); } },
          { label: 'Players', key: 'players' }, { label: 'Matches', key: 'matches' }, { label: 'Hands', key: 'hands' },
        ], 'players') + '</div>' +
        '<div class="card"><h2>Top cities</h2>' + barTable(d.cities, [
          { label: 'City', html: function (r) { return esc(r.city) + ' <span class="note">' + esc(r.country || '') + '</span>'; } },
          { label: 'Players', key: 'n' },
        ], 'n') + '</div>' +
        '<div class="card"><h2>Modes</h2>' + barTable(d.modes.map(function (m) {
            var h = d.hands.filter(function (x) { return x.mode === m.mode; })[0] || {};
            return Object.assign({}, m, h);
          }), [
          { label: 'Mode', key: 'mode', fmt: function (r) { return r.mode; } },
          { label: 'Matches', key: 'matches' },
          { label: 'Hands', key: 'hands' },
          { label: 'Hands / match', fmt: function (r) { return r.avgHands == null ? '–' : Number(r.avgHands).toFixed(1); } },
          { label: 'Self-drawn', fmt: function (r) { return pct(r.selfDraws || 0, r.wins || 0); } },
        ], null) + '</div>' +
        '<div class="card"><h2>Platforms</h2>' + barTable(d.platforms, [
          { label: 'Platform', key: 'platform', fmt: function (r) { return r.platform || 'unknown'; } },
          { label: 'Players', key: 'n' },
        ], 'n') + '</div>' +
        '<div class="card"><h2>Winning hand size (faan)</h2>' + columns('faan', d.faan.map(function (r) {
          return { label: String(r.faan), value: Number(r.n), tip: '<b>' + r.faan + ' faan</b><br>' + fmt(r.n) + ' wins' };
        }), { maxLabels: 14 }) + '</div>' +
        '<div class="card"><h2>Most common scoring patterns</h2>' + barTable(d.patterns, [
          { label: 'Pattern', key: 'pattern', fmt: function (r) { return r.pattern; } }, { label: 'Wins', key: 'n' },
        ], 'n') + '</div>' +
        '<div class="card"><h2>Solo results</h2>' + barTable(solo.map(function (r) {
            return Object.assign({ label: { me: 'Player won', bot: 'A bot won', human: 'Another human won', draw: 'Drawn game' }[r.winner] || r.winner }, r);
          }), [
          { label: 'Outcome', key: 'label', fmt: function (r) { return r.label; } },
          { label: 'Hands', key: 'n' }, { label: 'Share', fmt: function (r) { return pct(r.n, soloTotal); } },
        ], 'n') + '</div>' +
        '<div class="card"><h2>Solo bot line-ups</h2>' + barTable(d.botMixes, [
          { label: 'Bots', key: 'mix', fmt: function (r) { return String(r.mix).split(',').join(' · '); } }, { label: 'Matches', key: 'n' },
        ], 'n') + '</div>' +
        '<div class="card"><h2>Tutorials started</h2>' + barTable(d.tutorials, [
          { label: 'Lesson', key: 'lesson', fmt: function (r) { return r.lesson || '–'; } },
          { label: 'Starts', key: 'n' }, { label: 'Players', key: 'players' },
        ], 'n') + '</div>' +
      '</section>' +
      '<p class="note">Geography comes from Cloudflare at request time; no IP addresses are stored. Players are counted by an anonymous per-device id.</p>';

    charts.forEach(drawChart);
    app.querySelectorAll('[data-days]').forEach(function (b) {
      b.onclick = function () { state.days = Number(b.getAttribute('data-days')); load(); };
    });
    app.querySelectorAll('[data-metric]').forEach(function (b) {
      b.onclick = function () { state.metric = b.getAttribute('data-metric'); render(); };
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { charts.forEach(drawChart); }, 120);
  });

  load();
})();
</script>
</body>
</html>
`;
