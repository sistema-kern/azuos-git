import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  getStorageRoot(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR not set");
    return dir;
  }

  getTenantRoot(tenantId: number): string {
    return path.join(this.getStorageRoot(), `tenant-${tenantId}`);
  }

  async ensureTenantDir(tenantId: number): Promise<string> {
    const dir = this.getTenantRoot(tenantId);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, "uploads"), { recursive: true });
    await fs.mkdir(path.join(dir, "profile"), { recursive: true });
    await fs.mkdir(path.join(dir, "gallery"), { recursive: true });
    await fs.mkdir(path.join(dir, "home"), { recursive: true });
    await fs.mkdir(path.join(dir, "courts"), { recursive: true });
    await fs.mkdir(path.join(dir, "sponsors"), { recursive: true });
    await fs.mkdir(path.join(dir, "email-templates"), { recursive: true });
    await fs.mkdir(path.join(dir, "tournaments"), { recursive: true });
    return dir;
  }

  async saveTenantFile(params: {
    tenantId: number;
    folder: string;
    buffer: Buffer;
    originalName: string;
    contentType: string;
  }): Promise<{ objectPath: string; filePath: string; filename: string }> {
    const tenantRoot = await this.ensureTenantDir(params.tenantId);
    const ext = path.extname(params.originalName).toLowerCase() || ".bin";
    const filename = `${randomUUID()}${ext}`;
    const relative = path.join(`tenant-${params.tenantId}`, params.folder, filename);
    const filePath = path.join(tenantRoot, params.folder, filename);
    await fs.writeFile(filePath, params.buffer);
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType: params.contentType }, null, 2));
    return { objectPath: `/${relative.replace(/\\/g, "/")}`, filePath, filename };
  }

  async getObjectEntityFile(objectPath: string): Promise<string> {
    if (!objectPath.startsWith("/tenant-")) throw new ObjectNotFoundError();
    const full = path.join(this.getStorageRoot(), objectPath);
    try {
      await fs.access(full);
      return full;
    } catch {
      throw new ObjectNotFoundError();
    }
  }
}

export const objectStorageService = new ObjectStorageService();