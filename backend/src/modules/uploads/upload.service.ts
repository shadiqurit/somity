import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { assertActiveSociety } from '../../services/tenant.js';
import { audit } from '../../services/audit.js';
import { storageRoot, storedFilePath, tryCleanupFiles } from '../../services/file-cleanup.js';
export { storageRoot } from '../../services/file-cleanup.js';
export async function savePhoto(memberId: string, file: Express.Multer.File, actorId: string, societyId: string) {
  let output: Buffer;
  try {
    const input = sharp(file.buffer, { limitInputPixels: 20_000_000, animated: false });
    const metadata = await input.metadata();
    if (!['jpeg', 'png'].includes(metadata.format ?? '')) throw new Error();
    output = await input.rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new AppError(422, 'Upload a valid JPG or PNG image (maximum 20 megapixels)'); }
  const key = `${randomUUID()}.jpg`;
  await mkdir(storageRoot, { recursive: true });
  await writeFile(storedFilePath(key), output, { flag: 'wx' });
  let result: { id: string; removedKeys: string[] };
  try {
    result = await db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
      // Touch/lock the member row so uploads, edits and archival serialize.
      const exists = await tx.member.updateMany({ where: { id: memberId, societyId, archivedAt: null }, data: { version: { increment: 1 } } });
      if (!exists.count) throw new AppError(404, 'Member not found');
      const previous = await tx.memberDocument.findMany({ where: { memberId, societyId, kind: 'PHOTO' } });
      if (previous.length) {
        await tx.fileDeletion.createMany({ data: previous.map(doc => ({ storageKey: doc.storageKey })), skipDuplicates: true });
        await tx.memberDocument.deleteMany({ where: { memberId, societyId, kind: 'PHOTO' } });
      }
      const doc = await tx.memberDocument.create({ data: { memberId, societyId, kind: 'PHOTO', storageKey: key, originalName: 'member-photo.jpg', mimeType: 'image/jpeg', sizeBytes: output.length } });
      await audit(tx, actorId, 'MEMBER_PHOTO_UPLOADED', 'member', memberId, { documentId: doc.id, replacedDocumentIds: previous.map(doc => doc.id) }, societyId);
      return { id: doc.id, removedKeys: previous.map(doc => doc.storageKey) };
    });
  } catch (error) { await unlink(storedFilePath(key)).catch(() => {}); throw error; }
  // Never remove old bytes until the replacement and audit record have committed.
  await tryCleanupFiles(result.removedKeys);
  return { id: result.id };
}

export async function removePhoto(memberId: string, documentId: string, actorId: string, societyId: string) {
  const removedKeys = await db.$transaction(async tx => {
    await assertActiveSociety(tx, societyId);
    const member = await tx.member.updateMany({ where: { id: memberId, societyId, archivedAt: null }, data: { version: { increment: 1 } } });
    if (!member.count) throw new AppError(404, 'Member not found');
    const photos = await tx.memberDocument.findMany({ where: { memberId, societyId, kind: 'PHOTO' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!photos.length) return []; // Retrying a completed removal is harmless.
    if (photos[0]!.id !== documentId) throw new AppError(409, 'This photo changed. Reload the profile before removing it');
    await tx.fileDeletion.createMany({ data: photos.map(doc => ({ storageKey: doc.storageKey })), skipDuplicates: true });
    await tx.memberDocument.deleteMany({ where: { memberId, societyId, kind: 'PHOTO' } });
    await audit(tx, actorId, 'MEMBER_PHOTO_REMOVED', 'member', memberId, { documentIds: photos.map(doc => doc.id) }, societyId);
    return photos.map(doc => doc.storageKey);
  });
  await tryCleanupFiles(removedKeys);
}
