'use strict';

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.type !== 'suluq-mail-scanner-connect' || !event.ports[0] || !chrome.runtime?.id) return;

  const page = event.ports[0];
  let extension;
  let started = false;
  function close() {
    page.close();
    extension?.disconnect();
    extension = null;
  }

  page.onmessage = ({data}) => {
    if (data?.type === 'close') {
      close();
      return;
    }
    if (started) return;
    started = true;
    try {
      extension = chrome.runtime.connect({name: 'suluq-mail-scanner'});
      extension.onMessage.addListener(message => page.postMessage(message));
      extension.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        extension = null;
        page.postMessage({type: 'error', code: 'interrupted'});
        close();
      });
      extension.postMessage(data);
    } catch {
      page.postMessage({type: 'error', code: 'interrupted'});
      close();
    }
  };
  page.postMessage({type: 'bridge_ready'});
});
