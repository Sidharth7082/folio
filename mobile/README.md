# Folio for Android

The whole reader, on the phone, with nothing behind it.

Books are imported from the device, parsed on the device and read on the device.
There is no server to run and nothing to configure: install it, tap **+**, and
pick an EPUB or a text file. A novel you are part-way through keeps working in a
tunnel, on a plane, or with the Wi-Fi off.

It used to be a shell for a Folio server on your own machine, and stopped being
one deliberately — a reading app that needs a computer running to open a book is
a reading app that fails at the exact moment you want it.

## Getting the APK

You do not need any Android tooling. Push a tag and the workflow builds it:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The APKs are attached to that release. You can also run the `Android` workflow
from the Actions tab and download the APK from the run's artifacts.

Building locally needs a JDK, the Android SDK and Gradle, which is why the
workflow exists:

```bash
npm install
npm run apk:debug     # → android/app/build/outputs/apk/debug/
```

## Using it

Tap **+** to import an EPUB, or a `.txt`/`.md`, from wherever the system picker
can reach. Books are parsed as they are imported, so opening one later is
immediate, and importing the same file again replaces it rather than leaving two
copies. The library remembers how far you got in each book.

Tapping the titles at the top of the reader opens the chapter list, which opens
centred on where you are and filters by number or name — the difference between
usable and not in a novel with a thousand chapters. The magnifier beside it
searches every chapter of the book at once, and tapping a result opens that
chapter at the match.

**Aa** opens the reading settings: theme, typeface, text size, line spacing,
margins and alignment, plus a box for your own CSS. The variables are the ones
LNReader documents — `--readerSettings-textSize`, `--theme-primary` and the rest
— so a stylesheet written for that app applies here unchanged.

Those settings belong to every book unless you say otherwise. The switch at the
top of the sheet gives the book you are reading a copy of its own; from then on
it keeps that copy, and changes to the shared settings leave it alone. Switching
back throws its copy away.

The button beside **+** shows a backup: the settings, each book's own type, and
how far you are in each book, as a block of text to copy somewhere — a note, a
chat, an email to yourself — and paste back on the next phone. The books
themselves are not in it. They are megabytes each, and the files they came from
are still wherever they came from.

The speaker button reads the chapter aloud through the phone's own speech engine,
one sentence at a time. The sentence being spoken is highlighted, and the word
being spoken inside it more strongly, following the voice as it goes. The bar
that appears at the bottom skips a sentence at a time, changes speed, and stops.
By default it reads on into the next chapter; the settings sheet can make it stop
at the end of one instead.

This needs a text-to-speech engine on the phone, which every normal Android build
has. If yours does not, the app says so rather than sitting there silent.

## Signing

Release builds are signed with the debug key unless you supply a keystore, which
is enough to install on your own phone. A real keystore matters only for
publishing updates: Android refuses to install an APK signed with a different key
over an existing one, so switching keys later means uninstalling first.

To sign properly, set these repository secrets and the workflow picks them up:

| Secret | Meaning |
|---|---|
| `FOLIO_KEYSTORE_PATH` | Path to the `.jks` file |
| `FOLIO_KEYSTORE_PASSWORD` | Keystore password |
| `FOLIO_KEY_ALIAS` | Key alias |
| `FOLIO_KEY_PASSWORD` | Key password |

## Why cleartext HTTP is allowed

`AndroidManifest.xml` sets `usesCleartextTraffic="true"`. That dates from when
the app fetched from a Folio server over plain HTTP on the local network, and
Android has blocked cleartext by default since API 28.

The reader itself no longer connects anywhere, so nothing that ships depends on
it. It is kept for the development switch in `capacitor.config.ts`, which points
the app at a dev server over `http://` so the reader can be worked on without
rebuilding the APK for every edit. A build that drops the switch can drop the
flag with it.

## Layout

```
www/                     the app itself (plain HTML/CSS/JS, no bundler)
  index.html             library, reader, player, chapter list, search, backup
  app.js                 import, library, reader, settings, reading aloud
  styles.css             the app palette, and the reader's own variables
  lib/epub.js            EPUB -> metadata and chapters of plain text
  lib/zip.js             the part of ZIP that an EPUB actually needs
  lib/plain.js           .txt and .md -> chapters
  lib/store.js           the library, in IndexedDB
  lib/settings.js        typography: shared, or a book's own
  lib/highlight.js       offsets into text -> Ranges, and painting them
  lib/search.js          one phrase, across every chapter
  lib/tts.js             sentences, the speech queue, following the voice
capacitor.config.ts      app id, name, splash, development server switch
android/                 generated by `npx cap add android`, then customised
  app/src/main/AndroidManifest.xml    cleartext, as explained above
  app/src/main/java/.../FolioTtsPlugin.java         the phone's speech engine
  app/src/main/java/.../FolioClipboardPlugin.java   copy and paste
  app/src/main/res/                   icons and splash, from `npm run icons`
  app/build.gradle                    signing config
```

`www/` has no build step on purpose: it is loaded before anything else exists,
so it cannot depend on the app's bundle. It does not import Capacitor plugins
either — it reaches them through the bridge Capacitor injects, guarded, so the
same files run in a desktop browser while developing. On a build with no bridge
there is simply no voice, and the reader carries on regardless.

The plugins in `app/src/main/java/` are the exception to all of that, and the only
native code in the project. `speechSynthesis` is undefined inside an Android
WebView — checked on a device rather than assumed — so there is no way to speak
from the page at all: `FolioTtsPlugin` turns one sentence into speech and reports
the character range being spoken right now, which is what moves the highlight.
The clipboard is the same story: the WebView refuses both of its own ways of
copying, so `FolioClipboardPlugin` hands the text to the system instead.

## Icons

Launcher icons and splash screens come from `npm run icons` in the repository
root, which renders them from the same artwork as the web icons. Do not edit the
PNGs in `android/app/src/main/res/` directly; they are overwritten.
