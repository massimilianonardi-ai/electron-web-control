# Electron Web Control

Independent Electron implementation of the provider-neutral RumiAI `web-control` capability.

The normative contract is `rumiai-dev/specifications/rumiai-os/WEB-CONTROL.md`. This project exercises Electron's main-process `BrowserWindow`/`webContents` APIs rather than Playwright. The portable public command and service identities remain `web-control`; `electron-web-control` is the concrete project identity.

## Development

Prerequisites: Node.js (for npm and the command client), Electron 44.3.0 via the exact npm dependency, an operational graphical desktop or Xvfb, and a Linux user whose Chromium sandbox works. No system-wide unsandboxed browser switch is enabled by default.

```sh
npm install
npm test
```

For manual operation in two terminals:

```sh
./bin/web-control-service
./bin/web-control status
./bin/web-control page new
```

`WEB_CONTROL_HOME` selects the provider-owned profile root. Without it, the standalone default is `~/.electron-web-control`. Profiles are never silently shared with Chrome/Playwright or personal browser installations. The default controller socket is Unix-local and access-restricted; `WEB_CONTROL_SOCKET` may override it.

Visible Electron windows now open an opaque local start page with an address field, rather than an empty window. Enter a URL and select **Open** to navigate without a terminal command. The native **Navigate** menu provides **Ctrl/⌘+L** to enter another address, **Alt+Left/Right** for history, and **Ctrl/⌘+R** to reload. This is a minimal Electron window for controlled browsing, not a complete Chrome-style browser; authentication-site acceptance still requires physical testing.

The initial Electron implementation uses a real `BrowserWindow` for each page. Closing every window leaves the foreground controller alive; `web-control status` then reports `browserRunning: false`, and `web-control page new` creates a replacement window. Electron itself continues running so the service can accept commands. `WEB_CONTROL_HEADLESS=1` requests hidden windows for automated runs, rather than enabling Chromium's headless mode.

The baseline `status`, `page list/new/close/navigate/inspect/capture/click/fill/press` commands use the same JSON response shapes as the first provider where practical. Electron does not expose the Playwright-specific `debug cdp` and MHTML extensions. CSS selectors are the first provider-local target representation, not the canonical facility contract.

Security: Electron renderer Node integration is disabled; context isolation, sandbox and web security are enabled. Browser state belongs under the Electron provider's HOME. No unrestricted debug port or CAPTCHA bypass is exposed. Login challenges remain manual. Compatibility with any individual authentication site is deliberately **not** claimed without direct tests.

The provider is released and cataloged but remains experimental. The visible desktop flow and login compatibility require physical validation; a successful headless or Xvfb capture does not prove compositor rendering or human input on the user's VM.


## Experimental validation and limitations

The clean Ubuntu GitHub Actions smoke test launches the real Electron main process with the Chromium SUID sandbox correctly owned by root and mode `4755`, plus Xvfb and Openbox. It exercises the public CLI, DOM, popup windows, PNG/HTML/text capture, isolated session persistence across service restart and recreation after closing every window. GitHub Actions is not a substitute for physical validation on a user's desktop.

On this automated runner, the test page reported `navigator.webdriver === false` and did not expose `process` or `require` to its renderer. These observations are neither a security guarantee nor proof that Google or another service will permit sign-in.

Electron native `webContents.sendInputEvent` events can be accepted by the main process yet not reach DOM listeners in the tested environment. For `click` and `press`, this experimental implementation verifies receipt at the DOM and falls back explicitly to synthetic DOM events if necessary. Such events have `isTrusted === false`, can be detected/rejected by sites and may not perform all platform-native default actions. The fallback emits a warning to the service's stderr, and **must not be described as undetectable browser automation**. `fill` currently uses the native value setter plus synthetic `input`/`change` DOM events. These are known limitations requiring evaluation against real sites.

`ELECTRON_WEB_CONTROL_SOFTWARE_RENDERING=1` explicitly disables hardware acceleration for environments such as Xvfb where screenshot capture otherwise fails with a Viz renderer error. It is enabled in the Linux CI job, not by default on graphical desktops. A normal Linux installation needs a usable Chromium sandbox helper or supported user-namespace sandbox setup; the test runner prepares its disposable Electron helper without disabling sandboxing.

`mk build` emits `dist/electron-web-control-v<version>-all.tar.gz`. The release archive contains only the provider's portable Node.js source, its executable commands, metadata and README. Electron/Chromium is intentionally **not** bundled: a deployed provider must consume the separately managed `electron` package together with `nodejs`. The provider archive is published and `pkg-catalog` defines the `electron-web-control` concrete package and its `web-control 1` facility realization. The reference Playwright provider remains unchanged.

## Build and distribution

After dependencies are prepared, `mk check test build` is the canonical development lifecycle. The automated Linux build uses `m mk` with managed Node.js 26. Direct development can use `npm run build`.

The release is osarch-independent by design because it does not include the Electron application binary or npm's `node_modules`. Its runtime requires managed `nodejs` and the platform-appropriate `electron` package, with real sandbox setup on Linux. The package-specific controller HOME must remain separate from both the Electron binary package and any personal browser profile.


## Installation through RumiAI OS

The released portable package consumes the existing `nodejs 26` and `electron 1` runtime facilities. The package resolver plans and installs their concrete providers through the normal `pkg` dependency path; Electron itself remains an independent platform-specific package.

```sh
pkg install electron-web-control
pkg provider default web-control electron-web-control
srv start web-control
web-control status
srv stop web-control
```

When replacing an already-running provider, first stop its controller with `srv stop web-control`, then change the facility default and start the service again. A second `srv start` against an already-running service does not replace its process. A prior failed v0.1.0 install may have left a package concrete without a default; install `electron-web-control@v0.1.1` explicitly to recover that state without deleting browser profiles.

A configured `web-control` default selects this provider for the ordinary public command and service without changing their portable names. Changing the provider does **not** transfer Playwright profile data or authenticated sessions. Managed provider state is resolved by `state-path` and the package launcher; callers should not construct its physical location.

The original v0.1.0 package used the ordinary `web-control-service` command, colliding with an already-installed Playwright provider at package default selection. Version v0.1.1 declares the provider-specific command `electron-web-control-service` for the portable `web-control` service, without changing the public facility name. A formal two-provider integration test first selects Playwright, reproduces the failed v0.1.0 default selection, installs v0.1.1 without deleting the partial installation, switches the provider, and starts Electron through `srv`. This full recovery and coexistence scenario passed on Linux x86_64 and ARM64 in run `38088010462`. The separate macOS ARM64 package-validation job remains pending at the latest checkpoint; hosted tests do not validate Google sign-in or the user's physical machines.
