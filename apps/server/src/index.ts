import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { compress } from "hono/compress";
import recordingsRouter from "./routes/recordings";
import chunksRouter from "./routes/chunks";

const app = new Hono();

// Performance optimizations
app.use(compress()); // Gzip compression for responses
app.use(logger()); // Keep minimal logging
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400, // Cache CORS preflight for 24 hours
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

// Mount routers
app.route("/api/recordings", recordingsRouter);
app.route("/api/chunks", chunksRouter);

export default app;
