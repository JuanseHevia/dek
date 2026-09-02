// Bridge to the Swift shell. In a plain browser (dev), a small harness stands
// in for the app so the whole surface can be exercised at http://localhost.

const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dek;

export const isNative = !!native;

export function send(msg) {
  if (native) {
    native.postMessage(msg);
  } else {
    devHandle(msg);
  }
}

// ---- dev harness ----

const DEV_DECKS = {
  '/dev/welcome.html': 'dev/welcome.html',
  '/dev/blank.html': 'dev/blank.html',
};
const devFiles = new Map(); // path -> content (in-memory "disk")

async function devLoad(path) {
  let content = devFiles.get(path);
  if (content === undefined) {
    const res = await fetch(DEV_DECKS[path] || path.replace(/^\//, ''));
    if (!res.ok) { console.warn('[bridge] cannot load', path); return; }
    content = await res.text();
    devFiles.set(path, content);
  }
  const base = new URL(DEV_DECKS[path] || 'dev/', location.href);
  window.dekShell.load({
    name: path.split('/').pop(),
    path,
    content,
    baseHref: base.href.replace(/[^/]*$/, ''),
  });
}

function devHandle(msg) {
  if (window.__dekQuiet !== true) console.log('[bridge]', msg.type, msg);
  switch (msg.type) {
    case 'ready':
      setTimeout(() => {
        window.dekShell.setRecents([
          { name: 'welcome.html', dir: 'dev', path: '/dev/welcome.html' },
          { name: 'blank.html', dir: 'dev', path: '/dev/blank.html' },
        ]);
        window.dekShell.agentInfo({ port: 43217, bridge: '/Applications/Dek.app/Contents/Resources/mcp/dek-mcp.js', version: '0.1.0-dev' });
        if (!/presenter/.test(location.search)) devLoad('/dev/welcome.html');
      }, 30);
      break;
    case 'save':
      devFiles.set(msg.path, msg.content);
      setTimeout(() => window.dekShell.saved({ path: msg.path, ok: true }), 60);
      break;
    case 'openPath':
      devLoad(msg.path);
      break;
    case 'saveAndOpen':
      devFiles.set(msg.path, msg.content);
      setTimeout(() => { window.dekShell.load({ name: msg.path.split('/').pop(), path: msg.path, content: msg.content, baseHref: '', imported: true }); window.dekShell.imported({ reused: false }); }, 40);
      break;
    case 'openDialog':
    case 'openSample':
      devLoad('/dev/welcome.html');
      break;
    case 'newDeck':
      devLoad('/dev/blank.html');
      break;
    case 'desktopStatus':
      setTimeout(() => window.dekShell.desktopStatus({ found: true, installed: false }), 80);
      break;
    case 'desktopInstall':
      setTimeout(() => window.dekShell.desktopStatus({ found: true, installed: true }), 120);
      break;
    case 'desktopRemove':
      setTimeout(() => window.dekShell.desktopStatus({ found: true, installed: false }), 120);
      break;
    case 'fullscreen':
      document.documentElement.classList.toggle('dev-fullscreen', !!msg.on);
      setTimeout(() => window.dekShell.fullscreenChanged(!!msg.on), 50);
      break;
    case 'presenter':
      if (msg.open) window.open(location.pathname + '?presenter=1', 'dek-presenter', 'width=1100,height=700');
      break;
    case 'openExternal':
      window.open(msg.url, '_blank');
      break;
    default:
      break;
  }
}
