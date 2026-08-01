import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await Promise.all([
  rm(resolve(projectRoot, "dist", ".DS_Store"), { force: true }),
  rm(resolve(projectRoot, "dist", "client", ".DS_Store"), { force: true }),
  rm(resolve(projectRoot, "desktop-dist", ".DS_Store"), { force: true }),
]);
