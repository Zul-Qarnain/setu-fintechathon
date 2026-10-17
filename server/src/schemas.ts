/** Request schemas (zod). Mirrors backend/app/schemas.py request models; extra fields ignored like pydantic's default. */
import { z } from 'zod';

export const Role = z.enum(['student', 'family_approver', 'admin']);

export const RegisterRequest = z.object({
  email: z.string(),
  password: z.string().min(10),
  role: Role.default('student'),
  locale: z.enum(['en', 'zh-CN']).default('en'),
  approver_email: z.string().nullish(),
});
export const LoginRequest = z.object({ email: z.string(), password: z.string() });
export const TotpVerifyRequest = z.object({ code: z.string().length(6) });
export const PayeeCreate = z.object({
  name: z.string().min(1).max(200),
  account_number: z.string().min(4).max(64),
  bank: z.string().min(1).max(200),
  source: z.enum(['manual', 'document', 'sms']).default('manual'),
});
