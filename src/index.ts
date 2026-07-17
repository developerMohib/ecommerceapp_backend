import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
const app = express();
app.use(cors());

{
  const name: string = "EcommerceApp Backend";
  console.log(`Starting ${name} hello...`);
}
