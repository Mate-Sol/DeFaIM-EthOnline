/**
 * Upload helper. Two backends:
 *
 *   1. Azure Blob (production / staging) — used when `connectionString` is
 *      set. Lazy client init so module load doesn't fail when unconfigured.
 *
 *   2. Local filesystem fallback (dev / independent deploy) — when no
 *      `connectionString`. Writes under `server/public/<containerName>/<fileName>`,
 *      which the Express app already serves at `/public/...`. URLs that
 *      callers construct from `blobBaseUrl + containerName + path + fileName`
 *      keep working as long as `blobBaseUrl` is set to e.g.
 *      `http://localhost:5050/public`.
 *
 * Caller contract is unchanged:
 *   uploadBase64Attachment(containerName, fileName, base64Data, mimeType?)
 */
const { BlobServiceClient } = require("@azure/storage-blob");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");

let cachedAzureClient = null;
function getAzureClient() {
  if (cachedAzureClient) return cachedAzureClient;
  const connectionString = process.env.connectionString;
  if (!connectionString) return null;
  cachedAzureClient = BlobServiceClient.fromConnectionString(connectionString);
  return cachedAzureClient;
}

async function uploadToLocal(containerName, fileName, base64Data) {
  // Both `containerName` and `fileName` may contain slashes (callers
  // sometimes embed a path prefix in either, e.g. "uploads/agreements/foo.pdf").
  // Compute the full target path first, then mkdir its parent.
  const filePath = path.join(PUBLIC_DIR, containerName, fileName);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const buf = Buffer.from(base64Data, "base64");
  await fs.promises.writeFile(filePath, buf);
  console.log(`[fileUpload] local: wrote ${buf.length} bytes → ${filePath}`);
  return filePath;
}

async function uploadToAzure(containerName, fileName, base64Data) {
  const client = getAzureClient();
  const containerClient = client.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(fileName);
  const buf = Buffer.from(base64Data, "base64");
  const res = await blockBlobClient.upload(buf, buf.length);
  console.log(`[fileUpload] azure: status=${res._response.status}`);
}

async function uploadBase64Attachment(containerName, fileName, data /* mimeType ignored */) {
  if (process.env.connectionString) {
    return uploadToAzure(containerName, fileName, data);
  }
  return uploadToLocal(containerName, fileName, data);
}

module.exports = { uploadBase64Attachment };
