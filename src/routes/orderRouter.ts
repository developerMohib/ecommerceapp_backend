import { Router } from "express";
import { createStreamChannel, createVideoInvite, getOrderDetails, listOrders } from "../controllers/order.controller";

const router = Router()
router.get('/',listOrders)
router.get('/:id',getOrderDetails)
router.post("/:id/strem-channel",createStreamChannel)
router.post("/:id/video-invite",createVideoInvite)
export {router as orderRouter}