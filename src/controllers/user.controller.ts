import { getAuth } from "@clerk/express";
import { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { getLocalUser } from "../lib/users";

export const getMe = async (
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
    const user = await getLocalUser(userId)
console.log(' row in controller', user)
    res
      .status(200)
      .json({ success: true, message: "User Retrvie Successfully", data: user });
  } catch (error) {
    next(error)
  }
};
