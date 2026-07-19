import dotenv from "dotenv"
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
dotenv.config()

const dsn = process.env.SENTRY_DSN;
if(dsn){
Sentry.init({
  dsn: dsn,
  environment : process.env.NODE_ENV ?? "development",
  integrations: [nodeProfilingIntegration()], 
  enableLogs: true,
  tracesSampleRate : 1.0, 
  profileLifecycle: "trace", sendDefaultPii: true,
});
}
