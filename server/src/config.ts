import { z } from "zod";
import { resolve } from "node:path";

/**
 * Environment configuration for the planforge HTTP service.
 *
 * PLANFORGE_ROOT defaults to the parent of this package — the layout assumed
 * is `agent-planforge/server/` as a sub-package. Deployments that relocate
 * the CLI must set PLANFORGE_ROOT explicitly.
 */
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8223),
  PLANFORGE_SERVICE_TOKEN: z.string().min(1, "PLANFORGE_SERVICE_TOKEN is required"),
  PLANFORGE_ROOT: z.string().default(resolve(import.meta.dirname, "..", "..")),
  // Node binary used to spawn bootstrap-plan.js. Defaults to the currently
  // running Node, so containers that ship a single Node install get the
  // right value without configuration.
  NODE_BIN: z.string().default(process.execPath),
  // Python binary that runs `scaffoldkit.cli from-planforge` after the
  // planforge CLI writes `scaffoldkit-input.json`. The Dockerfile lays
  // down a pinned venv at /opt/sk-venv; local dev / tests override.
  SCAFFOLDKIT_PYTHON: z.string().default("/opt/sk-venv/bin/python3"),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
