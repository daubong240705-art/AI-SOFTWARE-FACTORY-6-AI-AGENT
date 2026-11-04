import { nativeImage } from "electron";
import { imageImportSchema } from "../shared/images";
import { inspectImage, type Images } from "./storage/images";

export function importImage(store: Images, input: unknown) {
  const request = imageImportSchema.parse(input);
  if (/[^A-Za-z0-9+/=]/.test(request.base64))
    throw Error("Dữ liệu ảnh không hợp lệ.");
  store.scope(request.projectId, request.conversationId);
  const bytes = Buffer.from(request.base64, "base64");
  if (bytes.toString("base64") !== request.base64)
    throw Error("Dữ liệu ảnh không hợp lệ.");
  inspectImage(bytes);
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw Error("Không đọc được ảnh.");
  // Re-encode all input: no original EXIF, trailing files or executable SVG.
  const normalized = image.toPNG();
  return store.add(
    request.projectId,
    request.conversationId,
    request.name.replace(/\.(png|jpe?g)$/i, "") + ".png",
    normalized,
  );
}
