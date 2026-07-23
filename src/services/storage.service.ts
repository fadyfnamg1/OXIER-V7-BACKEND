import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";

const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    // Ignore the client-supplied original filename/extension entirely —
    // derive the extension from the verified mimetype instead, so a
    // malicious filename (e.g. "proof.php.png") can't smuggle through.
    const ext = ALLOWED_MIME_TO_EXT[file.mimetype] || ".bin";
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TO_EXT[file.mimetype]) cb(null, true);
    else cb(new Error("Invalid file type"));
  },
});

export function getFileUrl(filename: string): string {
  const baseUrl = process.env["BASE_URL"] || "";
  return `${baseUrl}/uploads/${filename}`;
}
