import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import path from "node:path";
import fs from "node:fs";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { getEnv } from "./lib/environment";

const app = express();
const envload = getEnv();

// 1. Webhook route FIRST — must use raw body for signature verification.
//    This must come before express.json() and clerkMiddleware().
const rawjson = express.raw({ type: "application/json", limit: "1mb" });
app.post("/webhook/clerk", rawjson, (req, res) => {
  void clerkWebhookHandler(req, res);
});

// 2. Global middleware — applies to everything registered AFTER this point.
app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

// 3. Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shopora App is running",
  });
});

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

// 5. Global error handler — catches anything thrown/passed via next(err)
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    next: express.NextFunction,
  ) => {
    res.status(500).json({ success: false, message: "Internal server error" });
  },
);

app.listen(envload.PORT, () =>
  console.log(`Listening on port ${envload.PORT}`),
);
