import { execFileSync, spawn } from "node:child_process";
import process from "node:process";

const dryRun = process.argv.includes("--dry-run");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

const revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
  encoding: "utf8",
}).trim();

if (!dryRun && !process.env.CLOUDFLARE_API_TOKEN) {
  console.warn(
    "CLOUDFLARE_API_TOKEN is not set; Wrangler will use its local login. " +
      "Use a dedicated account-scoped API token for routine deployments.",
  );
}

await run(npmCommand, ["run", "build"]);

const deployArgs = [
  "wrangler",
  "deploy",
  "--config",
  "dist/server/wrangler.json",
  "--name",
  "converter",
  "--strict",
];

if (dryRun) {
  deployArgs.push("--dry-run");
} else {
  deployArgs.push("--message", `Git ${revision}`, "--tag", revision);
}

await run(npxCommand, deployArgs);
