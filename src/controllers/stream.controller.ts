import { NextFunction, Request, Response } from "express";
import { getEnv } from "../lib/environment";
import { getAuth } from "@clerk/express";
import { getLocalUser } from "../lib/users";
import {
  getStreamChatServer,
  streamChatDisplayName,
  streamUserId,
} from "../lib/stream";
import { clerkClient } from "@clerk/express";

const envload = getEnv();
export const createStreamToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId, isAuthenticated } = getAuth(req);
    if (!userId || !isAuthenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const localUser = await getLocalUser(userId);
    if (!localUser) {
      res
        .status(503)
        .json({ success: false, message: "Account not synced yet" });
      return;
    }
    const server = getStreamChatServer(envload);
    const clerkUser = await clerkClient.users.getUser(userId);
    const combined =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      null;
    const name = streamChatDisplayName(
      localUser.role,
      localUser.displayName ?? combined ?? clerkUser.username,
      localUser.email,
    );

    const image = clerkUser.imageUrl || undefined;
    const sid = streamUserId(userId);
    await server.upsertUser({ id: sid, name, image });
    const token = server.createToken(sid);
    res.status(200).json({
      success: true,
      message: "Stream token generated successfully",
      data: { token, apiKey: envload.STREAM_API_KEY, userId: sid },
    });
  } catch (error) {
    next(error);
  }
};
