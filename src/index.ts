import express, { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import path from "node:path";
import fs from "node:fs";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { getEnv } from "./lib/environment";
import { keepAliveCronJob } from "./lib/cron";
import { meRouter } from "./routes/meRouter";
import { productRouter } from "./routes/productRouter";
import { streamRouter } from "./routes/streamRouter";
import { checkoutRouter } from "./routes/checkoutRouter";
import { polarWebhookHandler } from "./webhooks/polar";
import { sentryClerkUserMiddleware } from "./middleware/sentryClerkUser";
import { adminRouter } from "./routes/adminRouter";

const app = express();
const envload = getEnv();

// 1. Webhook route FIRST — must use raw body for signature verification.
//    This must come before express.json() and clerkMiddleware().
const rawjson = express.raw({ type: "application/json", limit: "1mb" });
app.post("/webhook/clerk", rawjson, (req, res) => {
  void clerkWebhookHandler(req, res);
});
app.post("/webhook/polar", rawjson, (req, res) => {
  void polarWebhookHandler(req, res);
});

// 2. Global middleware — applies to everything registered AFTER this point.
app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());
app.use(sentryClerkUserMiddleware)

// 3. Health check and run server with cron job
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.get("/check", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopora App is running",
  });
});

// my api
app.use("/api/me", meRouter);
app.use("/api/product", productRouter);
app.use("/api/stream", streamRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/admin", adminRouter);

// 4. Static frontend + SPA fallback
const publicDir = path.join(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));

  app.get("/{*splat}", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}
Sentry.setupExpressErrorHandler(app);

// 5. Global error handler — catches anything thrown/passed via next(err)
app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const sentryId = (res as express.Response & { sentry?: string }).sentry;
  res.status(500).json({ success: false,error: "Internal Server error", ...(sentryId !== undefined && {sentryId} ) });
});

app.listen(envload.PORT, () => {
  console.log(`Listening on port ${envload.PORT}`);
  if (envload.NODE_ENV === "production") {
    keepAliveCronJob.start();
  }
});
