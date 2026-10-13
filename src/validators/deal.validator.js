const { z } = require('zod');

const entryCreateSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(5000, 'Description is too long'),
  entryDate: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date' }) })
    .refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date'),
}).strict();

// JSON update: description/date + explicit keep-list for attachments.
// Files arrive via multipart on create; on update, retained files are named.
const entryUpdateSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(5000).optional(),
  entryDate: z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date' }) }).optional(),
  keepAttachments: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
}).strict();

const dealQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

module.exports = { entryCreateSchema, entryUpdateSchema, dealQuerySchema, historyQuerySchema };
