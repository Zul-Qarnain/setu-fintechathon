/** Request schemas (zod). Extra fields are ignored (zod default strip). */
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

export const ApproveRequest = z.object({ totp_code: z.string().length(6) });
export const RejectRequest = z.object({ reason: z.string().default('') });
export const ChatRequest = z.object({
  message: z.string().min(1).max(4000),
  document_id: z.string().nullish(),
  locale: z.enum(['en', 'zh-CN']).default('en'),
});

export const DocumentCreate = z.object({
  filename: z.string().default('notice.txt'),
  text: z.string().max(20000),
  synthetic: z.boolean().default(true),
});
export const DocumentConfirm = z.object({
  amount_cny: z.union([z.string(), z.number()]).transform((v) => String(v)),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee_name: z.string(),
  account_number: z.string().nullish(),
  reference: z.string().nullish(),
});
