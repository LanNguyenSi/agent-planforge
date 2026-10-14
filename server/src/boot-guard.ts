import { accessSync, constants } from "node:fs";
import { env } from "./config.js";

export type ScaffoldkitStatus = "ok" | "missing";

let cachedStatus: ScaffoldkitStatus | undefined;
let bootLogEmitted = false;

function probe(): ScaffoldkitStatus {
  try {
    accessSync(env.SCAFFOLDKIT_PYTHON, constants.X_OK);
    return "ok";
  } catch {
    return "missing";
  }
}

/**
 * Returns the SCAFFOLDKIT_PYTHON probe result, memoized for the lifetime
 * of the process. Used by /healthz to surface deployment misconfig to the
 * ops dashboard without re-stating the filesystem on every healthcheck.
 */
export function getScaffoldkitStatus(): ScaffoldkitStatus {
  if (cachedStatus === undefined) cachedStatus = probe();
  return cachedStatus;
}

/**
 * Boot-time loud-warn when SCAFFOLDKIT_PYTHON is missing/non-executable.
 * Without this guard a misconfigured deployment boots cleanly, then every
 * /api/generate with scaffold:true (the default) misbehaves: a path that
 * does not exist (ENOENT) returns `skipped: "not_installed"` silently
 * (easy to miss in monitoring for hours), while a path that exists but is
 * not executable (EACCES) ends the request with an SSE `error` event
 * ("Failed to spawn scaffoldkit"). Only ENOENT is mapped to a skip
 * reason. Idempotent: only logs on the first call.
 *
 * Not fatal: dev environments legitimately don't ship the venv. Set
 * PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1 to acknowledge the dev case and
 * downgrade the message to a single-line info note.
 */
export function reportScaffoldkitStatusOnBoot(): ScaffoldkitStatus {
  const status = getScaffoldkitStatus();
  if (bootLogEmitted) return status;
  bootLogEmitted = true;
  if (status === "ok") return status;
  const allowMissing = process.env.PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT === "1";
  if (allowMissing) {
    console.warn(
      `[boot] SCAFFOLDKIT_PYTHON ${env.SCAFFOLDKIT_PYTHON} is missing or not executable; ` +
        `PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1 set, continuing (scaffold steps will skip or error).`,
    );
    return status;
  }
  console.warn(
    "\n" +
      "!!! [boot] SCAFFOLDKIT_PYTHON is missing or not executable.\n" +
      `!!!       path: ${env.SCAFFOLDKIT_PYTHON}\n` +
      "!!!       Every /api/generate with scaffold:true (the default) will fail: a\n" +
      '!!!       missing path returns skipped: "not_installed" silently, a path that\n' +
      "!!!       exists but is not executable ends the request with an error event.\n" +
      "!!!       Fix the deployment, or set PLANFORGE_ALLOW_MISSING_SCAFFOLDKIT=1\n" +
      "!!!       to acknowledge this is a dev env.\n",
  );
  return status;
}
