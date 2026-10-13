const { z } = require('zod');

// Password policy: min 10 chars, max 128, upper+lower+digit+symbol. No truncation.
const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol');

const nameSchema = (label) => z.string().trim().min(1, `${label} is required`).max(50, `${label} is too long`)
  .regex(/^[^\p{Cc}]+$/u, `${label} contains invalid characters`);

const profilePicSchema = z.string().trim().max(2048).optional().default('')
  .refine((v) => {
    if (!v) return true;
    const lower = v.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:')) return false;
    try { const u = new URL(v); return u.protocol === 'https:'; } catch { return false; }
  }, 'Profile picture must be a valid HTTPS URL');

const registerSchema = z.object({
  firstName: nameSchema('First name'),
  lastName: nameSchema('Last name'),
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254).email('Enter a valid email address'),
  mobileNumber: z.string().trim().min(4, 'Enter a valid phone number').max(20),
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_.]+$/, 'Username may contain letters, numbers, dots and underscores'),
  profilePicUrl: profilePicSchema,
  password: passwordSchema,
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
}).refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email, username, or mobile number').max(254),
  password: z.string().min(1, 'Password is required').max(128),
  rememberMe: z.boolean().optional().default(false),
});

const patchMeSchema = z.object({
  firstName: nameSchema('First name').optional(),
  lastName: nameSchema('Last name').optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254).optional(),
  profilePicUrl: profilePicSchema.optional(),
  mobileNumber: z.string().trim().min(4).max(20).optional(),
}).strict();

// Password change is a separate endpoint: current password must be proven.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: passwordSchema,
  confirmNewPassword: z.string().min(1, 'Confirm your new password'),
}).refine((d) => d.newPassword === d.confirmNewPassword, { path: ['confirmNewPassword'], message: 'Passwords do not match' });

const adminCreateSchema = z.object({
  firstName: nameSchema('First name'),
  lastName: nameSchema('Last name'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  mobileNumber: z.string().trim().min(4).max(20),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/),
  profilePicUrl: profilePicSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'manager']).default('manager'),
});

const adminPatchSchema = z.object({
  firstName: nameSchema('First name').optional(),
  lastName: nameSchema('Last name').optional(),
  profilePicUrl: profilePicSchema.optional(),
  mobileNumber: z.string().trim().min(4).max(20).optional(),
}).strict();

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Enter your registered email address').max(254).email('Enter a valid email address'),
}).strict();

const verifyResetOtpSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254).email('Enter a valid email address'),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
}).strict();

const resendResetOtpSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254).email('Enter a valid email address'),
}).strict();

const resetPasswordSchema = z.object({
  resetToken: z.string().min(10, 'Reset session expired — request a new code'),
  newPassword: passwordSchema,
  confirmNewPassword: z.string().min(1, 'Confirm your new password'),
}).refine((d) => d.newPassword === d.confirmNewPassword, { path: ['confirmNewPassword'], message: 'Passwords do not match' });

module.exports = { registerSchema, loginSchema, patchMeSchema, changePasswordSchema, adminCreateSchema, adminPatchSchema, passwordSchema, forgotPasswordSchema, verifyResetOtpSchema, resendResetOtpSchema, resetPasswordSchema };
