@echo off
setlocal enabledelayedexpansion

rem Start Folio and open it in your browser.
rem
rem Double-click this file. Leave the window open while you read; close it to
rem stop Folio. No arguments are needed.
rem
rem To change where your books are kept, or which port is used, set FOLIO_HOME or
rem PORT before running this file.

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "APP=%HERE%\app"

rem Where your books, covers and reading data live.
rem
rem Deliberately outside the app folder, so replacing the app never loses your
rem library.
if not defined FOLIO_HOME set "FOLIO_HOME=%USERPROFILE%\Folio"
if not exist "%FOLIO_HOME%\content" mkdir "%FOLIO_HOME%\content"
if not exist "%FOLIO_HOME%\covers" mkdir "%FOLIO_HOME%\covers"

rem The catalogue shipped alongside this launcher, opened read-only.
if exist "%HERE%\catalogue.db" set "NOVEL_READER_CATALOGUE_DB=%HERE%\catalogue.db"

rem Optional: absent from the default download, because its upstream licences are
rem more restrictive than the rest of the app. Folio works without it.
if exist "%HERE%\mangabaka.db" set "NOVEL_READER_MANGABAKA_DB=%HERE%\mangabaka.db"

if not defined PORT set "PORT=3100"
set "URL=http://localhost:%PORT%"

where node >nul 2>&1
if errorlevel 1 (
  echo Folio needs Node.js, and it does not look like it is installed.
  echo.
  echo Get the LTS version from https://nodejs.org, install it, then run this
  echo file again.
  echo.
  pause
  exit /b 1
)

echo Folio is starting at %URL%
echo Your books are kept in %FOLIO_HOME%
echo.
echo Leave this window open while you read. Close it to stop Folio.
echo.

rem Wait for the server to accept a connection, then open the browser, so the
rem first page does not fail while Node is still starting up.
start "" /b powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); Start-Process '%URL%'; break } catch { Start-Sleep -Milliseconds 250 } }"

cd /d "%APP%"
node server.js

rem The server has exited; keep the window up so any error stays readable.
echo.
echo Folio has stopped.
pause
