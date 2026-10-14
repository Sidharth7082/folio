import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The phone app: a shell around the reader in `www`.
 *
 * Everything happens on the device. Books are imported from the phone, parsed
 * on it and read on it, so there is nothing to configure and nothing to connect
 * to — and no `server.url` in a build that ships.
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
    // plain-http request is mixed content, and the WebView blocks it outright.
    // Every reachability probe failed with "Failed to fetch", so the app
    // reported that no server answered even when one was running.
    //
    // http://localhost is still a secure context, and the cleartext permission
    // the manifest already grants covers the rest.
    androidScheme: "http",

    // A development-only escape hatch, absent from every build that ships.
    //
    // Text-to-speech lives in a native plugin, and Capacitor only injects its
    // bridge into pages it is itself serving. A dev server is therefore the one
    // way to have the bridge while editing the reader without rebuilding the
    // APK for every change. Set FOLIO_LIVE_SERVER to enable it:
    //
    //   FOLIO_LIVE_SERVER=http://10.0.2.2:3400 npx cap sync android
    //
    // 10.0.2.2 is how the emulator reaches this machine's localhost. The
    // release build never sets it, and the CI workflow cannot.
    ...(process.env.FOLIO_LIVE_SERVER
      ? { url: process.env.FOLIO_LIVE_SERVER, cleartext: true }
      : {}),
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
