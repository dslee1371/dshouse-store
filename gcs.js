// gcs.js (lazy init 버전)
import { Storage } from '@google-cloud/storage';
import { extname } from 'node:path';
import crypto from 'node:crypto';
import mime from 'mime';

let _storage = null, _bucket = null, _publicBase = '', _useSigned = false;

function ensureBucket() {
  if (_bucket) return _bucket;
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) {
    throw new Error('GCS not configured: set GCS_BUCKET (and GCS_PUBLIC_BASE/GCS_SIGNED_URLS)');
  }
  _storage = new Storage();
  _bucket = _storage.bucket(bucketName);
  _publicBase = process.env.GCS_PUBLIC_BASE || `https://storage.googleapis.com/${bucketName}`;
  _useSigned  = String(process.env.GCS_SIGNED_URLS || 'false') === 'true';
  return _bucket;
}

export function buildObjectName({ prefix='products', productId, originalName='' }) {
  const ext = extname(originalName).toLowerCase();
  const key = crypto.randomBytes(6).toString('hex');
  return `${prefix}/${productId}/${Date.now()}-${key}${ext}`.replace(/\/+/g,'/');
}

export async function uploadBuffer({ buffer, contentType, objectName }) {
  const bucket = ensureBucket(); // ❗️이 시점에 환경변수 없으면 에러
  const ct = contentType || mime.getType(objectName) || 'application/octet-stream';
  const file = bucket.file(objectName);

  await file.save(buffer, {
    contentType: ct,
    resumable: false,
    public: !_useSigned,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' }
  });

  if (_useSigned) {
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000*60*60*24*365
    });
    return { url, objectName };
  }
  return { url: `${_publicBase}/${encodeURI(objectName)}`, objectName };
}

export async function deleteObject(objectName) {
  const bucket = ensureBucket();
  if (!objectName) return;
  await bucket.file(objectName).delete({ ignoreNotFound: true });
}

export function urlToObjectName(url='') {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname.replace(/^\/+/, ''));
  } catch { return ''; }
}
