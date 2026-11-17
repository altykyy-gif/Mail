'use strict';

const hostName = 'ly.suluq.mail_scanner';
const appOrigin = 'https://altykyy-gif.github.io';

function connectScanner(client) {
  const sender = client.sender;
  if (client.name !== 'suluq-mail-scanner' || sender?.frameId !== 0 ||
      sender.origin !== appOrigin || !sender.url?.startsWith(`${appOrigin}/Mail/`)) {
    client.disconnect();
    return;
  }

  let native;
  let started = false;
  let ready = false;
  let completed = false;
  let connected = true;

  client.onDisconnect.addListener(() => {
    connected = false;
    native?.disconnect();
  });
  client.onMessage.addListener(request => {
    if (started) return;
    started = true;
    const action = request?.action;
    if (action !== 'list' && (action !== 'scan' || typeof request.id !== 'string' ||
        !request.id || request.id.length > 2048)) {
      client.postMessage({type: 'error', code: 'invalid_request'});
      return;
    }

    try {
      native = chrome.runtime.connectNative(hostName);
      native.onMessage.addListener(message => {
        if (!connected || completed) return;
        if (message.type === 'ready') {
          ready = true;
          return;
        }
        completed = ['devices', 'done', 'error'].includes(message.type);
        client.postMessage(message);
      });
      native.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        native = null;
        if (connected && !completed) {
          client.postMessage({type: 'error', code: ready ? 'interrupted' : 'host_missing'});
        }
      });
      native.postMessage(action === 'list' ? {action} : {action, id: request.id});
    } catch {
      client.postMessage({type: 'error', code: 'host_missing'});
    }
  });
}

chrome.runtime.onConnect.addListener(connectScanner);
chrome.runtime.onConnectExternal.addListener(connectScanner);
