export type KnowledgeImageFile = {
  name: string;
  size: number;
  type: string;
  slice(start?: number, end?: number): Blob;
};

type KnowledgeImageFormat = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

export class KnowledgeImageValidationError extends Error {}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, index: number, value: string) {
  return value.split("").every((char, offset) => bytes[index + offset] === char.charCodeAt(0));
}

function formatFor(bytes: Uint8Array): KnowledgeImageFormat | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return { contentType: "image/png", extension: "png" };
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * Accepts the formats supported by Knowledge Base publishing and derives the
 * Storage MIME type and extension from bytes, never from a client filename.
 * The overall multipart budget remains Next's 20 MB Server Action limit.
 */
export async function validateKnowledgeImage(
  file: KnowledgeImageFile,
): Promise<KnowledgeImageFormat> {
  if (file.size <= 0) {
    throw new KnowledgeImageValidationError("Выберите непустой файл изображения.");
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const format = formatFor(bytes);
  if (!format) {
    throw new KnowledgeImageValidationError("Поддерживаются только изображения JPEG, PNG или WebP.");
  }
  if (file.type !== format.contentType) {
    throw new KnowledgeImageValidationError("Тип выбранного файла не совпадает с его содержимым.");
  }

  return format;
}
