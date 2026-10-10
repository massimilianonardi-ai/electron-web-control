// Provider-local, unprivileged navigation entry for visible Electron windows.
// This data URL has an opaque origin and no Node.js integration or service API.
export const startPageURL = 'data:text/html;charset=utf-8,' + encodeURIComponent(String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Electron Web Control — Open a page</title>
<style>
  :root { color-scheme: light; font: 16px system-ui, -apple-system, sans-serif; background: #f4f6fa; color: #15253b; }
  body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
  main { width: min(660px, calc(100% - 48px)); padding: 36px; background: white; border: 1px solid #d7dfe9; border-radius: 14px; box-shadow: 0 8px 30px #26374f17; }
  h1 { margin: 0 0 12px; font-size: 26px; }
  p { line-height: 1.5; color: #43536b; }
  form { display: flex; gap: 10px; margin: 24px 0 12px; }
  input { flex: 1; min-width: 0; padding: 12px 14px; font: inherit; border: 1px solid #879bb5; border-radius: 7px; }
  input:focus { outline: 2px solid #3767b5; outline-offset: 1px; }
  button { padding: 12px 20px; font: inherit; border: 0; border-radius: 7px; background: #204c96; color: white; cursor: pointer; }
  small { color: #586981; }
  #error { color: #a72121; min-height: 22px; }
</style>
</head>
<body>
<main>
<h1>Electron Web Control</h1>
<p>Enter a web address to open a site in this window. You can use the site with your mouse and keyboard, including manual sign-in.</p>
<form id="web-control-navigation">
  <input id="web-control-address" aria-label="Web address" autocomplete="url" placeholder="https://example.org" autofocus required>
  <button id="web-control-open" type="submit">Open</button>
</form>
<p id="error" role="alert"></p>
<small>Use Ctrl/⌘+L or the Navigate menu to enter another address. Back and Forward are also in the Navigate menu.</small>
</main>
<script>
  document.querySelector('#web-control-navigation').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#web-control-address').value.trim();
    const address = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : 'https://' + input;
    try {
      const url = new URL(address);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only HTTP and HTTPS addresses are supported.');
      window.location.assign(url.href);
    } catch (error) {
      document.querySelector('#error').textContent = error.message || 'Invalid web address';
    }
  });
</script>
</body>
</html>`);