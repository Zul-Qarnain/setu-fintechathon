/** /documents — port of backend/app/routes/documents.py. JSON {filename,text,synthetic} or multipart `file` (.txt only; PDF is out of scope). */
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import * as intake from '../agents/intake.js';
import { apiError, currentUser, rateLimit } from '../deps.js';
import { confirmDocument, docOut, ingest } from '../docService.js';
import { parse } from '../errors.js';
import { DocumentConfirm, DocumentCreate } from '../schemas.js';

export const documentRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ctx;
  await app.register(multipart, { limits: { fileSize: 2_000_000, files: 1 } });
  app.addHook('onRequest', async (req) => rateLimit(ctx, req));

  app.post('/', async (req, reply) => {
    const user = await currentUser(ctx, req);
    let text: string;
    let filename: string;
    let synthetic = true;
    if (req.isMultipart()) {
      let file;
      try {
        file = await req.file();
      } catch {
        throw apiError(413, 'TOO_LARGE', 'File too large');
      }
      if (!file) throw apiError(422, 'validation_error', "multipart field 'file' required");
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch {
        throw apiError(413, 'TOO_LARGE', 'File too large');
      }
      if (file.file.truncated) throw apiError(413, 'TOO_LARGE', 'File too large');
      filename = file.filename || 'upload.txt';
      try {
        text = intake.extractText(filename, data);
      } catch (e) {
        throw apiError(422, 'UNSUPPORTED_DOCUMENT', (e as Error).message);
      }
    } else {
      const body = parse(DocumentCreate, req.body ?? {});
      ({ text, filename, synthetic } = body);
    }
    return reply.status(201).send(docOut(ingest(ctx, user, filename, text, synthetic)));
  });

  app.post<{ Params: { id: string } }>('/:id/confirm', async (req) => {
    const user = await currentUser(ctx, req);
    return confirmDocument(ctx, user, req.params.id, parse(DocumentConfirm, req.body));
  });
};
