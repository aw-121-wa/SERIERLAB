(function () {
  const vscode = acquireVsCodeApi();

  const portEl = document.getElementById('port');
  const baudEl = document.getElementById('baud');
  const protocolEl = document.getElementById('protocol');
  const channelsEl = document.getElementById('channels');
  const connStateEl = document.getElementById('conn-state');

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

  function fillChannels(channels) {
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
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = c.color || '#888';
      const name = document.createElement('span');
      name.className = 'ch-name';
      name.textContent = c.name || c.id;
      const vis = document.createElement('span');
      vis.className = 'ch-vis';
      vis.textContent = c.visible ? '显示' : '隐藏';
      if (!c.visible) li.classList.add('hidden-ch');
      li.appendChild(swatch);
      li.appendChild(name);
      li.appendChild(vis);
      channelsEl.appendChild(li);
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
    saveConn();
    vscode.postMessage({
      type: 'connect',
      path: selectedPath(),
      baudRate: currentBaud(),
    });
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
    if (msg.type === 'connState') setConnState(msg.state);
  });

  vscode.postMessage({ type: 'ready' });
})();
