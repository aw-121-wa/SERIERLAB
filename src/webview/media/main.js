/* global uPlot */
(function () {
  const vscode = acquireVsCodeApi();
  let paused = false;
  let uplot = null;

  function rebuildSeries(series) {
    if (!series || series.length === 0) return;
    const el = document.getElementById('plot');
    const names = series.map(function (s) { return s.name; });
    const visKey = series.map(function (s) { return s.visible ? '1' : '0'; }).join('');
    const key = names.join('|') + '::' + visKey;
    const data = [series[0].xs];
    for (const s of series) data.push(s.ys);

    if (!uplot || uplot.__key !== key) {
      const opts = {
        width: el.clientWidth || 600,
        height: 280,
        series: [{}].concat(series.map(function (s) {
          return { label: s.name, stroke: s.color, show: s.visible };
        })),
        axes: [{}, {}],
        cursor: { show: true },
      };
      if (uplot) uplot.destroy();
      uplot = new uPlot(opts, data, el);
      uplot.__key = key;
    } else {
      uplot.setData(data);
    }
    renderLegend(series);
  }

  function renderLegend(series) {
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    for (const s of series) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.visible;
      cb.addEventListener('change', function () {
        vscode.postMessage({ type: 'toggleChannel', id: s.id, visible: cb.checked });
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + s.name));
      label.style.color = s.color;
      legend.appendChild(label);
    }
  }

  function appendTerm(entries) {
    const term = document.getElementById('term');
    const rxEnc = document.getElementById('rx-enc').value;
    for (const e of entries) {
      const line = document.createElement('div');
      const show = rxEnc === 'hex' ? e.hex : e.text;
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
  document.getElementById('rx-enc').addEventListener('change', function (e) {
    vscode.postMessage({ type: 'setRxEncoding', encoding: e.target.value });
  });
  document.getElementById('tx-send').addEventListener('click', function () {
    const payload = document.getElementById('tx-input').value;
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
    const msg = event.data;
    if (msg.type === 'samples') rebuildSeries(msg.series);
    if (msg.type === 'raw') appendTerm(msg.entries);
    if (msg.type === 'status') {
      document.getElementById('status').textContent =
        msg.state + ' · ' + msg.path + ' · ' + msg.protocol +
        ' · RX ' + msg.rxBytes + ' · TX ' + msg.txBytes + ' · err ' + msg.errors;
    }
    if (msg.type === 'cleared') document.getElementById('term').innerHTML = '';
  });

  vscode.postMessage({ type: 'ready' });
})();
