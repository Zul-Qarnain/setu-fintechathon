/** Planner contract: the model may emit ONLY ToolCall JSON from an allowlist, schema-validated. */

import { z } from 'zod';

export const INTENTS = ["pay_obligation", "quote_fx", "how_much_needed", "payee_change", "explain_fees", "unsafe_request", "unknown"] as const;
type Intent = typeof INTENTS[number];

// Tool argument schemas matching Python's extra=forbid
const GetObligationArgs = z.object({
  obligation_id: z.string().nullish(),
  document_id: z.string().nullish(),
  keyword: z.string().nullish(),
});

const ListDueArgs = z.object({
  by: z.string().nullish(), // ISO date
});

const FxQuoteArgs = z.object({
  amount_cny: z.string().nullish(),
  quote: z.literal('BDT').default('BDT'),
});

const ComputeCostsArgs = z.object({
  amount_cny: z.string(),
  channel: z.string().nullish(),
});

const BudgetArgs = z.object({}).passthrough();

const ProposePaymentArgs = z.object({
  obligation_id: z.string().nullish(),
  document_id: z.string().nullish(),
  amount_cny: z.string().nullish(),
  payee_account: z.string().nullish(),
  origin: z.enum(['user', 'document', 'message', 'model']).default('user'),
});

const ProposeVerifyPayeeArgs = z.object({
  name: z.string().nullish(),
  account_number: z.string().nullish(),
  payee_id: z.string().nullish(),
});

const DraftMessageArgs = z.object({
  to: z.literal('university').default('university'),
  purpose: z.literal('confirm_account'),
});

const ARG_MODELS: Record<string, z.ZodTypeAny> = {
  get_obligation: GetObligationArgs,
  list_obligations_due: ListDueArgs,
  fx_quote: FxQuoteArgs,
  compute_costs: ComputeCostsArgs,
  budget_summary: BudgetArgs,
  propose_payment: ProposePaymentArgs,
  propose_verify_payee: ProposeVerifyPayeeArgs,
  draft_message: DraftMessageArgs,
};

// The ONLY tools that may create actions are propose_*; none of them executes anything.
export const READ_TOOLS = new Set(["get_obligation", "list_obligations_due", "fx_quote", "compute_costs", "budget_summary"]);

const ToolCallSchema = z.object({
  tool: z.string(),
  args: z.record(z.any()).default({}),
});

const PlannerOutputSchema = z.object({
  intent: z.enum(INTENTS),
  tool_calls: z.array(ToolCallSchema).max(6),
});

export class PlanRejected extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    Object.setPrototypeOf(this, PlanRejected.prototype);
  }
}

export function validatePlan(raw: unknown): z.infer<typeof PlannerOutputSchema> {
  /** Validate model output: JSON schema, tool allowlist, per-tool arg schema. Raises PlanRejected. */
  try {
    const out = PlannerOutputSchema.parse(raw);
    for (const tc of out.tool_calls) {
      const model = ARG_MODELS[tc.tool];
      if (!model) {
        throw new PlanRejected(`tool not in allowlist: ${tc.tool}`);
      }
      try {
        model.parse(tc.args);
      } catch (e) {
        if (e instanceof z.ZodError) {
          throw new PlanRejected(`args for ${tc.tool}: ${e.errors()[0]?.msg || 'validation error'}`);
        }
        throw e;
      }
    }
    return out;
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new PlanRejected(`schema: ${e.errors()[0]?.msg || 'invalid structure'}`);
    }
    throw e;
  }
}

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
