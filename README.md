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

The initial Electron implementation uses a real `BrowserWindow` for each page. Closing every window leaves the foreground controller alive; `web-control status` then reports `browserRunning: false`, and `web-control page new` creates a replacement window. Electron itself continues running so the service can accept commands. `WEB_CONTROL_HEADLESS=1` requests hidden windows for automated runs, rather than enabling Chromium's headless mode.

The baseline `status`, `page list/new/close/navigate/inspect/capture/click/fill/press` commands use the same JSON response shapes as the first provider where practical. Electron does not expose the Playwright-specific `debug cdp` and MHTML extensions. CSS selectors are the first provider-local target representation, not the canonical facility contract.

Security: Electron renderer Node integration is disabled; context isolation, sandbox and web security are enabled. Browser state belongs under the Electron provider's HOME. No unrestricted debug port or CAPTCHA bypass is exposed. Login challenges remain manual. Compatibility with any individual authentication site is deliberately **not** claimed without direct tests.

This repository is under experimental development. Do not advertise or catalog an installable `electron-web-control` provider until the real release artifact and compatibility-level-1 conformance have been validated.


## Experimental validation and limitations

The clean Ubuntu GitHub Actions smoke test launches the real Electron main process with the Chromium SUID sandbox correctly owned by root and mode `4755`, plus Xvfb and Openbox. It exercises the public CLI, DOM, popup windows, PNG/HTML/text capture, isolated session persistence across service restart and recreation after closing every window. GitHub Actions is not a substitute for physical validation on a user's desktop.

On this automated runner, the test page reported `navigator.webdriver === false` and did not expose `process` or `require` to its renderer. These observations are neither a security guarantee nor proof that Google or another service will permit sign-in.

Electron native `webContents.sendInputEvent` events can be accepted by the main process yet not reach DOM listeners in the tested environment. For `click` and `press`, this experimental implementation verifies receipt at the DOM and falls back explicitly to synthetic DOM events if necessary. Such events have `isTrusted === false`, can be detected/rejected by sites and may not perform all platform-native default actions. The fallback emits a warning to the service's stderr, and **must not be described as undetectable browser automation**. `fill` currently uses the native value setter plus synthetic `input`/`change` DOM events. These are known limitations requiring evaluation against real sites.

`ELECTRON_WEB_CONTROL_SOFTWARE_RENDERING=1` explicitly disables hardware acceleration for environments such as Xvfb where screenshot capture otherwise fails with a Viz renderer error. It is enabled in the Linux CI job, not by default on graphical desktops. A normal Linux installation needs a usable Chromium sandbox helper or supported user-namespace sandbox setup; the test runner prepares its disposable Electron helper without disabling sandboxing.

This project has **no released package artifact or `pkg-catalog` provider registration yet**. The reference Playwright provider and its live installed state are unchanged.
