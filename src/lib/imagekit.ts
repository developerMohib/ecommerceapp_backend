import ImageKit, { NotFoundError } from "@imagekit/nodejs";
import { Environment } from "./environment";

export const deleteImageKitAsset = async (
  env: Environment,
  storeField: string | null,
) => {
  if (!storeField) return;
  const client = new ImageKit({ privateKey: env.IMAGEKIT_PRIVATE_KEY });
  try {
    await client.files.delete(storeField);
  } catch (error) {
    if (error instanceof NotFoundError) return;
    throw error;
  }
};
