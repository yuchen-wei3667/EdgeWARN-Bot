import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../assets");

let registered = false;

/**
 * Points fontconfig at the bundled Sora files so the SVG text renders in the same face on every host.
 * Must run before the first text render in the process.
 */
export const registerFonts = (): void => {
  if (registered) {
    return;
  }

  const dir = path.join(os.tmpdir(), "edgewarn-bot-fontconfig");
  fs.mkdirSync(dir, { recursive: true });
  const confPath = path.join(dir, "fonts.conf");
  fs.writeFileSync(
    confPath,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${path.join(ASSETS_DIR, "fonts")}</dir>
  <cachedir>${path.join(dir, "cache")}</cachedir>
</fontconfig>
`
  );
  process.env.FONTCONFIG_FILE = confPath;
  registered = true;
};
