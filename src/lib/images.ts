import sharp from "sharp";

type ImageKind = "avatar" | "hint" | "background";

const MAX_EDGE: Record<ImageKind, number> = {
  avatar: 512,
  hint: 1280,
  background: 1920,
};

// Decode an uploaded image, strip metadata, fix EXIF rotation, cap its longest
// edge, and re-encode as WebP so stored assets stay small and load fast.
// Avatars are cropped square (`cover`); other kinds keep their aspect ratio.
export async function processImage(
  file: File,
  kind: ImageKind,
): Promise<{ buffer: Buffer; contentType: "image/webp"; extension: "webp" }> {
  const input = Buffer.from(await file.arrayBuffer());
  const edge = MAX_EDGE[kind];
  const buffer = await sharp(input)
    .rotate()
    .resize(edge, edge, {
      fit: kind === "avatar" ? "cover" : "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
  return { buffer, contentType: "image/webp", extension: "webp" };
}
