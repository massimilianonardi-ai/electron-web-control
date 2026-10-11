import http from 'node:http';

const html = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>web-control fixture</title></head><body>${body}<script>${script}</script></body></html>`;

export async function createFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');

    if (url.pathname === '/api/value') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ value: 'dynamic-ready' }));
      return;
    }
    if (url.pathname === '/popup') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html('<h1 id="popup">popup-ready</h1>'));
      return;
    }
    if (url.pathname === '/login') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html('<button id="login">login</button>', `
        document.querySelector('#login').addEventListener('click', () => {
          document.cookie = 'poc_session=active; Max-Age=86400; Path=/; SameSite=Lax';
          localStorage.setItem('poc_session', 'active');
          location.href = '/account';
        });
      `));
      return;
    }
    if (url.pathname === '/account') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html('<h1>Account</h1><div id="state"></div>', `
        const cookie = document.cookie.includes('poc_session=active') ? 'active' : 'missing';
        const storage = localStorage.getItem('poc_session') || 'missing';
        document.querySelector('#state').textContent = 'cookie=' + cookie + ' storage=' + storage;
      `));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html(`
      <h1>web-control fixture</h1>
      <div id="dynamic">loading</div>
      <button id="popup-button">open popup</button>
      <input id="name" value=""><div id="pressed"></div><div id="webdriver"></div><div id="privileged"></div>
      <div id="input-trust"></div><div id="key-trust"></div><div id="click-trust"></div>
      <div id="draft" contenteditable="true" role="textbox">previous draft</div>
      <div id="draft-input-trust"></div><div id="draft-key-trust"></div>
      <button id="save-draft">Save local draft</button><div id="saved-draft"></div>
      <div id="echo"></div>
    `, `
      document.querySelector('#webdriver').textContent = 'webdriver=' + String(navigator.webdriver);
      document.querySelector('#privileged').textContent = 'node=' + typeof process + ' require=' + typeof require;
      document.querySelector('#name').addEventListener('keydown', e => {
        document.querySelector('#key-trust').textContent = 'key-trusted=' + String(e.isTrusted);
        if (e.key === 'Enter') document.querySelector('#pressed').textContent = 'pressed-enter';
        else document.querySelector('#pressed').textContent = 'key=' + e.key;
      });
      fetch('/api/value').then(r => r.json()).then(data => {
        document.querySelector('#dynamic').textContent = data.value;
      });
      document.querySelector('#popup-button').addEventListener('click', e => {
        document.querySelector('#click-trust').textContent = 'click-trusted=' + String(e.isTrusted);
        window.open('/popup', '_blank');
      });
      document.querySelector('#draft').addEventListener('input', e => {
        document.querySelector('#draft-input-trust').textContent = 'draft-input-trusted=' + String(e.isTrusted);
      });
      document.querySelector('#draft').addEventListener('keydown', e => {
        document.querySelector('#draft-key-trust').textContent = 'draft-key-trusted=' + String(e.isTrusted);
      });
      document.querySelector('#save-draft').addEventListener('click', e => {
        document.querySelector('#saved-draft').textContent = 'draft-saved=' +
          document.querySelector('#draft').innerText.trim() +
          ' click-trusted=' + String(e.isTrusted);
      });
      document.querySelector('#name').addEventListener('input', e => {
        document.querySelector('#input-trust').textContent = 'input-trusted=' + String(e.isTrusted);
        document.querySelector('#echo').textContent = e.target.value;
      });
    `));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
