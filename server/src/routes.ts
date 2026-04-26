import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { timingSafeEqual } from "node:crypto";
import { env } from "./config.js";
import { getScaffoldkitStatus } from "./boot-guard.js";
import { runGenerate } from "./generate.js";

export const app = new Hono();

/**
 * Attachment tiers the service contract recognises. v0.1a accepts shape
 * only — no tier triggers any processing yet. v0.1b will add text-tier
 * prompt enrichment; later slices bring diagram + structured handling.
 */
const ATTACHMENT_TIERS = ["text", "diagram", "structured"] as const;
type AttachmentTier = (typeof ATTACHMENT_TIERS)[number];

export interface Attachment {
  name: string;
  mimeType: string;
  tier: AttachmentTier;
  inlineText?: string;
  contentRef?: string;
}

/**
 * Hard cap on total char length across all text-tier `inlineText` values
 * in a single request. Chosen over summarization/chunking for v0.1b because
 * silent truncation risks dropping architecturally important sections from
 * an arc42 doc in ways the caller can't see. Fail-fast with 400 keeps the
 * contract honest: oversize means "resample or split into smaller
 * attachments", not "we quietly kept half of it".
 *
 * At ~4 chars/token this is ~12.5k tokens — well inside a planning-context
 * budget for current-generation models and leaves headroom for the CLI's
 * own prompt scaffolding (template, questionnaire, clarifications).
 */
export const ATTACHMENTS_MAX_TOTAL_CHARS = 50_000;

/**
 * Edge-validation for the optional `attachments` field on POST /api/generate.
 * Returns `{ ok: true, attachments }` on a shape-valid payload (including the
 * "field absent" case, which yields `undefined`); returns `{ ok: false, message }`
 * for any malformed input so the caller can 400 with an actionable error.
 *
 * Accepting `undefined` here keeps the field optional without the caller
 * having to check for it first.
 */
function parseAttachments(
  raw: unknown,
): { ok: true; attachments: Attachment[] | undefined } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, attachments: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "`attachments` must be an array when present" };
  }
  const out: Attachment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (!a || typeof a !== "object") {
      return { ok: false, message: `attachments[${i}] must be an object` };
    }
    const rec = a as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.length === 0) {
      return { ok: false, message: `attachments[${i}].name must be a non-empty string` };
    }
    if (typeof rec.mimeType !== "string" || rec.mimeType.length === 0) {
      return { ok: false, message: `attachments[${i}].mimeType must be a non-empty string` };
    }
    if (typeof rec.tier !== "string" || !ATTACHMENT_TIERS.includes(rec.tier as AttachmentTier)) {
      return {
        ok: false,
        message: `attachments[${i}].tier must be one of ${ATTACHMENT_TIERS.join(", ")}`,
      };
    }
    if (rec.inlineText !== undefined && typeof rec.inlineText !== "string") {
      return { ok: false, message: `attachments[${i}].inlineText must be a string when present` };
    }
    if (rec.contentRef !== undefined && typeof rec.contentRef !== "string") {
      return { ok: false, message: `attachments[${i}].contentRef must be a string when present` };
    }
    out.push({
      name: rec.name,
      mimeType: rec.mimeType,
      tier: rec.tier as AttachmentTier,
      inlineText: rec.inlineText as string | undefined,
      contentRef: rec.contentRef as string | undefined,
    });
  }
  return { ok: true, attachments: out };
}

/**
 * v0.1b text-tier ingest. Builds the "Additional context" markdown block
 * that gets prepended to `input.summary` before the CLI runs. Returns an
 * empty string when there is nothing to inject (no attachments, none are
 * text-tier, or none carry inlineText) — callers can test for `.length > 0`
 * to decide whether to touch the input at all.
 *
 * Enforces the total-char cap across *all* text-tier `inlineText` entries
 * combined (not per-entry) so a caller can't split a 500k arc42 doc across
 * ten attachments and sneak past the guardrail.
 *
 * Diagram + structured tiers are intentionally ignored here. They're
 * accepted by the shape validator, carried past v0.1b as no-ops, and will
 * be wired up in later slices (vision pass, drawio/puml parsers).
 */
