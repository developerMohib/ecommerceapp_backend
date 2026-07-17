import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { clerkWebhookHandler } from "./webhooks/clerk";
import { getEnv } from "./lib/environment";

const app = express();
const envload = getEnv();
const rawJson = express.raw({ type: "application/json", limit: "1mb" });
app.post("/webhook/clerk", rawJson, (req, res) => {
  void clerkWebhookHandler(req, res);
});

app.use(express.json());
app.use(cors());
app.use(clerkMiddleware());

app.listen(envload.PORT, () =>
  console.log(`Listening port on ${envload.PORT}`),
);
