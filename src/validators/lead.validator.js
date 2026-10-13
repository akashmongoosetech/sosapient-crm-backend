const { z } = require('zod');
const { LEAD_STATUSES } = require('../models/Lead');

const websiteSchema = z.string().trim().max(2048).optional().default('')
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v.includes('://') ? v : `https://${v}`);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch { return false; }
  }, 'Enter a valid website URL');

const phoneSchema = z.string().trim().max(40).optional().default('');

const leadCreateSchema = z.object({
  title: z.string().trim().min(1, 'Name is required').max(200, 'Name is too long'),
  categoryName: z.string().trim().max(200).optional().default(''),
  address: z.string().trim().max(1000).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  state: z.string().trim().max(120).optional().default(''),
  website: websiteSchema,
  phone: phoneSchema,
  phoneUnformatted: phoneSchema,
  status: z.enum(LEAD_STATUSES).optional().default('New'),
  placeId: z.string().trim().max(300).optional().default(''),
}).passthrough(); // unknown keys preserved into `source` (see splitRecord), never applied as DB fields

// PUT: core fields only. `source` is never client-writable — edits preserve it.
const leadUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Name is required').max(200).optional(),
  categoryName: z.string().trim().max(200).optional(),
  address: z.string().trim().max(1000).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  website: websiteSchema.optional(),
  phone: phoneSchema.optional(),
  phoneUnformatted: phoneSchema.optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  placeId: z.string().trim().max(300).optional(),
}).strict();

const CONTACT_OPTIONS = ['all', 'phone', 'website', 'both', 'neither', 'mobileOnly', 'websiteOnly'];

const leadQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  category: z.string().trim().max(200).optional().default(''),
  city: z.string().trim().max(120).optional().default(''),
  status: z.string().trim().optional().default(''),
  contact: z.enum(CONTACT_OPTIONS).optional().default('all'),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// Import payload: array of arbitrary records (validated structurally here,
// matched in the import service). Cap keeps payloads within the JSON limit.
const importSchema = z.object({
  records: z.array(z.record(z.any()).refine((r) => r && typeof r === 'object' && !Array.isArray(r), 'Each record must be an object')).min(1, 'At least one record is required').max(5000, 'Maximum 5000 records per import'),
}).strict();

module.exports = { leadCreateSchema, leadUpdateSchema, leadQuerySchema, importSchema, CONTACT_OPTIONS, LEAD_STATUSES };
