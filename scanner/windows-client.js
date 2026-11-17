'use strict';

const WindowsScanner = (() => {
  const extensionId = 'mdojliahacnjhobkccddigaglkmccidj';
  const installerVersion = '1.0.3';
  const supported = /^Win/i.test(navigator.userAgentData?.platform || navigator.platform) &&
    /(?:Chrome|Edg)\//.test(navigator.userAgent);
  const maxImageBytes = 16 * 1024 * 1024;
  const messages = {
    extension_missing: 'أضف «ماسح منظومة الصادر والوارد» إلى متصفحك، ثم حدّث الصفحة.',
    host_missing: 'ثبّت أداة الماسح على ويندوز، ثم أعد البحث.',
    wia_unavailable: 'تعذّر تشغيل خدمة المسح في ويندوز. تحقق من تعريف الماسح.',
    device_missing: 'الماسح غير متاح. تأكد من تشغيله واتصاله بالجهاز.',
    device_busy: 'الماسح مشغول أو قيد التجهيز. انتظر قليلًا ثم أعد المسح.',
    no_source: 'تعذّر الوصول إلى سطح المسح. تحقق من تعريف الجهاز.',
    no_paper: 'ضع الورقة في الماسح ثم أعد المسح.',
    paper_jam: 'تحقق من وجود ورق عالق في الماسح ثم أعد المسح.',
    cover_open: 'أغلق غطاء الماسح ثم أعد المسح.',
    image_too_large: 'الصورة كبيرة جدًا. خفّض دقة المسح في إعدادات الجهاز.',
    timeout: 'انتهت مهلة انتظار الماسح. تحقق من اتصاله ثم أعد المحاولة.',
    interrupted: 'انقطع الاتصال بأداة الماسح. أعد المحاولة.'
  };
  let devices = [];
  let deviceRequest;
  let pollTimer;
  let hostVersion;
  let extensionReady = false;
  let discoveryError;
  let scanning = false;

  function connectLegacy(command, receive, fail) {
    const runtime = window.chrome?.runtime;
    const port = runtime.connect(extensionId, {name: 'suluq-mail-scanner'});
    port.onDisconnect.addListener(() => {
      const code = runtime.lastError ? 'extension_missing' : 'interrupted';
      fail(code);
    });
    port.onMessage.addListener(message => receive(message, false));
    try {
      port.postMessage(command);
    } catch (error) {
      port.disconnect();
      throw error;
    }
    return () => port.disconnect();
  }

  function connect(command, receive, fail) {
    if (typeof MessageChannel !== 'function') return connectLegacy(command, receive, fail);
    const {port1, port2} = new MessageChannel();
    let ready = false;
    let close = () => {
      port1.postMessage({type: 'close'});
      port1.close();
    };
    const probeTimer = setTimeout(() => {
      close();
      close = () => {};
      try { close = connectLegacy(command, receive, fail); }
      catch { fail('extension_missing'); }
    }, 800);
    port1.onmessage = ({data}) => {
      if (ready) {
        receive(data, true);
      } else if (data?.type === 'bridge_ready') {
        ready = true;
        clearTimeout(probeTimer);
        port1.postMessage(command);
      }
    };
    window.postMessage({type: 'suluq-mail-scanner-connect'}, location.origin, [port2]);
    return () => {
      clearTimeout(probeTimer);
      close();
    };
  }

  function request(action, id, signal) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      let close = () => {};
      const abort = () => finish('cancelled');
      const timeout = setTimeout(() => finish('timeout'), action === 'list' ? 25000 : 120000);
      function finish(code, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        try { close(); } catch { /* The port may already be closed. */ }
        if (code) reject(new Error(code));
        else resolve(value);
      }

      function onMessage(message, relayed) {
        if (message?.type === 'error') {
          finish(message.code || 'scanner_error');
        } else if (action === 'list' && message?.type === 'devices' && Array.isArray(message.devices)) {
          finish(null, {devices: message.devices, version: message.version, relayed});
        } else if (action === 'scan' && message?.type === 'image') {
          try {
            if (typeof message.data !== 'string' || message.data.length > 330000) throw new Error();
            const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0));
            size += bytes.length;
            if (size > maxImageBytes) finish('image_too_large');
            else chunks.push(bytes);
          } catch {
            finish('scanner_error');
          }
        } else if (action === 'scan' && message?.type === 'done' && size) {
          finish(null, {image: new Blob(chunks, {type: 'image/jpeg'}), paper: message.paper || {}});
        } else {
          finish('scanner_error');
        }
      }
      signal?.addEventListener('abort', abort, {once: true});
      try {
        close = connect(action === 'list' ? {action} : {action, id}, onMessage, finish);
      } catch {
        finish('extension_missing');
      }
    });
  }

  function status(message, connected = false) {
    const chip = $('#winStatus');
    if (chip.textContent !== message) chip.textContent = message;
    chip.classList.toggle('ok', connected);
  }

  function updateDevices(next) {
    const select = $('#winDevice');
    if (next.length !== devices.length ||
        next.some((device, i) => device.id !== devices[i].id || device.name !== devices[i].name)) {
      const previous = select.value;
      select.replaceChildren(...next.map(device => new Option(device.name || 'ماسح ضوئي', device.id)));
      if (next.some(device => device.id === previous)) select.value = previous;
    }
    devices = next;
    $('#winSelection').hidden = !devices.length;
    select.disabled = scanning || !devices.length;
    $('#winScanPage').disabled = scanning || !devices.length;
    $('#winRefresh').disabled = !!deviceRequest || scanning;
  }

  function visible() {
    return !document.hidden && !$('#p-scan').hidden;
  }

  function scheduleRefresh() {
    clearTimeout(pollTimer);
    if (visible() && !scanning) pollTimer = setTimeout(refresh, devices.length && !discoveryError ? 8000 : 3500);
  }

  function discoveryStatus() {
    const setup = $('#winSetup');
    const needsSetup = ['extension_missing', 'host_missing'].includes(discoveryError);
    const needsUpdate = !discoveryError && (hostVersion !== installerVersion || !extensionReady);
    const version = hostVersion ? ` · أداة الماسح ${hostVersion}` : '';
    if (discoveryError) {
      const detail = messages[discoveryError] || 'تعذّر البحث عن الماسحات.';
      status(needsSetup && !hostVersion ? detail : `${detail} جارٍ إعادة البحث تلقائيًا…`);
    } else {
      status(devices.length ? `الماسحات المتاحة (${devices.length})${version}` :
        `لم يجد ويندوز ماسحًا. سيستمر البحث تلقائيًا.${version}`, !!devices.length);
    }
    $('#winUpdate').hidden = !needsUpdate;
    if (setup.hidden && (needsSetup || needsUpdate)) setup.open = true;
    setup.hidden = !(needsSetup || needsUpdate);
  }

  async function refresh() {
    if (!supported || !visible() || deviceRequest || scanning) return;
    clearTimeout(pollTimer);
    const check = new AbortController();
    deviceRequest = check;
    updateDevices(devices);
    try {
      const result = await request('list', null, check.signal);
      const next = result.devices.filter(device => device && typeof device.id === 'string' && device.id);
      hostVersion = typeof result.version === 'string' ? result.version : '';
      extensionReady = result.relayed;
      discoveryError = null;
      updateDevices(next);
    } catch (error) {
      if (error.message !== 'cancelled') {
        discoveryError = error.message;
        if (error.message === 'device_missing' || !hostVersion) updateDevices([]);
      }
    } finally {
      deviceRequest = null;
      updateDevices(devices);
      if (!scanning) discoveryStatus();
      scheduleRefresh();
    }
  }

  async function scan() {
    if (scanning) return;
    const id = $('#winDevice').value;
    if (!id) return;
    const batch = S.pages;
    const label = $('#winDevice').selectedOptions[0].textContent;
    scanning = true;
    clearTimeout(pollTimer);
    deviceRequest?.abort();
    updateDevices(devices);
    status(`جارٍ المسح من ${label}…`, true);
    try {
      const {image, paper} = await request('scan', id);
      if (batch === S.pages) {
        S.reviewScan = true;
        await ingest([image], batch, paper);
      }
    } catch (error) {
      toast('⚠️ ' + (messages[error.message] || 'تعذّر المسح. تحقق من الماسح وأعد المحاولة.'));
    } finally {
      scanning = false;
      updateDevices(devices);
      if (hostVersion !== undefined || discoveryError) discoveryStatus();
      scheduleRefresh();
    }
  }

  async function downloadSetup() {
    const button = $('#winDownloadSetup');
    button.disabled = true;
    try {
      const response = await fetch('scanner/installer.txt');
      if (!response.ok) throw new Error();
      const bytes = Uint8Array.from(atob(await response.text()), char => char.charCodeAt(0));
      if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error();
      dl(new Blob([bytes], {type: 'application/octet-stream'}), `Mail-Scanner-Setup-${installerVersion}.exe`);
    } catch {
      toast('⚠️ تعذّر تنزيل أداة الماسح. حدّث الصفحة ثم أعد المحاولة.');
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    if (!supported) {
      status('المسح المباشر متاح في كروم وإيدج على ويندوز.');
      $('#winActions').hidden = true;
      return;
    }
    $('#winRefresh').onclick = refresh;
    $('#winScanPage').onclick = scan;
    $('#winDownloadSetup').onclick = downloadSetup;
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
  }

  return {init, refresh};
})();
