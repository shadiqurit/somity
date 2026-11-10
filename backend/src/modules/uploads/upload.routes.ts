import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { canViewMember, requirePermission } from '../../middleware/auth.js';
import { savePhoto, removePhoto } from './upload.service.js';
import { storedFilePath } from '../../services/file-cleanup.js';
export const uploadRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 }, fileFilter: (_req, file, cb) => {
  if (!['image/jpeg', 'image/png'].includes(file.mimetype)) return cb(new AppError(422, 'Only JPG and PNG photos are supported'));
  cb(null, true);
} });
uploadRouter.post('/members/:id/photo', requirePermission('members.write'), upload.single('photo'), async (req, res) => {
  if (!req.file) throw new AppError(422, 'Select a photo');
  res.status(201).json(await savePhoto(String(req.params.id), req.file, req.user.id, req.societyId));
});
uploadRouter.delete('/members/:id/photo', requirePermission('members.write'), async (req, res) => {
  const input = z.object({ documentId: z.string().min(1).max(30) }).strict().parse(req.body);
  await removePhoto(String(req.params.id), input.documentId, req.user.id, req.societyId);
  res.status(204).end();
});
uploadRouter.get('/documents/:id', async (req, res) => {
  const doc = await db.memberDocument.findFirst({ where: { id: String(req.params.id), societyId: req.societyId }, include: { member: { select: { archivedAt: true } } } });
  if (!doc || doc.member.archivedAt) throw new AppError(404, 'Document not found');
  if (!canViewMember(req.user, doc.memberId)) throw new AppError(403, 'Document access denied');
  res.set({ 'Content-Type': doc.mimeType, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="member-photo.jpg"' });
  res.sendFile(storedFilePath(doc.storageKey), { dotfiles: 'allow' });
});
