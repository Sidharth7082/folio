/*
 * The launch screen's behaviour: work out which Folio server to open, and open it.
 *
 * No bundler and no plugin imports on purpose. This file is loaded by the WebView
 * as a plain script, before the remote app exists, so anything it depends on has
 * to be either a browser API or the bridge Capacitor injects. The native plugins
 * it does use are reached through that injected bridge and guarded, so the same
 * file also runs in a desktop browser during development.
 */

const STORAGE_KEY = "folio.server";

const els = {
  connected: document.getElementById("connected"),
  setup: document.getElementById("setup"),
  savedUrl: document.getElementById("saved-url"),
  open: document.getElementById("open"),
  change: document.getElementById("change"),
  form: document.getElementById("form"),
  url: document.getElementById("url"),
  status: document.getElementById("status"),
  connect: document.getElementById("connect"),
};

/** The Capacitor bridge, when running inside the native shell. */
const bridge = globalThis.Capacitor;

/**
 * Turn whatever was typed into a usable origin, or null if it cannot be one.
 *
 * People type `192.168.0.193:3100`, which is not a URL — it parses as the scheme
 * `192.168.0.193`. Assuming http for anything without a scheme is what makes the
 * obvious input work.
 */
function normaliseServer(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `http://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;

  // The URL parser is lenient enough to accept a space in a host, turning
  // "hello world" into a hostname rather than an error. Left alone that would be
  // saved and retried on every launch. IPv6 literals keep their brackets here.
  if (!/^[A-Za-z0-9._~[\]:-]+$/.test(parsed.hostname)) return null;

  // Folio is served from the root of its origin, so a path here is a mistake
  // (usually a copy-paste of a page URL). Drop it rather than 404 later.
  return parsed.origin;
}

/**
 * Is something actually serving Folio at this address?
 *
 * An image load rather than fetch: this page runs on Capacitor's own origin, so a
 * cross-origin fetch would be refused by CORS before it could tell us anything.
 * Image loads are not subject to that, and the icon is a file every build ships.
 */
function probe(origin, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = `${origin}/icons/icon-192.png?_=${Date.now()}`;
  });
}

function setStatus(message, tone) {
  els.status.textContent = message;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

function showSetup({ message = "", tone = "" } = {}) {
  els.connected.hidden = true;
  els.setup.hidden = false;
  setStatus(message, tone);
  els.url.focus();
}

function showConnected(server) {
  els.setup.hidden = true;
  els.connected.hidden = false;
  els.savedUrl.textContent = server;
}

function openFolio(server) {
  // `assign` rather than `replace` so the hardware back button has somewhere to
  // return to, which is what makes the address changeable after first run.
  globalThis.location.assign(server);
}

function save(server) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, server);
  } catch {
    // Private mode or a cleared store. The app still works; it just asks again.
  }
}

function load() {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const server = normaliseServer(els.url.value);
  if (!server) {
    setStatus("That does not look like an address. Try 192.168.0.193:3100.", "bad");
    return;
  }

  els.connect.disabled = true;
  setStatus(`Looking for Folio at ${server}…`);

  const reachable = await probe(server);
  els.connect.disabled = false;

  if (!reachable) {
    // Saved anyway, so a server that is merely asleep does not force retyping.
    save(server);
    setStatus("Nothing answered there. Check Folio is running and you are on the same Wi-Fi.", "bad");
    return;
  }

  save(server);
  setStatus("Connected. Opening…");
  openFolio(server);
});

els.open.addEventListener("click", () => {
  const server = load();
  if (server) openFolio(server);
  else showSetup();
});

els.change.addEventListener("click", () => {
  els.url.value = load() ?? "";
  showSetup();
});

/**
 * Native plugins are reached through the injected bridge.
 *
 * `@capacitor/app` provides `backButton`. Without a handler, Android closes the
 * app as soon as the WebView cannot go back — which would make leaving a chapter
 * exit Folio. This sends the user to the address screen instead.
 */
function wireHardwareBack() {
  const app = bridge?.Plugins?.App;
  if (!app?.addListener) return;

  app.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      globalThis.history.back();
      return;
    }
    if (els.connected.hidden) {
      // Already on the address screen, so a second press should leave.
      app.exitApp?.();
      return;
    }
    els.url.value = load() ?? "";
    showSetup();
  });
}

function wireStatusBar() {
  const statusBar = bridge?.Plugins?.StatusBar;
  if (!statusBar?.setStyle) return;

  // The launch screen is dark; the remote app sets its own colours on arrival.
  statusBar.setStyle({ style: "DARK" }).catch(() => {});
  statusBar.setBackgroundColor?.({ color: "#0c0e13" }).catch(() => {});
}

function start() {
  const saved = load();
  if (saved) showConnected(saved);
  else showSetup();

  wireHardwareBack();
  wireStatusBar();

  // The splash has done its job once there is something to look at.
  bridge?.Plugins?.SplashScreen?.hide?.().catch(() => {});
}

start();
