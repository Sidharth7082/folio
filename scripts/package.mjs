/**
 * Assembles a folder someone can download and run.
 *
 *   node scripts/package.mjs
 *
 * Produces `dist/folio/`, which contains the built app, the launchers, and (with
 * `--with-catalogue`) the imported catalogues. Nothing in it needs `npm install`;
 * it only needs Node itself.
 *
 * The catalogue databases are opt-in because they are large and carry their own
 * licences, so a code-only build is the default.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const outDir = path.join(distRoot, "folio");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);

const WITH_CATALOGUE = flag("with-catalogue");
const WITH_MANGABAKA = flag("with-mangabaka");
const SKIP_BUILD = flag("skip-build");

/** Human-readable size, since the point of this script is partly to report it. */
function describe(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function directorySize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(from, to, { crlf = false, executable = false } = {}) {
  const contents = await fs.readFile(from);
  // Batch files are still happiest with Windows line endings, and the repo keeps
  // everything LF so the diffs stay clean.
  const data = crlf ? Buffer.from(contents.toString("utf8").replace(/\r?\n/g, "\r\n")) : contents;
  await fs.writeFile(to, data);
  if (executable) await fs.chmod(to, 0o755);
}

async function main() {
  const standalone = path.join(projectRoot, ".next", "standalone");

  if (!SKIP_BUILD) {
    console.log("Building…");
    const { spawn } = await import("node:child_process");
    const build = spawn("npm", ["run", "build"], { cwd: projectRoot, stdio: "inherit" });
    const code = await new Promise((resolve) => build.on("close", resolve));
    if (code !== 0) throw new Error(`build failed with exit code ${code}`);
  }

  if (!(await exists(standalone))) {
    throw new Error("no .next/standalone found — run a build first, or drop --skip-build");
  }

  // Start clean so a stale file can never survive into a release.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const appDir = path.join(outDir, "app");
  await fs.cp(standalone, appDir, { recursive: true });

  // Next deliberately leaves these two out of the standalone folder, because how
  // they are served depends on the deployment. Here they sit beside server.js.
  await fs.cp(path.join(projectRoot, "public"), path.join(appDir, "public"), {
    recursive: true,
  });
  await fs.cp(path.join(projectRoot, ".next", "static"), path.join(appDir, ".next", "static"), {
    recursive: true,
  });

  // Sharing one launcher between macOS and Linux is fine: it branches on uname.
  await copyFile(path.join(projectRoot, "packaging", "start-folio.sh"), path.join(outDir, "start-folio.sh"), {
    executable: true,
  });
  await copyFile(
    path.join(projectRoot, "packaging", "start-folio.sh"),
    path.join(outDir, "start-folio.command"),
    { executable: true },
  );
  await copyFile(path.join(projectRoot, "packaging", "start-folio.bat"), path.join(outDir, "start-folio.bat"), {
    crlf: true,
  });
  await copyFile(path.join(projectRoot, "packaging", "README.txt"), path.join(outDir, "README.txt"));

  const databases = [];
  if (WITH_CATALOGUE) databases.push({ from: "data/catalogue.db", to: "catalogue.db" });
  if (WITH_MANGABAKA) databases.push({ from: "data/mangabaka.db", to: "mangabaka.db" });

  for (const database of databases) {
    const source = path.join(projectRoot, database.from);
    if (!(await exists(source))) {
      console.warn(`  ! ${database.from} not found, skipping`);
      continue;
    }
    await fs.copyFile(source, path.join(outDir, database.to));
    console.log(`  + ${database.to}`);
  }

  const size = await directorySize(outDir);
  console.log("");
  console.log(`Packaged into ${path.relative(projectRoot, outDir)} (${describe(size)})`);
  console.log("");
  console.log("  app/                  the built server");
  console.log("  start-folio.bat       Windows");
  console.log("  start-folio.command   macOS");
  console.log("  start-folio.sh        Linux");
  for (const database of databases) console.log(`  ${database.to}`);
  if (!WITH_CATALOGUE) {
    console.log("");
    console.log("No catalogue included. Add --with-catalogue to bundle one.");
  }
}

await main();