export function buildAdditionalContextBlock(
  attachments: Attachment[] | undefined,
): { ok: true; block: string } | { ok: false; message: string } {
  if (!attachments || attachments.length === 0) return { ok: true, block: "" };
  let totalChars = 0;
  const parts: string[] = [];
  for (const a of attachments) {
    if (a.tier !== "text") continue;
    if (typeof a.inlineText !== "string" || a.inlineText.length === 0) continue;
    totalChars += a.inlineText.length;
    if (totalChars > ATTACHMENTS_MAX_TOTAL_CHARS) {
      return {
        ok: false,
        message: `attachments exceed the ${ATTACHMENTS_MAX_TOTAL_CHARS}-char total cap for text-tier inlineText; split or resample`,
      };
    }
    // Use the per-attachment format the v0.1b spec agreed on. `---` is a
    // markdown thematic break, which renders cleanly both in the raw
    // prompt the CLI sees and in any downstream markdown-rendered view.
    parts.push(`## Additional context from attachment: ${a.name}\n\n${a.inlineText}\n\n---`);
  }
  return { ok: true, block: parts.join("\n\n") };
}

/**
 * Prepend the additional-context block onto `input.summary` (or seed
 * summary with the block if the caller didn't supply one). Returns the
 * same `input` reference when there's nothing to inject, so the hot path
 * for callers without attachments stays allocation-free.
 *
 * Why mutate summary rather than adding a new input field (e.g.
 * `input.additionalContext`):
 *   - `summary` already flows into every relevant CLI prompt template
 *     slot (`clarify-prompt-template.md:{{summary}}`, architecture prompt,
 *     heuristic text-matchers at bootstrap-plan.js:1470).
 *   - Adding a new input field would require touching the CLI's 4k-line
 *     script AND every downstream template, inverting the v0.1a
 *     "service layer owns attachment→input translation" commitment.
 *   - Copy-on-write (spread into a new object) — never mutates the
 *     caller's object.
 */
export function augmentInputWithContext(input: unknown, contextBlock: string): unknown {
  if (contextBlock.length === 0) return input;
  if (!input || typeof input !== "object") {
    // Defensive fallback: if `input` isn't an object, we have no summary
    // to prepend onto. Return a synthetic wrapper so the CLI still sees
    // the attachment text; the CLI's input validator will surface any
    // remaining shape problems with its usual error message.
    return { summary: contextBlock };
  }
  const rec = input as Record<string, unknown>;
  const originalSummary = typeof rec.summary === "string" ? rec.summary : "";
  const combined =
    originalSummary.length > 0 ? `${contextBlock}\n\n${originalSummary}` : contextBlock;
  return { ...rec, summary: combined };
}

/**
 * Constant-time bearer compare. Short-circuit `!==` on a shared service
 * token is a well-known timing oracle; `timingSafeEqual` requires same-
 * length buffers, so pre-check length and substitute a same-length dummy
 * on mismatch to keep the compare itself constant-time.
 */
function bearerMatches(presented: string): boolean {
  const expected = env.PLANFORGE_SERVICE_TOKEN;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Throw-away same-length compare so mismatched-length inputs still
    // spend the same amount of time in this function.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

// Unauth healthcheck — used by Traefik + the ops dashboard. Intentionally
// mounted at the root so Traefik's internal router can hit it without
// threading a token. Returns flat JSON to match agent-relay's shape.
app.get("/healthz", (c) =>
  c.json({
    status: "ok",
    service: "agent-planforge",
    uptime: process.uptime(),
    // Surface the SCAFFOLDKIT_PYTHON probe so the ops dashboard can flag a
    // misconfigured deployment without having to inspect logs. "missing"
    // does not flip `status` to non-ok — the service still answers /generate
    // requests, scaffolding just silently skips. Treat this as a deployment-
    // health indicator rather than a liveness signal.
    scaffoldkitPython: getScaffoldkitStatus(),
  }),
);

// Everything under /api requires a Bearer token matching PLANFORGE_SERVICE_TOKEN.
// No scope system here — this is an internal service token with a single role:
// "authorised client of planforge". Access-control lives one level up
// (project-forge's session auth, or whatever calls the service).
const api = new Hono();
api.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    // No token presented at all — authentication stage failure.
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!bearerMatches(auth.slice(7))) {
    // Token presented but doesn't match — authorization failure. The
    // 401/403 split mirrors the ticket's acceptance criteria ("401
    // without Bearer, 403 with wrong Bearer") and lets a caller log or
    // alert on the "credentials attempted and rejected" case distinctly
    // from "no credentials sent".
    return c.json({ error: "forbidden" }, 403);
  }
  return next();
});

