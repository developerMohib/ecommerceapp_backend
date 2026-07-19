import { getAuth } from "@clerk/express";
import { RequestHandler } from "express";
import * as Sentry from "@sentry/node";

// attach clerk user id to the request isolation scope so errors include who was signed in
export const sentryClerkUserMiddleware: RequestHandler = (req, _res, next) => {
  const { userId } = getAuth(req);
  Sentry.getIsolationScope().setUser(userId ? { id: userId } : null);
  next();
};
