/** Planner contract: the model may emit ONLY ToolCall JSON from an allowlist, schema-validated (extra keys forbidden, like Python's extra="forbid"). Port of planner.py. */
import { z } from 'zod';

export const INTENTS = [
  'pay_obligation',
  'quote_fx',
  'how_much_needed',
  'payee_change',
  'explain_fees',
  'unsafe_request',
  'unknown',
] as const;

const s = z.string().nullish();
const ARG_MODELS: Record<string, z.ZodType> = {
  get_obligation: z.strictObject({ obligation_id: s, document_id: s, keyword: s }),
  list_obligations_due: z.strictObject({ by: s }),
  fx_quote: z.strictObject({ amount_cny: s, quote: z.string().default('BDT') }),
  compute_costs: z.strictObject({ amount_cny: z.string(), channel: s }),
  budget_summary: z.strictObject({}),
  propose_payment: z.strictObject({
    obligation_id: s,
    document_id: s,
    amount_cny: s,
    payee_account: s,
    origin: z.enum(['user', 'document', 'message', 'model']).default('user'),
  }),
  propose_verify_payee: z.strictObject({ name: s, account_number: s, payee_id: s }),
  draft_message: z.strictObject({
    to: z.enum(['university', 'family']).default('university'),
    purpose: z.enum(['confirm_account', 'request_extension']).default('confirm_account'),
  }),
};
/** The ONLY tools that may create actions are propose_*; none of them executes anything. */
export const READ_TOOLS = new Set([
  'get_obligation',
  'list_obligations_due',
  'fx_quote',
  'compute_costs',
  'budget_summary',
]);

const PlannerOutputSchema = z.strictObject({
  intent: z.enum(INTENTS),
  tool_calls: z
    .array(
      z.strictObject({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) })
    )
    .max(6)
    .default([]),
});
export type ToolCall = z.infer<typeof PlannerOutputSchema>['tool_calls'][number];
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export class PlanRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PlanRejected';
  }
}

/** Validate model output: JSON schema, tool allowlist, per-tool arg schema. Throws PlanRejected. */
export function validatePlan(raw: unknown): PlannerOutput {
  const p = PlannerOutputSchema.safeParse(raw);
  if (!p.success) throw new PlanRejected(`schema: ${p.error.issues[0]?.message ?? 'invalid'}`);
  for (const tc of p.data.tool_calls) {
    const model = ARG_MODELS[tc.tool];
    if (!model) throw new PlanRejected(`tool not in allowlist: ${tc.tool}`);
    const a = model.safeParse(tc.args);
    if (!a.success)
      throw new PlanRejected(`args for ${tc.tool}: ${a.error.issues[0]?.message ?? 'invalid'}`);
  }
  return p.data;
}
