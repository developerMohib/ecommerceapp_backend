import { Router } from "express";
import {
  getCategoriesProducts,
  getProductsBySlug,
  listProducts,
} from "../controllers/products.controller";

const router = Router();
router.get("/", listProducts);
router.get("/categories", getCategoriesProducts);
router.get("/:slug", getProductsBySlug);
export { router as productRouter };
