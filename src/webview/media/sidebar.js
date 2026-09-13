(function () {
  const vscode = acquireVsCodeApi();

  const portEl = document.getElementById('port');
  const baudEl = document.getElementById('baud');
  const protocolEl = document.getElementById('protocol');
  const channelsEl = document.getElementById('channels');
  const connStateEl = document.getElementById('conn-state');
  document.getElementById('wizard').addEventListener('click', () => vscode.postMessage({ type: 'wizard' }));
  document.getElementById('diagnostics').addEventListener('click', () => vscode.postMessage({ type: 'diagnostics' }));

  function selectedPath() {
    return portEl.value || '';
  }

  function currentBaud() {
    return Number(baudEl.value) || 115200;
  }

  function saveConn() {
    vscode.postMessage({
      type: 'saveConn',
      path: selectedPath(),
      baudRate: currentBaud(),
    });
  }

  function fillPorts(ports, selected) {
    const prev = selected || portEl.value || '';
    portEl.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = ports.length ? '选择串口' : '（无可用串口）';
    portEl.appendChild(empty);
    for (const p of ports) {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = p.friendly || p.path;
      portEl.appendChild(opt);
    }
    if (prev) portEl.value = prev;
    if (!portEl.value && ports.length === 1) portEl.value = ports[0].path;
  }

  function formatValue(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1000) return v.toFixed(1);
    if (a >= 10) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    if (a === 0) return '0';
    return v.toExponential(2);
  }

  /** Update live values in place; rebuild DOM only when the channel set changes. */
  var channelKey = '';
  function fillChannels(channels) {
    var key = (channels || []).map(function (c) { return c.id; }).join('|');
    if (key !== channelKey) {
      channelKey = key;
      channelsEl.innerHTML = '';
      if (!channels || channels.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '（暂无通道）';
        channelsEl.appendChild(li);
        return;
      }
      for (const c of channels) {
        const li = document.createElement('li');
        li.dataset.id = c.id;
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = c.color || '#888';
        const name = document.createElement('span');
        name.className = 'ch-name';
        name.textContent = (c.sourceKind === 'swd' ? 'SWD ' : c.sourceKind === 'native' ? 'NATIVE ' : 'UART ') + (c.displayName || c.name || c.id);
        const val = document.createElement('span');
        val.className = 'ch-value';
        val.textContent = '—';
        const vis = document.createElement('span');
        vis.className = 'ch-vis';
        vis.textContent = c.visible ? '显示' : '隐藏';
        if (!c.visible) li.classList.add('hidden-ch');
        li.appendChild(swatch);
        li.appendChild(name);
        li.appendChild(val);
        li.appendChild(vis);
        channelsEl.appendChild(li);
      }
    }
    // Refresh values / visibility without destroying nodes.
    var byId = {};
    for (var i = 0; i < (channels || []).length; i++) {
      byId[channels[i].id] = channels[i];
    }
    var items = channelsEl.querySelectorAll('li[data-id]');
    for (var j = 0; j < items.length; j++) {
      var li = items[j];
      var c = byId[li.dataset.id];
      if (!c) continue;
      var valEl = li.querySelector('.ch-value');
      if (valEl) valEl.textContent = formatValue(c.value);
      var visEl = li.querySelector('.ch-vis');
      if (visEl) visEl.textContent = c.visible ? '显示' : '隐藏';
      if (c.visible) li.classList.remove('hidden-ch');
      else li.classList.add('hidden-ch');
      var sw = li.querySelector('.swatch');
      if (sw && c.color) sw.style.background = c.color;
      var nm = li.querySelector('.ch-name');
      if (nm) nm.textContent = (c.sourceKind === 'swd' ? 'SWD ' : c.sourceKind === 'native' ? 'NATIVE ' : 'UART ') + (c.displayName || c.name || c.id);
    }
  }

  function setConnState(state) {
    connStateEl.textContent = state || 'disconnected';
    connStateEl.dataset.state = state || 'disconnected';
  }

  document.getElementById('refresh').addEventListener('click', function () {
    vscode.postMessage({ type: 'refreshPorts' });
  });

  portEl.addEventListener('change', saveConn);
  baudEl.addEventListener('change', saveConn);

  document.getElementById('connect').addEventListener('click', function () {
    vscode.postMessage({
      type: 'connect',
      path: selectedPath(),
      baudRate: currentBaud(),
    });
  });

  document.getElementById('open-workbench').addEventListener('click', function () {
    vscode.postMessage({ type: 'openWorkbench' });
  });

  document.getElementById('disconnect').addEventListener('click', function () {
    vscode.postMessage({ type: 'disconnect' });
  });

  protocolEl.addEventListener('change', function () {
    vscode.postMessage({ type: 'setProtocol', protocol: protocolEl.value });
  });

  document.getElementById('edit-custom').addEventListener('click', function () {
    vscode.postMessage({ type: 'editCustom' });
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg.type === 'init') {
      if (msg.connection) {
        baudEl.value = msg.connection.baudRate || 115200;
      }
      if (msg.protocol) protocolEl.value = msg.protocol;
    }
    if (msg.type === 'ports') fillPorts(msg.ports || [], msg.selected);
    if (msg.type === 'channels') fillChannels(msg.channels || []);
    if (msg.type === 'connState') {
      setConnState(msg.state);
      document.getElementById('effective-connection').textContent = msg.summary || '';
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