// POST /api/generate — runs the planforge CLI in an isolated tempdir and
// streams progress via SSE. Response content-type is text/event-stream.
//
// Request body: { input: <planning-input>, scaffold?: boolean }
//   - `scaffold` (default true): after the CLI writes scaffoldkit-input.json,
//     invoke scaffoldkit against the outdir so the `done` tarball contains
//     scaffolded project files. Set `false` for planning-only runs.
//
// Events emitted:
//   - `progress` — { requestId, stream: "stdout"|"stderr", line }
//   - `done`     — { requestId, planOutput, scaffoldkitInput | null,
//                     scaffoldkit: { invoked, exitCode?, stderr?, skipped? },
//                     outputTarGz, exitCode: 0 }
//   - `error`    — { requestId, message, exitCode? }
//
// The CLI's stdout lines are the authoritative progress feed today; when the
// CLI learns structured events later, the `line` payload can evolve to
// structured objects without breaking this contract.
api.post("/generate", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "Body must be JSON" }, 400);
  }
  if (!body || typeof body !== "object" || !("input" in body)) {
    return c.json(
      {
        error: "bad_request",
        message: "Body must be { input: <planning-input>, scaffold?: boolean, attachments?: Attachment[] }",
      },
      400,
    );
  }

  // Intentionally do NOT log `body` — it may carry user-supplied values that
  // become secrets downstream. Only the request id + timing + outcome are
  // log-worthy. See ADR-0002 § "Secret handling".
  const input = (body as { input: unknown }).input;
  // Default scaffold=true. An explicit `false` opts out; any other value
  // (including omission) preserves back-compat by scaffolding on.
  const scaffold = (body as { scaffold?: unknown }).scaffold !== false;

  // Attachments contract: shape-validate at the edge, then — for text-tier
  // entries with inlineText — prepend the content as an "Additional context"
  // block onto `input.summary` before writing input.json. The field itself
  // stays top-level on the request body and is NOT forwarded into the CLI's
  // input.json, so the CLI schema stays stable across attachment slices
  // (matches how `scaffold` sits). Diagram + structured tiers are shape-
  // validated but remain no-ops at the prompt level until later slices.
  const attachmentsParsed = parseAttachments((body as { attachments?: unknown }).attachments);
  if (!attachmentsParsed.ok) {
    return c.json({ error: "bad_request", message: attachmentsParsed.message }, 400);
  }
  const contextBuild = buildAdditionalContextBlock(attachmentsParsed.attachments);
  if (!contextBuild.ok) {
    return c.json({ error: "attachments_too_large", message: contextBuild.message }, 400);
  }
  const augmentedInput = augmentInputWithContext(input, contextBuild.block);

  // Wire the HTTP client's AbortSignal through to the CLI subprocess so a
  // mid-stream disconnect doesn't leave an orphan node process + tempdir
  // on the server. Without this, a dropped client keeps the generator
  // alive until the child exits on its own — fine for 4k-line CLI runs
  // that take a few seconds, but a real resource leak once the CLI learns
  // to take minutes (planned).
  const controller = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => controller.abort(), { once: true });

  return streamSSE(c, async (stream) => {
    let requestId: string | undefined;
    try {
      for await (const ev of runGenerate(augmentedInput, {
        planforgeRoot: env.PLANFORGE_ROOT,
        nodeBin: env.NODE_BIN,
        scaffoldkitPython: env.SCAFFOLDKIT_PYTHON,
        scaffold,
        abortSignal: controller.signal,
      })) {
        requestId = ev.requestId;
        await stream.writeSSE({
          event: ev.type,
          data: JSON.stringify(ev),
        });
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        // Echo the requestId when we have one so callers can correlate
        // transport-level failures with the earlier `progress` frames.
        data: JSON.stringify({
          type: "error",
          requestId,
          message: (err as Error).message,
        }),
      });
    }
  });
});

app.route("/api", api);
