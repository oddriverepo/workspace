import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { GridFSBucket } from "mongodb";
import { env } from "../config.js";
import { getDb, getStorageFileMetadata, openStorageFileStream } from "../../services/mongo.js";

const router = Router();
const STORAGE_COLLECTION = "storage_files";
const FLOW_STUDIO_SOURCE = "od-flow-studio";
const PUBLIC_MEDIA_PREFIX = "disparador/media/";
const PUBLIC_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

let mediaBucket = null;
async function getBucket() {
  const db = await getDb();
  if (!mediaBucket) mediaBucket = new GridFSBucket(db, { bucketName: "media" });
  return mediaBucket;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    const err = new Error("Tipo de arquivo nao permitido. Use JPEG, PNG, WebP ou GIF.");
    err.code = "INVALID_FILE_TYPE";
    err.status = 400;
    cb(err);
  },
});

function normalizeOptionalField(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function isPublicDisparadorMedia(file = {}) {
  const source = String(file.source || file.uploaderType || file.metadata?.source || "").trim();
  const filePath = String(file.path || file.filename || file.metadata?.path || "").trim();
  const mimeType = String(file.mimeType || file.contentType || file.metadata?.mimeType || "").trim().toLowerCase();
  return source === FLOW_STUDIO_SOURCE
    && filePath.startsWith(PUBLIC_MEDIA_PREFIX)
    && PUBLIC_MEDIA_TYPES.has(mimeType);
}

// ── POST /media/upload — authenticated (behind authenticateAdmin) ──
router.post("/media/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: { code: "NO_FILE", message: "Nenhuma imagem enviada." } });
    }

  const { buffer, mimetype, originalname } = req.file;
  const templateId = normalizeOptionalField(req.body?.templateId);
  const templateName = normalizeOptionalField(req.body?.templateName);
  const flowId = normalizeOptionalField(req.body?.flowId);
    const ext = (mimetype.split("/")[1] || "jpg").toLowerCase();
    const fileId = randomUUID();
    const fileName = `flow-media-${fileId}.${ext}`;
    const objectPath = `disparador/media/${fileName}`;

    const bucket = await getBucket();
    const uploadStream = bucket.openUploadStream(objectPath, {
      contentType: mimetype,
      metadata: {
        source: FLOW_STUDIO_SOURCE,
        uploaderType: FLOW_STUDIO_SOURCE,
        originalName: originalname || fileName,
        templateId,
        templateName,
        flowId,
      },
    });

    await new Promise((resolve, reject) => {
      uploadStream.once("finish", resolve);
      uploadStream.once("error", reject);
      uploadStream.end(buffer);
    });

    const gridFsId = uploadStream.id;
    const database = await getDb();
    const storageDoc = {
      _id: gridFsId,
      source: FLOW_STUDIO_SOURCE,
      uploaderType: FLOW_STUDIO_SOURCE,
      templateId,
      templateName,
      flowId,
      path: objectPath,
      fileName,
      originalName: originalname || fileName,
      mimeType: mimetype,
      size: buffer.length,
      url: `/api/disparador/media/${gridFsId.toString()}`,
      createdAt: new Date(),
    };
    await database.collection(STORAGE_COLLECTION).insertOne(storageDoc);

    return res.json({
      ok: true,
      file: {
        id: gridFsId.toString(),
        url: storageDoc.url,
        fileName,
        mimeType: mimetype,
        size: buffer.length,
      },
    });
  } catch (err) {
    console.error("[MEDIA_UPLOAD] Error:", err?.message || err);
    if (err.code === "INVALID_FILE_TYPE") {
      return res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
    }
    return res.status(500).json({ ok: false, error: { code: "UPLOAD_FAILED", message: "Falha ao fazer upload da imagem." } });
  }
});

// ── Public router (no auth) — serves media so Meta WhatsApp API can fetch ──
const publicMediaRouter = Router();

publicMediaRouter.get("/media/:id", async (req, res) => {
  try {
    const file = await getStorageFileMetadata(req.params.id);
    if (!file) {
      return res.status(404).json({ ok: false, error: "Arquivo nao encontrado." });
    }
    if (!isPublicDisparadorMedia(file)) {
      return res.status(404).json({ ok: false, error: "Arquivo nao encontrado." });
    }

    const stream = await openStorageFileStream(req.params.id);
    res.set("Content-Type", file.mimeType || "application/octet-stream");
    res.set("Cache-Control", "public, max-age=31536000, immutable");

    stream.on("error", (err) => {
      console.error("[MEDIA_SERVE] Stream error:", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Falha ao ler arquivo." });
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  } catch (err) {
    console.error("[MEDIA_SERVE] Error:", err?.message || err);
    res.status(400).json({ ok: false, error: "Arquivo invalido ou indisponivel." });
  }
});

export { router as mediaRouter, publicMediaRouter };
