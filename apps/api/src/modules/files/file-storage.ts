import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageMime } from '../ai/ai.types';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

const EXTENSIONS: Readonly<Record<ImageMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Decides the image type from the file's own bytes. The type sent by the browser is never trusted,
 * because a hostile upload could claim to be a picture.
 */
export function detectImageType(data: Buffer): ImageMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export interface FileStorage {
  /** Saves a file under a key the storage chooses, and returns that key. */
  save(clinicId: string, data: Buffer, mime: ImageMime): Promise<string>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * Keeps files on local disk. On a host with temporary storage the files would disappear on restart,
 * so production must point UPLOAD_DIR at a persistent volume, or use an object storage adapter.
 */
export class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  async save(clinicId: string, data: Buffer, mime: ImageMime): Promise<string> {
    const key = `${clinicId}/${randomUUID()}.${EXTENSIONS[mime]}`;
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx' });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Only keys made by save() are accepted, which rules out paths that climb out of the folder. */
  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid file key.');
    return path.join(this.root, ...key.split('/'));
  }
}
