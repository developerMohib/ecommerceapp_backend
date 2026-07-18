import { Router } from "express";
import { createStreamToken } from "../controllers/stream.controller";

const router = Router();
router.post("/token", createStreamToken)
export { router as streamRouter };