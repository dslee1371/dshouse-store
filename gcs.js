// gcs.js
import { Storage } from '@google-cloud/storage';
import { extname } from 'node:path';
import crypto from 'node:crypto';
import mime from 'mime';

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET;
if (!bucketName) throw new Error('GCS_BUCKET env is required');

const bucket = storage.bucket(bucketName);
const PUBLIC_BASE = process.env.GCS_PUBLIC_BASE || `https://storage.googleapis.com/${bucketName}`;
const USE_SIGNED  = String(process.env.GCS_SIGNED_URLS || 'false') === 'true';

export function buildObjectName({ prefix='products', productId, originalName='' }) {
  const ext = extname(originalName).toLowerCase();
  const key = crypto.randomBytes(6).toString('hex');
  return `${prefix}/${productId}/${Date.now()}-${key}${ext}`.replace(/\/+/g,'/');
}

export async function uploadBuffer({ buffer, contentType, objectName }) {
  const ct = contentType || mime.getType(objectName) || 'application/octet-stream';
  const file = bucket.file(objectName);

  await file.save(buffer, {
    contentType: ct,
    resumable: false,
    public: !USE_SIGNED,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' }
  });

  if (USE_SIGNED) {
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 365 // 1년
    });
    return { url, objectName };
  }

  return { url: `${PUBLIC_BASE}/${encodeURI(objectName)}`, objectName };
}

export async function deleteObject(objectName) {
  if (!objectName) return;
  await bucket.file(objectName).delete({ ignoreNotFound: true });
}

export function urlToObjectName(url='') {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname.replace(/^\/+/, '')); // 도메인 뒤 경로를 objectName으로
  } catch { return ''; }
}
