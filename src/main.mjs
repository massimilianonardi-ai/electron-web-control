import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { app, BrowserWindow } from 'electron';
import { webControlHome, webControlSocketPath } from './runtime.mjs';

process.umask(0o077);
const HOME = webControlHome();
const PROFILE = process.env.WEB_CONTROL_PROFILE || 'default';
const SOCKET = webControlSocketPath();
const HIDDEN = process.env.WEB_CONTROL_HEADLESS === '1';
if (!/^(?:[a-z0-9]|[a-z0-9][a-z0-9._-]*[a-z0-9])$/.test(PROFILE)) {
  throw new Error('invalid profile identity');
}
const USER_DATA = path.join(HOME, 'electron-data');
fs.mkdirSync(USER_DATA, { recursive: true, mode: 0o700 });
app.setPath('userData', USER_DATA);

const pages = new Map();
let nextPageId = 1;
let server = null;
let stopping = false;
const connections = new Set();

function secureWebPreferences() {
  return {
    partition: 'persist:web-control-' + PROFILE,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    backgroundThrottling: false
  };
}

function registerWindow(window) {
  const id = 'page-' + nextPageId++;
  pages.set(id, window);
  window.once('closed', () => pages.delete(id));
  window.webContents.once('render-process-gone', () => {
    if (!window.isDestroyed()) window.destroy();
  });
  window.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1000,
      height: 800,
      show: !HIDDEN,
      webPreferences: secureWebPreferences()
    }
  }));
  window.webContents.on('did-create-window', (child) => registerWindow(child));
  return id;
}

function newWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: !HIDDEN,
    paintWhenInitiallyHidden: true,
    webPreferences: secureWebPreferences()
  });
  return { id: registerWindow(window), window };
}

function requirePage(id) {
  const window = pages.get(id);
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    throw new Error('unknown page: ' + id);
  }
  return window;
}

function describe(id, window) {
  return { id, url: window.webContents.getURL(), title: window.webContents.getTitle() };
}

function evaluate(window, fn, ...args) {
  const source = '(' + fn.toString() + ')(' + args.map((arg) => JSON.stringify(arg)).join(',') + ')';
  return window.webContents.executeJavaScript(source, true);
}

async function inspect(window, kind) {
  if (kind === 'html') {
    return { html: await evaluate(window, () => document.documentElement?.outerHTML ?? '') };
  }
  if (kind === 'text') {
    return { text: await evaluate(window, () => document.body?.innerText ?? '') };
  }
  if (kind === 'storage') {
    const storage = await evaluate(window, () => {
      const collect = (item) => {
        const result = {};
        try {
          for (let index = 0; index < item.length; index++) {
            const key = item.key(index);
            result[key] = item.getItem(key);
          }
        } catch {}
        return result;
      };
      return { local: collect(localStorage), session: collect(sessionStorage) };
    });
    const url = window.webContents.getURL();
    const cookies = /^https?:\/\//.test(url) ?
      await window.webContents.session.cookies.get({ url }) : [];
    return { cookies, ...storage };
  }
  throw new Error('unsupported inspect kind: ' + kind);
}

async function capture(id, window, params) {
  if (typeof params.outputDir !== 'string' || !params.outputDir) {
    throw new Error('page.capture requires outputDir');
  }
  const formats = Array.isArray(params.formats) && params.formats.length ?
    params.formats : ['html', 'text', 'screenshot'];
  if (formats.some((format) => !['html', 'text', 'screenshot'].includes(format))) {
    throw new Error('unsupported capture format');
  }
  const dir = path.resolve(params.outputDir);
  await fsp.mkdir(dir, { recursive: true });
  const files = {};
  if (formats.includes('html')) {
    files.html = path.join(dir, 'page.html');
    await fsp.writeFile(files.html, (await inspect(window, 'html')).html, 'utf8');
  }
  if (formats.includes('text')) {
    files.text = path.join(dir, 'page.txt');
    await fsp.writeFile(files.text, (await inspect(window, 'text')).text + '\n', 'utf8');
  }
  if (formats.includes('screenshot')) {
    files.screenshot = path.join(dir, 'page.png');
    const image = await window.webContents.capturePage();
    await fsp.writeFile(files.screenshot, image.toPNG());
  }
  const result = {
    page: id,
    url: window.webContents.getURL(),
    title: window.webContents.getTitle(),
    capturedAt: new Date().toISOString(),
    files
  };
  files.metadata = path.join(dir, 'metadata.json');
  await fsp.writeFile(files.metadata, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return result;
}

async function click(window, target) {
  const point = await evaluate(window, (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('target not found: ' + selector);
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error('target is not visible: ' + selector);
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  }, target);
  if (!HIDDEN) window.focus();
  window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function fill(window, target, value) {
  await evaluate(window, (selector, text) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('target not found: ' + selector);
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(text));
    } else if (element.isContentEditable) {
      element.textContent = String(text);
    } else {
      throw new Error('target cannot be filled: ' + selector);
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(text) }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, target, value);
}

