import { serve } from "@hono/node-server";
import { env } from "./config.js";
import { app } from "./routes.js";

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `agent-planforge HTTP service listening on port ${info.port} (planforge root: ${env.PLANFORGE_ROOT})`,
  );
});

// Graceful shutdown so in-flight SSE streams can drain and subprocess children
// don't get orphaned when the container is restarted.
const shutdown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}, shutting down...`);
  server.close((err) => {
    if (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
    process.exit(0);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
