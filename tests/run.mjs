import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFixtureServer } from './fixture-server.mjs';
import { webControlSocketPath } from '../src/runtime.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'electron-web-control-test-'));
const home = path.join(work, 'home');
const captureDir = path.join(work, 'capture');
const fixture = await createFixtureServer();
const env = {
  ...process.env,
  WEB_CONTROL_HOME: home,
  WEB_CONTROL_HEADLESS: '0',
  WEB_CONTROL_CONNECT_TIMEOUT_MS: '15000'
};
const socketPath = webControlSocketPath(env);
let service = null;
let stderr = '';
let stdout = '';

async function cli(...args) {
  const { stdout } = await execFileAsync(path.join(root, 'bin', 'web-control'), args, {
    env, cwd: root, timeout: 45000
  });
  return JSON.parse(stdout);
}

async function poll(fn, description) {
  let last;
  for (let i = 0; i < 100; i++) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) { last = String(error); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out: ' + description + ' (' + JSON.stringify(last) + ')');
}

async function start() {
  stderr = '';
  stdout = '';
  service = spawn(path.join(root, 'bin', 'web-control-service'), [], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  service.stdout.setEncoding('utf8');
  service.stdout.on('data', (chunk) => { stdout += chunk; });
  service.stderr.setEncoding('utf8');
  service.stderr.on('data', (chunk) => { stderr += chunk; });
  service.once('error', (error) => { stderr += String(error); });
  service.once('exit', (code, signal) => { stderr += '\nElectron process exit: ' + code + ' signal: ' + signal; });
  const status = await cli('status').catch(async (error) => {
    const processes = (await execFileAsync('ps', ['-eo', 'pid,ppid,stat,args'])).stdout
      .split('\n').filter((line) => /electron|web-control/.test(line)).slice(0, 22).join('\n');
    throw new Error('Electron failed to start: ' + error.message + '\nexitCode=' + service?.exitCode + ' signal=' + service?.signalCode + '\nstdout=' + stdout + '\nstderr=' + stderr + '\nprocesses=' + processes);
  });
  assert.equal(status.profile, 'default');
  assert.equal(status.headless, false);
  assert.equal(status.browserRunning, true);
  const sock = await fs.stat(socketPath);
  assert.equal(sock.mode & 0o777, 0o600, 'private controller socket mode');
}

async function stop() {
  if (!service) return;
  const child = service;
  service = null;
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  assert.equal(child.exitCode, 0, 'controller SIGTERM exit: ' + stderr);
}

async function text(page) {
  return (await cli('page', 'inspect', page, 'text')).text;
}

try {
  process.stderr.write('Electron test: launch controller\n');
  await start();
  const initial = await cli('page', 'list');
  assert.ok(initial.length > 0, 'visible initial Electron window');
  const entry = initial[0].id;
  const landing = await cli('page', 'inspect', entry, 'html');
  assert.match(landing.html, /id="web-control-address"/, 'visible windows have a navigation entry');
  const landingShot = await cli('page', 'capture', entry, path.join(work, 'start-page'), 'screenshot');
  const landingPNG = await fs.readFile(landingShot.files.screenshot);
  assert.ok(landingPNG.length > 1024, 'start page produces a nonempty rendered screenshot');
  assert.equal(landingPNG.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await cli('page', 'fill', entry, '#web-control-address', fixture.baseUrl);
  await cli('page', 'click', entry, '#web-control-open');
  await poll(async () => /dynamic-ready/.test(await text(entry)),
    'navigate to fixture from desktop address form without page.navigate');
  const page = (await cli('page', 'new')).id;
  await cli('page', 'navigate', page, fixture.baseUrl);
  await poll(async () => /dynamic-ready/.test(await text(page)), 'dynamic rendered content');
  const html = await cli('page', 'inspect', page, 'html');
  assert.match(html.html, /id="dynamic">dynamic-ready/);
  assert.match(await text(page), /node=undefined require=undefined/);
  assert.match(await text(page), /webdriver=false/, 'Electron webdriver fingerprint observation on this runner');

  await cli('page', 'fill', page, '#name', 'rumiai');
  await poll(async () => /rumiai/.test(await text(page)), 'input reflected into DOM');
  await cli('page', 'press', page, '#name', 'Enter');
  try {
    await poll(async () => /pressed-enter/.test(await text(page)), 'keyboard input');
  } catch (error) {
    throw new Error(error.message + '\nobserved text=' + await text(page) + '\ncontroller stderr=' + stderr);
  }

  const before = await cli('page', 'list');
  await cli('page', 'click', page, '#popup-button');
  await poll(async () => {
    const after = await cli('page', 'list');
    return after.length === before.length + 1 && after.some((entry) => entry.url.endsWith('/popup'));
  }, 'popup page registration');

  const captured = await cli('page', 'capture', page, captureDir, 'html', 'text', 'screenshot');
  for (const file of Object.values(captured.files)) {
    const stat = await fs.stat(file);
    assert.ok(stat.size > 0, 'non-empty capture ' + file);
  }
  assert.match(await fs.readFile(captured.files.html, 'utf8'), /dynamic-ready/);
  assert.equal((await fs.readFile(captured.files.screenshot)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  process.stderr.write('Electron test: login and persistence\n');
  await cli('page', 'navigate', page, fixture.baseUrl + '/login');
  await cli('page', 'click', page, '#login');
  await poll(async () => /cookie=active storage=active/.test(await text(page)), 'login fixture persistence');
  const storage = await cli('page', 'inspect', page, 'storage');
  assert.equal(storage.local.poc_session, 'active');
  assert.ok(storage.cookies.some((cookie) => cookie.name === 'poc_session' && cookie.value === 'active'));
  await stop();

  process.stderr.write('Electron test: restart and recover windows\n');
  await start();
  const next = (await cli('page', 'new')).id;
  await cli('page', 'navigate', next, fixture.baseUrl + '/account');
  await poll(async () => /cookie=active storage=active/.test(await text(next)), 'session persisted across process restart');
  const activePages = await cli('page', 'list');
  for (const entry of activePages) await cli('page', 'close', entry.id);
  await poll(async () => !(await cli('status')).browserRunning, 'all browser windows closed');
  assert.equal(service.exitCode, null, 'controller remains alive without windows');
  const renewed = (await cli('page', 'new')).id;
  assert.ok(renewed);
  assert.equal((await cli('status')).browserRunning, true);
  await cli('page', 'navigate', renewed, fixture.baseUrl + '/account');
  assert.match(await text(renewed), /cookie=active storage=active/);
  await stop();
  process.stdout.write(JSON.stringify({
    ok: true,
    checks: [
      'private Unix socket', 'secure renderer excludes Node APIs',
      'visible start page and in-window address navigation',
      'real Electron navigation and dynamic DOM',
      'fill/click/press', 'popup window tracking', 'HTML/text/PNG capture',
      'cookie/localStorage persistence across service restart',
      'controller survives closing all browser windows',
      'browser window recreated on demand'
    ]
  }, null, 2) + '\n');
} finally {
  if (service) {
    const child = service;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve();
        }, 5000))
      ]);
    }
  }
  await fixture.close();
  await fs.rm(work, { recursive: true, force: true });
}
