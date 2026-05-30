import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ─── ImapFlow crash guard ────────────────────────────────────────────────────
// ImapFlow's async generator cleanup (for the `for await...of client.list()`
// iterator) calls client.close() after our try/catch has already exited.
// That close() throws "Connection not available" (code: 'NoConnection') from
// within processTicksAndRejections — outside any try/catch boundary.
// This is a known ImapFlow bug; the only reliable fix is to swallow this
// specific error at the process level. All other errors still crash the process.
process.on("uncaughtException", (err: unknown) => {
  if ((err as any)?.code === "NoConnection") return;
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  if ((reason as any)?.code === "NoConnection") return;
  logger.error({ err: reason }, "Unhandled rejection");
  process.exit(1);
});
// ────────────────────────────────────────────────────────────────────────────

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
