import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Folio is a server, so this shell does not bundle it.
 *
 * The app asks for your Folio server's address on first launch, remembers it,
 * and opens it full screen afterwards. That keeps the phone app thin, and keeps
 * your library in one place instead of copying it onto the device and then
 * having two of everything to keep in step.
 *
 * There is deliberately no `server.url`. Setting one makes the WebView load the
 * remote page straight away, which leaves nowhere to ask for the address.
 */
const config: CapacitorConfig = {
  // The convention for projects with no domain to anchor a reverse-DNS id to.
  appId: "io.github.sidharth7082.folio",
  appName: "Folio",
  webDir: "www",
  server: {
    // Serve the bundled shell over http, not Capacitor's default https.
    //
    // Verifying on a device showed why this matters: at https://localhost, a
    // plain-http request to a self-hosted Folio is mixed content, and the WebView
    // blocks it. Every reachability probe failed with "Failed to fetch", so the
    // app reported that no server answered even when one was running.
    //
    // http://localhost is still a secure context, and the cleartext permission the
    // manifest already grants covers the rest.
    androidScheme: "http",
  },
  android: {
    // Matches the app's own background, so the gap before the first paint is not
    // a white flash in a dark reader.
    backgroundColor: "#0c0e13",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0c0e13",
  },
  plugins: {
    SplashScreen: {
      // Held until the launch screen has decided what to show, so the splash does
      // not disappear onto a blank white frame.
      backgroundColor: "#0c0e13",
      showSpinner: false,
      launchAutoHide: false,
      androidScaleType: "CENTER_CROP",
    },
  },
};

export default config;
