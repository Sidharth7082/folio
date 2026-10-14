Folio — a reading room for light novels
=======================================

Folio is a small web app that reads the novels you already have and keeps
your place in them. It runs on your own machine, so nothing is uploaded
anywhere and there is no account to make.


Starting it
-----------

You need Node.js, version 22 or newer. If you are not sure whether you have
it, just try starting Folio — it will tell you, and point you at
https://nodejs.org.

  Windows   double-click  start-folio.bat
  macOS     double-click  start-folio.command
  Linux     run           ./start-folio.sh

A window opens with the address, and your browser should follow it to
http://localhost:3100. Leave the window open while you read; close it to stop
Folio.

On macOS, if double-clicking does nothing, the file has probably lost its
"executable" mark — some unzip tools do this. Open Terminal in this folder
and run:

  chmod +x start-folio.command

If macOS then refuses to open it because it is from an unidentified
developer, right-click it and choose Open, then confirm.


Adding books
------------

Put your .epub, .txt or .md files into:

  Windows   %USERPROFILE%\Folio\content
  macOS     ~/Folio/content
  Linux     ~/Folio/content

Then use "Add books" in the app and press "Import from this folder". You can
also drag files straight onto that page, which is easier for one or two books.

Folio reads what you give it. It has no way to download a novel for you.


Where your data lives
---------------------

Everything personal is kept in the Folio folder above — your books, their
covers, and the catalogues Folio has imported. The app folder holds only the
program.

That split is on purpose: you can replace the app folder with a newer version
without touching your library.

To keep your books somewhere else, set FOLIO_HOME to that folder before
starting Folio. To use a different port, set PORT.


Stopping it
-----------

Close the window that opened when you started Folio, or press Ctrl-C in it.
Nothing is left running in the background.


Credits
-------

The bundled catalogue, when present, is derived from RanobeDB
(https://ranobedb.org), which is made available under the Open Database
License. It is included here under the same terms.

The optional second catalogue is derived from MangaBaka
(https://mangabaka.org) under CC BY-NC-SA, and in turn republishes data from
AniList, MyAnimeList, Kitsu and MangaUpdates. It is not included by default
because those terms are more restrictive.

Folio itself is a separate work and is not affiliated with any of them.
