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

  var DISPLAY_CAP = 4096;
  var plotGeneration = -1;
  var expectedSeq = -1;
  var channels = new Map();

  function ensureChannel(meta) {
    var ch = channels.get(meta.id);
    if (!ch) {
      ch = {
        id: meta.id,
        name: meta.name || meta.id,
        color: meta.color || '#3b82f6',
        visible: meta.visible !== false,
        ring: new DisplayRing(DISPLAY_CAP),
      };
      channels.set(meta.id, ch);
    } else {
      if (meta.name) ch.name = meta.name;
      if (meta.color) ch.color = meta.color;
      if (meta.visible !== undefined) ch.visible = meta.visible;
    }
    return ch;
  }

  function orderedChannels() {
    return Array.from(channels.values());
  }

  /** Y auto-fit: only points inside current X window; always include 0; zero mid-plot. */
  function yRangeInXWindow(u, dataMin, dataMax) {
    if (userYZoom && u.scales.y.min != null && u.scales.y.max != null) {
      return [u.scales.y.min, u.scales.y.max];
    }
    var min = Infinity;
    var max = -Infinity;
    var xmin = u.scales.x.min;
    var xmax = u.scales.x.max;
    var xs = u.data[0] || [];
    for (var si = 1; si < u.data.length; si++) {
      var ys = u.data[si];
      if (!ys) continue;
      var show = u.series[si] && u.series[si].show !== false;
      if (!show) continue;
      for (var i = 0; i < xs.length; i++) {
        var x = xs[i];
        if (x == null) continue;
        if (xmin != null && x < xmin) continue;
        if (xmax != null && x > xmax) continue;
        var y = ys[i];
        if (y == null) continue;
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
    if (min === Infinity) {
      min = dataMin != null ? dataMin : 0;
      max = dataMax != null ? dataMax : 0;
    }
    min = Math.min(min, 0);
    max = Math.max(max, 0);
    if (!(max > min)) {
      min = -1;
      max = 1;
    }
    var m = Math.max(Math.abs(min), Math.abs(max)) * 1.1;
    return [-m, m];
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
      userXZoom = false;
      userYZoom = false;
      uplot = new uPlot(opts, data, el);
      uplot.__key = key;
      applyFollow();
    } else {
      uplot.setData(data, false);
      syncSeriesVisibility(list);
      // setData() can drop a same-tick setScale; re-apply on next frame.
      applyFollow();
      scheduleFollow();
    }
    renderLegend(list);
  }

  var followRaf = 0;
  function scheduleFollow() {
    if (followRaf) return;
    followRaf = requestAnimationFrame(function () {
      followRaf = 0;
      applyFollow();
    });
  }

  function forceXRange(min, max) {
    if (!uplot) return;
    applyingFollow = true;
    try {
      uplot.setScale('x', { min: min, max: max });
      if (uplot.redraw) uplot.redraw();
    } finally {
      applyingFollow = false;
    }
    updateSpanReadout(min, max);
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
    if (!userYZoom) {
      applyingFollow = true;
      try {
        uplot.setScale('y', { min: null, max: null });
        if (uplot.redraw) uplot.redraw();
      } finally {
        applyingFollow = false;
      }
    }
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
    applyingFollow = true;
    try {
      uplot.setScale('y', { min: null, max: null });
      if (uplot.redraw) uplot.redraw();
    } finally {
      applyingFollow = false;
    }
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
      uplot.setScale('y', {
        min: yv + (y0 - yv) * factor,
        max: yv + (y1 - yv) * factor,
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
        uplot.setScale('x', { min: nmin, max: nmax });
        if (!userYZoom) uplot.setScale('y', { min: null, max: null });
      } finally {
        applyingFollow = false;
      }
      updateSpanReadout(nmin, nmax);
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

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'plot.snapshot') applySnapshot(msg);
    else if (msg.type === 'plot.delta') applyDelta(msg);
    else if (msg.type === 'plot.reset') applyReset(msg);
    else if (msg.type === 'raw') appendTerm(msg.entries);
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
