import { Router } from "express";
import { getMe } from "../controllers/user.controller";

const router = Router();
router.get("/", getMe)
export { router as meRouter };
