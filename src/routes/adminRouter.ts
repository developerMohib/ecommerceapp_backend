import { Router } from "express";
import {
  createAdminProduct,
  deleteAdminProduct,
  getImageKitAuth,
  listAdminProducts,
  requiredAdmin,
  updateAdminProduct,
} from "../controllers/admin.controller";

const router = Router();
router.use(requiredAdmin);

router.get("/imagekit/auth", getImageKitAuth);
router.get("/products", listAdminProducts);
router.post("/product", createAdminProduct);
router.patch("/product/:id", updateAdminProduct);
router.delete("/product/:id", deleteAdminProduct);

export { router as adminRouter };
