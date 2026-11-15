'use strict';

const WindowsScanner = (() => {
  const extensionId = 'mdojliahacnjhobkccddigaglkmccidj';
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
  let checking = false;
  let scanning = false;

  function request(action, id) {
    return new Promise((resolve, reject) => {
      const runtime = window.chrome?.runtime;
      let port;
      try {
        port = runtime?.connect(extensionId, {name: 'suluq-mail-scanner'});
      } catch {
        reject(new Error('extension_missing'));
        return;
      }
      if (typeof port?.onDisconnect?.addListener !== 'function' ||
          typeof port?.onMessage?.addListener !== 'function' || typeof port?.postMessage !== 'function') {
        reject(new Error('extension_missing'));
        return;
      }

      const chunks = [];
      let size = 0;
      let settled = false;
      const timeout = setTimeout(() => finish('timeout'), action === 'list' ? 8000 : 120000);
      function finish(code, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { port.disconnect?.(); } catch { /* The port may already be closed. */ }
        if (code) reject(new Error(code));
        else resolve(value);
      }

      function onMessage(message) {
        if (message.type === 'error') {
          finish(message.code || 'scanner_error');
        } else if (action === 'list' && message.type === 'devices' && Array.isArray(message.devices)) {
          finish(null, message.devices);
        } else if (action === 'scan' && message.type === 'image') {
          try {
            if (typeof message.data !== 'string' || message.data.length > 330000) throw new Error();
            const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0));
            size += bytes.length;
            if (size > maxImageBytes) finish('image_too_large');
            else chunks.push(bytes);
          } catch {
            finish('scanner_error');
          }
        } else if (action === 'scan' && message.type === 'done' && size) {
          finish(null, new Blob(chunks, {type: 'image/jpeg'}));
        } else {
          finish('scanner_error');
        }
      }
      try {
        port.onDisconnect.addListener(() => {
          void runtime.lastError;
          finish('extension_missing');
        });
        port.onMessage.addListener(onMessage);
        port.postMessage(action === 'list' ? {action} : {action, id});
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
    $('#winScanPage').disabled = checking || scanning || !devices.length;
    $('#winRefresh').disabled = checking || scanning;
  }

  async function refresh() {
    if (!supported || checking || scanning) return;
    checking = true;
    updateDevices(devices);
    const setup = $('#winSetup');
    let next = devices;
    try {
      next = (await request('list')).filter(device => device && typeof device.id === 'string' && device.id);
      status(next.length ? `الماسحات المتاحة (${next.length})` :
        'لم يجد ويندوز ماسحًا. تحقق من تشغيل الجهاز وتثبيت تعريف المسح.', !!next.length);
      setup.hidden = true;
    } catch (error) {
      next = [];
      status(messages[error.message] || 'تعذّر البحث عن الماسحات. أعد المحاولة.');
      if (setup.hidden) setup.open = true;
      setup.hidden = false;
    } finally {
      checking = false;
      updateDevices(next);
    }
  }

  async function scan() {
    if (checking || scanning) return;
    const id = $('#winDevice').value;
    if (!id) return;
    const batch = S.pages;
    const label = $('#winDevice').selectedOptions[0].textContent;
    scanning = true;
    updateDevices(devices);
    status(`جارٍ المسح من ${label}…`, true);
    try {
      const image = await request('scan', id);
      if (batch === S.pages) {
        S.reviewScan = true;
        await ingest([image], batch);
      }
    } catch (error) {
      toast('⚠️ ' + (messages[error.message] || 'تعذّر المسح. تحقق من الماسح وأعد المحاولة.'));
    } finally {
      scanning = false;
      updateDevices(devices);
      status(`الماسحات المتاحة (${devices.length})`, !!devices.length);
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
      dl(new Blob([bytes], {type: 'application/octet-stream'}), 'Mail-Scanner-Setup.exe');
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
    const refreshWhileVisible = () => {
      if (!document.hidden && !$('#p-scan').hidden) refresh();
    };
    document.addEventListener('visibilitychange', refreshWhileVisible);
    setInterval(refreshWhileVisible, 5000);
  }

  return {init, refresh};
})();