async function press(window, target, key) {
  await evaluate(window, (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('target not found: ' + selector);
    element.focus();
  }, target);
  if (!HIDDEN) window.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', key });
  if (key.length === 1) window.webContents.sendInputEvent({ type: 'char', key });
  window.webContents.sendInputEvent({ type: 'keyUp', key });
}

async function dispatch(method, params = {}) {
  if (method === 'status') {
    return {
      profile: PROFILE,
      headless: HIDDEN,
      browserRunning: pages.size > 0,
      pages: [...pages].map(([id, window]) => describe(id, window))
    };
  }
  if (method === 'page.list') return [...pages].map(([id, window]) => describe(id, window));
  if (method === 'page.new') {
    const { id, window } = newWindow();
    return describe(id, window);
  }
  if (method === 'page.close') {
    const window = requirePage(params.page);
    window.close();
    return { page: params.page, closed: true };
  }
  const id = params.page;
  const window = requirePage(id);
  if (method === 'page.navigate') {
    if (typeof params.url !== 'string' || !params.url) throw new Error('page.navigate requires url');
    await window.loadURL(params.url);
    return { ...describe(id, window), page: id, status: null, statusText: null };
  }
  if (method === 'page.inspect') {
    const kind = params.kind || 'summary';
    if (kind === 'summary') return describe(id, window);
    return { page: id, ...(await inspect(window, kind)) };
  }
  if (method === 'page.capture') return capture(id, window, params);
  if (method === 'page.click') {
    await click(window, params.target);
    return { page: id, target: params.target };
  }
  if (method === 'page.fill') {
    await fill(window, params.target, params.value ?? '');
    return { page: id, target: params.target };
  }
  if (method === 'page.press') {
    await press(window, params.target, params.key);
    return { page: id, target: params.target, key: params.key };
  }
  throw new Error('unknown method: ' + method);
}

async function checkStaleSocket() {
  let stat;
  try { stat = await fsp.lstat(SOCKET); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSocket()) throw new Error('refusing non-socket endpoint');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('refusing endpoint owned by another user');
  }
  const live = await new Promise((resolve) => {
    const probe = net.createConnection(SOCKET);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => { probe.destroy(); resolve(false); });
  });
  if (live) throw new Error('another controller is already listening');
  await fsp.unlink(SOCKET);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const socket of connections) socket.destroy();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  for (const window of pages.values()) if (!window.isDestroyed()) window.destroy();
  try { await fsp.unlink(SOCKET); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  app.exit(code);
}

app.on('window-all-closed', () => {});
process.on('SIGTERM', () => { shutdown().catch((error) => { console.error(error); app.exit(1); }); });
process.on('SIGINT', () => { shutdown().catch((error) => { console.error(error); app.exit(1); }); });

await app.whenReady();
newWindow();
await checkStaleSocket();
server = net.createServer((socket) => {
  connections.add(socket);
  socket.setEncoding('utf8');
  let buffer = '';
  socket.once('close', () => connections.delete(socket));
  socket.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024) { socket.destroy(); return; }
    const position = buffer.indexOf('\n');
    if (position < 0) return;
    const line = buffer.slice(0, position);
    buffer = '';
    let request;
    try {
      request = JSON.parse(line);
      const result = await dispatch(request.method, request.params || {});
      socket.end(JSON.stringify({ id: request.id ?? null, ok: true, result }) + '\n');
    } catch (error) {
      socket.end(JSON.stringify({
        id: request?.id ?? null,
        ok: false,
        error: { message: String(error?.message || error) }
      }) + '\n');
    }
  });
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(SOCKET, resolve);
});
await fsp.chmod(SOCKET, 0o600);
console.log(JSON.stringify({ event: 'ready', socket: SOCKET, profile: PROFILE }));
