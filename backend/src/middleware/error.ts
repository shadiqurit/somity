import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return _next(error);
  if (error instanceof ZodError) { res.status(422).json({ error: { message: 'Please check the form fields', fields: error.flatten().fieldErrors } }); return; }
  if (error instanceof AppError) { res.status(error.status).json({ error: { message: error.message } }); return; }
  if (error instanceof multer.MulterError) { res.status(422).json({ error: { message: error.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 5 MB or smaller' : 'Invalid upload' } }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') { res.status(409).json({ error: { message: 'That email or member number is already in use' } }); return; }
    if (error.code === 'P2025') { res.status(404).json({ error: { message: 'Record not found' } }); return; }
    if (error.code === 'P2034') { res.status(409).json({ error: { message: 'Another request changed this record. Please retry' } }); return; }
  }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: { message: 'Invalid JSON body' } }); return; }
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: { message: 'Request body is too large' } }); return; }
  console.error(JSON.stringify({ requestId: req.get('x-request-id'), path: req.path, error: error instanceof Error ? error.message : 'Unknown error' }));
  res.status(500).json({ error: { message: 'Something went wrong. Please try again' } });
};
