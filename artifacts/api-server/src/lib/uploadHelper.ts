import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { objectStorageService } from "./objectStorage.js";

export async function uploadBufferToLocal(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  tenantId: number,
  folder: string,
): Promise<string> {
  const { objectPath } = await objectStorageService.saveTenantFile({
    tenantId,
    folder,
    buffer,
    originalName,
    contentType,
  });
  return objectPath;
}

export async function saveTenantUpload(
  tenantId: number,
  folder: string,
  buffer: Buffer,
  originalName: string,
  contentType: string,
): Promise<{ objectPath: string; filename: string }> {
  const ext = path.extname(originalName).toLowerCase() || ".bin";
  const filename = `${randomUUID()}${ext}`;
  const root = objectStorageService.getTenantRoot(tenantId);
  const dir = path.join(root, folder);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }, null, 2));
  return { objectPath: `/tenant-${tenantId}/${folder}/${filename}`, filename };
}