/* global uPlot */
(function () {
  const vscode = acquireVsCodeApi();
  let paused = false;
  let uplot = null;
  let legendKey = '';
  /** When true, Y scale is user-controlled and will not auto-fit. */
  let userYZoom = false;
  /** When true, X span is user-set via zoom; follow still slides the window. */
  let userXZoom = false;
  /** Live strip-chart follow: always slide X window to the newest sample. */
  let followLive = true;
  /** Visible time span in ms when following; null = auto (use data range). */
  let xSpanMs = null;
  let applyingFollow = false;
  const DEFAULT_SPAN_MS = 10_000;
  const MIN_SPAN_MS = 500;

  function DisplayRing(capacity) {
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.head = 0;
    this.len = 0;
  }
  DisplayRing.prototype.push = function (x, y) {
    if (this.len < this.capacity) {
      var i = (this.head + this.len) % this.capacity;
      this.xs[i] = x;
      this.ys[i] = y;
      this.len += 1;
      return;
    }
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    this.head = (this.head + 1) % this.capacity;
  };
  DisplayRing.prototype.materialize = function () {
    var ox = new Array(this.len);
    var oy = new Array(this.len);
    for (var i = 0; i < this.len; i++) {
      var idx = (this.head + i) % this.capacity;
      ox[i] = this.xs[idx];
      oy[i] = this.ys[idx];
    }
    return { xs: ox, ys: oy };
  };
  DisplayRing.prototype.clear = function () {
    this.head = 0;
    this.len = 0;
  };
  // Must stay API-compatible with src/store/displayRing.ts —
  // latestSampleTime() / dataTimeRange() use count + xAt().
  Object.defineProperty(DisplayRing.prototype, 'count', {
    get: function () {
      return this.len;
    },
  });
  DisplayRing.prototype.xAt = function (i) {
    return this.xs[(this.head + i) % this.capacity];
  };
  DisplayRing.prototype.yAt = function (i) {
    return this.ys[(this.head + i) % this.capacity];
  };

  var DISPLAY_CAP = 4096;
  var plotGeneration = -1;
  var expectedSeq = -1;
  var channels = new Map();

  function ensureChannel(meta) {
    var ch = channels.get(meta.id);
    if (!ch) {
      ch = {
        id: meta.id,
        name: meta.displayName || meta.name || meta.id,
        color: meta.color || '#3b82f6',
        visible: meta.visible !== false,
        ring: new DisplayRing(DISPLAY_CAP),
      };
      channels.set(meta.id, ch);
    } else {
      if (meta.displayName || meta.name) ch.name = meta.displayName || meta.name;
      if (meta.color) ch.color = meta.color;
      if (meta.visible !== undefined) ch.visible = meta.visible;
    }
    return ch;
  }

  function orderedChannels() {
    return Array.from(channels.values());
  }

  /** Y auto-fit: only points inside current X window; always include 0; zero mid-plot. */
  /**
   * Y auto-fit for the visible X window.
   * Uses a robust (2–98%) range so a single spike does not flatten the rest
   * of the traces. Always includes 0. Not forced fully symmetric — that
   * wasted half the plot when data sits on one side of zero.
   */
  function yRangeInXWindow(u, dataMin, dataMax) {
    if (userYZoom && u.scales.y.min != null && u.scales.y.max != null) {
      return [u.scales.y.min, u.scales.y.max];
    }
    var fullMin = Infinity;
    var fullMax = -Infinity;
    var samples = [];
    var xmin = u.scales.x.min;
    var xmax = u.scales.x.max;
    var xs = u.data[0] || [];
    var total = xs.length;
    var stride = total > 4000 ? Math.ceil(total / 4000) : 1;
    for (var si = 1; si < u.data.length; si++) {
      var ys = u.data[si];
      if (!ys) continue;
      if (u.series[si] && u.series[si].show === false) continue;
      for (var i = 0; i < total; i += stride) {
        var x = xs[i];
        if (x == null) continue;
        if (xmin != null && x < xmin) continue;
        if (xmax != null && x > xmax) continue;
        var y = ys[i];
        if (y == null) continue;
        if (y < fullMin) fullMin = y;
        if (y > fullMax) fullMax = y;
        samples.push(y);
      }
    }
    if (samples.length === 0) {
      var lo0 = dataMin != null ? dataMin : 0;
      var hi0 = dataMax != null ? dataMax : 0;
      lo0 = Math.min(lo0, 0);
      hi0 = Math.max(hi0, 0);
      if (!(hi0 > lo0)) {
        lo0 = -1;
        hi0 = 1;
      }
      var pad0 = (hi0 - lo0) * 0.08;
      return [lo0 - pad0, hi0 + pad0];
    }
    samples.sort(function (a, b) {
      return a - b;
    });
    var pLo = samples[Math.floor(samples.length * 0.02)];
    var pHi = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.98))];
    var robustSpan = pHi - pLo;
    var fullSpan = fullMax - fullMin;
    var lo;
    var hi;
    if (robustSpan > 0 && fullSpan > robustSpan * 6) {
      // Spike-dominated: ignore extreme outliers for auto-scale.
      lo = pLo;
      hi = pHi;
    } else {
      lo = fullMin;
      hi = fullMax;
    }
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (!(hi > lo)) {
      lo = -1;
      hi = 1;
    }
    var pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function buildData(list) {
    var seriesMeta = list.map(function (ch) {
      return ch.ring.materialize();
    });
    var maxXs = seriesMeta.length ? seriesMeta[0].xs : [];
    for (var i = 1; i < seriesMeta.length; i++) {
      if (seriesMeta[i].xs.length > maxXs.length) maxXs = seriesMeta[i].xs;
    }
    var data = [maxXs];
    for (var j = 0; j < seriesMeta.length; j++) {
      var ys = seriesMeta[j].ys;
      if (ys.length < maxXs.length) {
        ys = new Array(maxXs.length - ys.length).fill(null).concat(ys);
      } else if (ys.length > maxXs.length) {
        ys = ys.slice(ys.length - maxXs.length);
      }
      data.push(ys);
    }
    return data;
  }

  function renderPlot() {
    var list = orderedChannels();
    if (list.length === 0) {
      if (uplot) {
        uplot.destroy();
        uplot = null;
      }
      renderLegend(list);
      return;
    }
    var el = document.getElementById('plot');
    var data = buildData(list);
    var key = list.map(function (c) { return c.id; }).join('|');
    var opts = {
      width: el.clientWidth || 600,
      height: 280,
      series: [{}].concat(
        list.map(function (c) {
          return { label: c.name, stroke: c.color, show: !!c.visible };
        })
      ),
      scales: {
        x: { time: false },
        y: { range: yRangeInXWindow },
      },
      axes: [
        {
          label: 't_ms',
          size: 44,
          scale: 'x',
          stroke: '#f0f0f0',
          font: '12px sans-serif',
          grid: { show: true, stroke: 'rgba(160,160,160,0.28)', width: 1 },
          ticks: { show: true, stroke: 'rgba(200,200,200,0.55)', width: 1, size: 6 },
          labelFont: '12px sans-serif',
        },
        {
          label: 'value',
          size: 52,
          scale: 'y',
          stroke: '#f0f0f0',
          font: '12px sans-serif',
          grid: { show: true, stroke: 'rgba(160,160,160,0.28)', width: 1 },
          ticks: { show: true, stroke: 'rgba(200,200,200,0.55)', width: 1, size: 6 },
          labelFont: '12px sans-serif',
        },
      ],
      legend: { show: false },
      cursor: {
        show: true,
        points: { size: 4 },
        drag: {
          x: true,
          y: true,
          setScale: true,
          uni: 12,
        },
      },
      hooks: {
        dblclick: [
          function (u) {
            resetZoom(u);
          },
        ],
        setScale: [
          function (u, key) {
            if (applyingFollow) return;
            if (key === 'x') {
              userXZoom = true;
              var x0 = u.scales.x.min;
              var x1 = u.scales.x.max;
              if (x0 != null && x1 != null && x1 > x0) {
                xSpanMs = Math.max(x1 - x0, MIN_SPAN_MS);
              }
              updateSpanReadout(x0, x1);
            }
            if (key === 'y') userYZoom = true;
          },
        ],
      },
    };

    if (!uplot || uplot.__key !== key) {
      if (uplot) uplot.destroy();
      uplot = new uPlot(opts, data, el);
      uplot.__key = key;
      // Constructor fires initial auto setScale hooks — do not treat as user zoom.
      userXZoom = false;
      userYZoom = false;
      applyFollow();
    } else {
      uplot.setData(data, false);
      syncSeriesVisibility(list);
      if (followLive) {
        applyFollow();
      } else {
        // Refresh data only; keep the user's historical window.
        uplot.redraw(false);
      }
    }
    renderLegend(list);
  }

  function forceXRange(min, max) {
    if (!uplot) return;
    // uPlot 1.6 setScale is microtask-committed; default redraw() would
    // immediately _setScale() from the OLD scaleX.min/max and clobber us.
    // batch() commits setScale synchronously while applyingFollow is still true.
    applyingFollow = true;
    try {
      uplot.batch(function () {
        uplot.setScale('x', { min: min, max: max });
      });
    } finally {
      applyingFollow = false;
    }
    var sMin = uplot.scales.x.min != null ? uplot.scales.x.min : min;
    var sMax = uplot.scales.x.max != null ? uplot.scales.x.max : max;
    updateSpanReadout(sMin, sMax);
  }

  function forceYAuto() {
    if (!uplot) return;
    applyingFollow = true;
    try {
      uplot.batch(function () {
        uplot.setScale('y', { min: null, max: null });
      });
    } finally {
      applyingFollow = false;
    }
  }

  function syncSeriesVisibility(list) {
    if (!uplot) return;
    for (var i = 0; i < list.length; i++) {
      var idx = i + 1;
      if (!uplot.series[idx]) continue;
      var want = !!list[i].visible;
      if (!!uplot.series[idx].show !== want) {
        uplot.setSeries(idx, { show: want });
      }
    }
  }

  function latestSampleTime() {
    var t = null;
    channels.forEach(function (ch) {
      if (ch.ring.count > 0) {
        var last = ch.ring.xAt(ch.ring.count - 1);
        if (t === null || last > t) t = last;
      }
    });
    return t;
  }

  /**
   * Strip-chart follow: always keep the newest sample near the right edge.
   * Window width = xSpanMs (set by zoom, default 10s).
   * While data is younger than the span, the window grows from t=0 (left edge
   * stays at 0 and the right edge advances with latest).
   */
  function applyFollow() {
    if (!uplot || !followLive) return;
    var latest = latestSampleTime();
    if (latest == null) return;

    var span = xSpanMs;
    if (span == null || !(span > 0)) {
      span = DEFAULT_SPAN_MS;
    }
    if (span < MIN_SPAN_MS) span = MIN_SPAN_MS;
    xSpanMs = span;

    var pad = span * 0.05;
    var xmax = latest + pad;
    var xmin = xmax - span;
    if (xmin < 0) {
      xmin = 0;
      xmax = latest + pad;
    }
    forceXRange(xmin, xmax);
    if (!userYZoom) forceYAuto();
  }

  function updateSpanReadout(xmin, xmax) {
    var el = document.getElementById('span-info');
    if (!el) return;
    if (xmin == null || xmax == null) {
      el.textContent = '';
      return;
    }
    el.textContent = 't ' + Math.round(xmin) + '–' + Math.round(xmax) + ' ms';
  }

  function setFollow(on) {
    followLive = !!on;
    var btn = document.getElementById('follow-live');
    if (btn) {
      btn.textContent = followLive ? '跟随:开' : '跟随:关';
      btn.title = followLive
        ? '新数据到达右缘时自动向前滚动；仍可自由缩放'
        : '不自动滚动，可自由缩放查看任意区间';
    }
    if (followLive) applyFollow();
  }

  function dataTimeRange() {
    var min = null;
    var max = null;
    channels.forEach(function (ch) {
      if (ch.ring.count === 0) return;
      var a = ch.ring.xAt(0);
      var b = ch.ring.xAt(ch.ring.count - 1);
      if (min === null || a < min) min = a;
      if (max === null || b > max) max = b;
    });
    return { min: min, max: max };
  }

  function resetZoom() {
    userXZoom = false;
    userYZoom = false;
    xSpanMs = null;
    if (!uplot) return;
    var range = dataTimeRange();
    if (range.min != null && range.max != null && range.max > range.min) {
      var pad = (range.max - range.min) * 0.02;
      forceXRange(range.min - pad, range.max + pad);
    }
    forceYAuto();
    userYZoom = false;
    setFollow(true);
    applyFollow();
  }

  function onPlotWheel(e) {
    if (!uplot) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var zoomY = e.ctrlKey || e.metaKey || e.shiftKey;
    var factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    if (e.ctrlKey || e.metaKey) {
      zoomY = true;
      factor = e.deltaY > 0 ? 1.06 : 1 / 1.06;
    }
    e.preventDefault();
    if (zoomY) {
      userYZoom = true;
      var yv = uplot.posToVal(py, 'y');
      var y0 = uplot.scales.y.min;
      var y1 = uplot.scales.y.max;
      if (y0 == null || y1 == null) return;
      uplot.batch(function () {
        uplot.setScale('y', {
          min: yv + (y0 - yv) * factor,
          max: yv + (y1 - yv) * factor,
        });
      });
    } else {
      var xv = uplot.posToVal(px, 'x');
      var x0 = uplot.scales.x.min;
      var x1 = uplot.scales.x.max;
      if (x0 == null || x1 == null) return;
      var nmin = xv + (x0 - xv) * factor;
      var nmax = xv + (x1 - xv) * factor;
      if (nmax - nmin < MIN_SPAN_MS) {
        var mid = (nmin + nmax) / 2;
        nmin = mid - MIN_SPAN_MS / 2;
        nmax = mid + MIN_SPAN_MS / 2;
      }
      // VOFA-like: always apply the zoomed window under the cursor.
      xSpanMs = nmax - nmin;
      userXZoom = true;
      applyingFollow = true;
      try {
        uplot.batch(function () {
          uplot.setScale('x', { min: nmin, max: nmax });
          if (!userYZoom) uplot.setScale('y', { min: null, max: null });
        });
      } finally {
        applyingFollow = false;
      }
      updateSpanReadout(
        uplot.scales.x.min != null ? uplot.scales.x.min : nmin,
        uplot.scales.x.max != null ? uplot.scales.x.max : nmax
      );
      // If follow is on, keep this span but stay glued to the live edge.
      if (followLive) applyFollow();
    }
  }

  document.getElementById('plot').addEventListener('wheel', onPlotWheel, { passive: false });

  function toggleChannel(id, visible) {
    var c = channels.get(id);
    if (c) c.visible = visible;
    vscode.postMessage({ type: 'toggleChannel', id: id, visible: visible });
    var list = orderedChannels();
    if (uplot) {
      syncSeriesVisibility(list);
      if (!userYZoom) {
        uplot.setScale('y', { min: null, max: null });
      }
    } else {
      renderPlot();
    }
  }

  /** Rebuild legend only when the channel set changes — not every data tick. */
  function renderLegend(list) {
    var legend = document.getElementById('legend');
    var key = list.map(function (c) { return c.id; }).join('|');
    if (key === legendKey) {
      // Update checked state in place so clicks are never destroyed mid-event.
      var boxes = legend.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < list.length && i < boxes.length; i++) {
        if (boxes[i].checked !== !!list[i].visible) boxes[i].checked = !!list[i].visible;
      }
      return;
    }
    legendKey = key;
    legend.innerHTML = '';
    for (var j = 0; j < list.length; j++) {
      var ch = list[j];
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!ch.visible;
      cb.dataset.id = ch.id;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + ch.name));
      label.style.color = ch.color;
      legend.appendChild(label);
    }
  }

  // One delegated listener — survives in-place checkbox updates.
  document.getElementById('legend').addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.type !== 'checkbox') return;
    var id = t.getAttribute('data-id');
    if (!id) return;
    toggleChannel(id, !!t.checked);
  });

  function applySnapshot(msg) {
    if (msg.generation < plotGeneration) return;
    plotGeneration = msg.generation;
    expectedSeq = msg.seq + 1;
    var series = msg.series || [];
    var seen = new Set();
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      seen.add(s.id);
      var prev = channels.get(s.id);
      var ch = ensureChannel(s);
      if (prev && s.visible === undefined) ch.visible = prev.visible;
      ch.ring.clear();
      var xs = s.xs || [];
      var ys = s.ys || [];
      for (var k = 0; k < xs.length; k++) ch.ring.push(xs[k], ys[k]);
    }
    channels.forEach(function (_v, id) {
      if (!seen.has(id)) channels.delete(id);
    });
    renderPlot();
  }

  function applyDelta(msg) {
    if (msg.generation !== plotGeneration) return;
    if (msg.seq !== expectedSeq) {
      vscode.postMessage({ type: 'plot.needSnapshot', reason: 'seq-gap' });
      return;
    }
    expectedSeq = msg.seq + 1;
    var series = msg.series || [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      var ch = ensureChannel({ id: s.id });
      var xs = s.xs || [];
      var ys = s.ys || [];
      for (var k = 0; k < xs.length; k++) ch.ring.push(xs[k], ys[k]);
    }
    renderPlot();
  }

  function applyReset(msg) {
    plotGeneration = msg.generation;
    expectedSeq = msg.seq + 1;
    channels.clear();
    legendKey = '';
    userXZoom = false;
    userYZoom = false;
    xSpanMs = null;
    if (uplot) {
      uplot.destroy();
      uplot = null;
    }
    document.getElementById('plot').innerHTML = '';
    document.getElementById('legend').innerHTML = '';
  }

  function appendTerm(entries) {
    var term = document.getElementById('term');
    var rxEnc = document.getElementById('rx-enc').value;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var line = document.createElement('div');
      var show = rxEnc === 'hex' ? e.hex : e.text;
      line.textContent = '[' + e.dir + '] ' + show;
      term.appendChild(line);
    }
    while (term.childElementCount > 2000) term.removeChild(term.firstChild);
    term.scrollTop = term.scrollHeight;
  }

  document.getElementById('pause').addEventListener('click', function () {
    paused = !paused;
    document.getElementById('pause').textContent = paused ? '继续' : '暂停';
    vscode.postMessage({ type: 'pause', paused: paused });
  });
  document.getElementById('clear-term').addEventListener('click', function () {
    document.getElementById('term').innerHTML = '';
    vscode.postMessage({ type: 'clearTerminal' });
  });
  document.getElementById('clear-wave').addEventListener('click', function () {
    vscode.postMessage({ type: 'clearWaveform' });
  });
  document.getElementById('reset-zoom').addEventListener('click', function () {
    resetZoom();
  });
  document.getElementById('follow-live').addEventListener('click', function () {
    setFollow(!followLive);
  });
  setFollow(true);
  renderParams();
  document.getElementById('rx-enc').addEventListener('change', function (e) {
    vscode.postMessage({ type: 'setRxEncoding', encoding: e.target.value });
  });
  document.getElementById('tx-send').addEventListener('click', function () {
    var payload = document.getElementById('tx-input').value;
    vscode.postMessage({
      type: 'send',
      encoding: document.getElementById('tx-enc').value,
      lineEnding: document.getElementById('tx-eol').value,
      payload: payload,
    });
  });
  document.getElementById('tx-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('tx-send').click();
  });

  // --- Parameter Inspector (presentation only; Host ParameterStore is truth) ---
  var paramById = new Map();
  var paramSessionState = 'disconnected';
  var paramDeviceName = '';
  var paramFw = '';
  var paramQuery = '';
  var paramEditing = new Map(); // id -> raw text while focused

  function fmtParam(v, type) {
    if (v === undefined || v === null) return '';
    if (type === 'bool') return v ? 'true' : 'false';
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    if (type === 'int32' || type === 'uint32') return String(Math.trunc(n));
    if (Number.isInteger(n)) return String(n);
    var abs = Math.abs(n);
    if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) return n.toExponential(4);
    return n.toFixed(6).replace(/\.?0+$/, '');
  }

  function localValidate(p, raw) {
    if (!p.writable) return { ok: false, error: 'read-only' };
    if (p.type === 'bool') {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      var s = String(raw).toLowerCase();
      if (s === 'true' || s === '1') return { ok: true, value: true };
      if (s === 'false' || s === '0') return { ok: true, value: false };
      return { ok: false, error: 'bool' };
    }
    var n = Number(String(raw).trim());
    if (!isFinite(n)) return { ok: false, error: 'number' };
    if ((p.type === 'int32' || p.type === 'uint32') && !Number.isInteger(n)) {
      return { ok: false, error: 'integer' };
    }
    if (p.type === 'uint32' && n < 0) return { ok: false, error: 'uint32 >= 0' };
    if (p.min !== undefined && n < p.min) return { ok: false, error: 'min ' + p.min };
    if (p.max !== undefined && n > p.max) return { ok: false, error: 'max ' + p.max };
    return { ok: true, value: n };
  }

  function paramMatches(p, q) {
    if (!q) return true;
    var path = p.path.toLowerCase();
    if (path.indexOf(q) >= 0) return true;
    var leaf = path.slice(path.lastIndexOf('.') + 1);
    if (leaf.indexOf(q) >= 0) return true;
    if (p.unit && String(p.unit).toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }

  function buildTree(list) {
    var root = [];
    var map = {};
    function ensure(full, name) {
      if (map[full]) return map[full];
      var node = { name: name, fullPath: full, children: [], parameter: null };
      map[full] = node;
      var dot = full.lastIndexOf('.');
      if (dot > 0) {
        var parent = full.slice(0, dot);
        ensure(parent, parent.slice(parent.lastIndexOf('.') + 1)).children.push(node);
      } else {
        root.push(node);
      }
      return node;
    }
    var sorted = list.slice().sort(function (a, b) {
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var parts = p.path.split('.').filter(Boolean);
      if (!parts.length) continue;
      var acc = '';
      for (var j = 0; j < parts.length - 1; j++) {
        acc = acc ? acc + '.' + parts[j] : parts[j];
        ensure(acc, parts[j]);
      }
      var leaf = ensure(parts.join('.'), parts[parts.length - 1]);
      leaf.parameter = p;
    }
    return root;
  }

  function renderParams() {
    var stateEl = document.getElementById('params-state');
    var devEl = document.getElementById('params-device');
    var listEl = document.getElementById('params-list');
    if (!listEl) return;

    var stateText = {
      disconnected: '未连接 Native 设备',
      handshaking: '正在握手…',
      discovering: '正在发现参数…',
      ready: '已就绪',
      incompatible: '协议版本不兼容',
      discovery_failed: '参数发现超时/失败',
    };
    stateEl.textContent = stateText[paramSessionState] || paramSessionState;
    if (paramSessionState === 'ready') {
      devEl.textContent =
        (paramDeviceName || 'Device') +
        (paramFw ? ' · FW ' + paramFw : '') +
        ' · ' +
        paramById.size +
        ' Parameters';
    } else {
      devEl.textContent = '';
    }

    if (paramSessionState !== 'ready') {
      listEl.innerHTML = '<div class="param-empty"></div>';
      return;
    }
    if (paramById.size === 0) {
      listEl.innerHTML = '<div class="param-empty">设备未声明参数</div>';
      return;
    }

    var q = paramQuery.trim().toLowerCase();
    var visible = [];
    paramById.forEach(function (p) {
      if (paramMatches(p, q)) visible.push(p);
    });
    if (!visible.length) {
      listEl.innerHTML = '<div class="param-empty">无匹配参数</div>';
      return;
    }

    var tree = buildTree(visible);
    listEl.innerHTML = '';
    function renderNode(node, depth) {
      if (node.parameter) {
        var p = node.parameter;
        var row = document.createElement('div');
        row.className = 'param-row';
        row.dataset.id = String(p.id);
        if (p.pending) row.classList.add('pending');
        if (p.lastError) row.classList.add('err');
        else if (!p.pending && p.confirmedValue !== undefined) row.classList.add('ok');

        var name = document.createElement('span');
        name.className = 'pname';
        name.textContent = node.name;
        name.title = p.path;
        row.appendChild(name);

        if (p.type === 'bool') {
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!p.confirmedValue;
          cb.disabled = !p.writable || !!p.pending;
          cb.addEventListener('change', function () {
            if (!p.writable || p.pending) return;
            vscode.postMessage({ type: 'parameter.set', parameterId: p.id, value: cb.checked });
          });
          row.appendChild(cb);
        } else {
          var input = document.createElement('input');
          input.type = 'text';
          input.inputMode = p.type === 'float32' ? 'decimal' : 'numeric';
          if (p.min !== undefined) input.title = 'min ' + p.min + (p.max !== undefined ? ' max ' + p.max : '');
          var editing = paramEditing.get(p.id);
          input.value = editing !== undefined ? editing : fmtParam(p.confirmedValue, p.type);
          input.disabled = !p.writable || !!p.pending;
          input.addEventListener('focus', function () {
            paramEditing.set(p.id, input.value);
          });
          input.addEventListener('input', function () {
            paramEditing.set(p.id, input.value);
          });
          function commit() {
            if (!p.writable || p.pending) {
              paramEditing.delete(p.id);
              return;
            }
            var raw = input.value;
            var v = localValidate(p, raw);
            if (!v.ok) {
              input.value = fmtParam(p.confirmedValue, p.type);
              paramEditing.delete(p.id);
              return;
            }
            var cur = p.confirmedValue;
            if (cur === v.value || (typeof cur === 'number' && typeof v.value === 'number' && cur === v.value)) {
              paramEditing.delete(p.id);
              return;
            }
            paramEditing.delete(p.id);
            vscode.postMessage({ type: 'parameter.set', parameterId: p.id, value: v.value });
          }
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              input.value = fmtParam(p.confirmedValue, p.type);
              paramEditing.delete(p.id);
              input.blur();
            }
          });
          input.addEventListener('blur', commit);
          row.appendChild(input);
          var ref = document.createElement('button');
          ref.type = 'button';
          ref.className = 'prefresh';
          ref.title = 'Refresh from device';
          ref.textContent = '↻';
          ref.disabled = !!p.pending;
          ref.addEventListener('click', function () {
            vscode.postMessage({ type: 'parameter.refresh', parameterId: p.id });
          });
          row.appendChild(ref);
        }

        var unit = document.createElement('span');
        unit.className = 'punit';
        unit.textContent = p.unit || '';
        row.appendChild(unit);

        if (p.pending) {
          var pend = document.createElement('div');
          pend.className = 'perr';
          pend.style.color = 'var(--vscode-focusBorder, #007acc)';
          pend.textContent =
            'pending → ' + fmtParam(p.pending.requestedValue, p.type);
          row.appendChild(pend);
        }
        if (p.lastError) {
          var err = document.createElement('div');
          err.className = 'perr';
          err.textContent = p.lastError.detail || 'error';
          row.appendChild(err);
        }
        listEl.appendChild(row);
        return;
      }
      if (!node.children.length) return;
      var det = document.createElement('details');
      det.className = 'param-group';
      det.open = depth < 2 || !!q;
      var sum = document.createElement('summary');
      sum.textContent = node.name;
      det.appendChild(sum);
      for (var i = 0; i < node.children.length; i++) {
        renderNode(node.children[i], depth + 1);
      }
      listEl.appendChild(det);
    }
    for (var i = 0; i < tree.length; i++) renderNode(tree[i], 0);
  }

  function applyParametersSnapshot(msg) {
    paramSessionState = msg.sessionState || 'disconnected';
    paramDeviceName = msg.deviceName || '';
    paramFw = msg.firmwareVersion || '';
    paramById.clear();
    var list = msg.parameters || [];
    for (var i = 0; i < list.length; i++) paramById.set(list[i].id, list[i]);
    paramEditing.clear();
    renderParams();
  }

  /** Update a single visible row in place (no full list rebuild). */
  function updateParamRow(p) {
    var row = document.querySelector('.param-row[data-id="' + p.id + '"]');
    if (!row) return false;
    // Keep focus/edit buffer if user is typing this field
    if (paramEditing.has(p.id)) return true;
    var input = row.querySelector('input[type="text"], input[type="number"]');
    if (input && document.activeElement === input) return true;
    if (p.type === 'bool') {
      var cb = row.querySelector('input[type="checkbox"]');
      if (cb) {
        cb.checked = !!p.confirmedValue;
        cb.disabled = !p.writable || !!p.pending;
      }
    } else if (input) {
      input.value = fmtParam(p.confirmedValue, p.type);
      input.disabled = !p.writable || !!p.pending;
    }
    row.classList.toggle('pending', !!p.pending);
    row.classList.toggle('err', !!p.lastError);
    row.classList.toggle('ok', !p.pending && !p.lastError && p.confirmedValue !== undefined);
    var old = row.querySelector('.perr');
    if (old) old.remove();
    if (p.pending) {
      var pend = document.createElement('div');
      pend.className = 'perr';
      pend.style.color = 'var(--vscode-focusBorder, #007acc)';
      pend.textContent = 'pending → ' + fmtParam(p.pending.requestedValue, p.type);
      row.appendChild(pend);
    }
    if (p.lastError) {
      var err = document.createElement('div');
      err.className = 'perr';
      err.textContent = p.lastError.detail || 'error';
      row.appendChild(err);
    }
    return true;
  }

  function applyParametersUpdate(msg) {
    var p = msg.parameter;
    if (!p || typeof p.id !== 'number') return;
    paramById.set(p.id, p);
    if (!paramQuery && updateParamRow(p)) return;
    renderParams();
  }

  document.getElementById('params-search').addEventListener('input', function (e) {
    paramQuery = e.target.value || '';
    renderParams();
  });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'plot.snapshot') applySnapshot(msg);
    else if (msg.type === 'plot.delta') applyDelta(msg);
    else if (msg.type === 'plot.reset') applyReset(msg);
    else if (msg.type === 'raw') appendTerm(msg.entries);
    else if (msg.type === 'parameters.snapshot') applyParametersSnapshot(msg);
    else if (msg.type === 'parameters.update') applyParametersUpdate(msg);
    else if (msg.type === 'status') {
      var drop = msg.droppedUiEntries ? ' · dropUI ' + msg.droppedUiEntries : '';
      document.getElementById('status').textContent =
        msg.state + ' · ' + msg.path + ' · ' + msg.protocol +
        ' · RX ' + msg.rxBytes + ' · TX ' + msg.txBytes + ' · err ' + msg.errors +
        (msg.tMs != null ? ' · t ' + Math.round(msg.tMs) + 'ms' : '') + drop;
      if (followLive && !paused) applyFollow();
    } else if (msg.type === 'cleared') {
      document.getElementById('term').innerHTML = '';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
