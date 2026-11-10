// ==========================================
// Configuration and constants (ports of Code.gs).
// Secrets and personal context come from environment variables (Vercel),
// NOT from this file, because the GitHub repository is public.
// ==========================================

export const SHEET = 'Transactions';
export const RULES_TAB = 'Rules';
export const STAGE_TAB = 'Staging';

export const REVIEW = 'NEEDS REVIEW';
export const PENDING = 'PENDING';
export const CONFIRMED = 'CONFIRMED';
export const SBI_ACCOUNT = 'Mother SBI current';

export const HEADERS = ['Logged At', 'Date', 'Direction', 'Amount', 'Counterparty', 'Ref', 'Source',
  'Account', 'Status', 'Bucket', 'Category', 'Property', 'Notes', 'Suggested Bucket',
  'Suggested Category', 'Suggested Property', 'AI Confidence', 'AI Source', 'Accept'];
export const RULE_HEADERS = ['Counterparty', 'Bucket', 'Category', 'Property', 'Trusted'];
export const STAGE_HEADERS = ['Batch', 'Stamp', 'Direction', 'Amount', 'Counterparty', 'Ref', 'Account', 'Source'];

export const NCOL = HEADERS.length;       // 19
export const STAGE_NCOL = STAGE_HEADERS.length; // 8

export const ALLOWED_BUCKETS = ['Business', 'Personal', 'Internal', 'Deposit'];
export const ALLOWED_CATEGORIES = ['Electricity', 'Plumbing', 'Repairs', 'Groceries', 'Rent', 'Staff',
  'Chai and snacks', 'Cigarettes', 'Fuel', 'Medicine', 'Food out', 'Family support',
  'Self transfer', 'Deposit refund', 'Tenant rent', 'Reimbursement', 'Other'];

export const NON_TXN_PATTERNS = [/\bOTP\b/i, /one[- ]time/i, /don'?t share/i];

// Environment secrets. Absent => feature is disabled (a request is rejected or skipped).
export const SMS_KEY = process.env.SMS_KEY || '';
export const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
export const GOOGLE_SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT || '';
export const GEMINI_KEY = process.env.GEMINI_KEY || '';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
export const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || '';
export const TG_TOKEN = process.env.TG_TOKEN || '';
export const TG_CHAT = process.env.TG_CHAT || '';
export const OWNER_CONTEXT = process.env.OWNER_CONTEXT || '';

// The AI prompt is built on demand so OWNER_CONTEXT can change without a redeploy.
export function suggestPrompt() {
  return `You suggest categories for personal and PG finance transactions.
${OWNER_CONTEXT}
Each item has: id, counterparty, amount, direction, and the owner's notes.
Return ONLY a JSON object of the form {"items": [ ... ]}. Each element has:
"id" (same as input), "bucket" (one of: ${ALLOWED_BUCKETS.join(', ')}),
"category" (one of: ${ALLOWED_CATEGORIES.join(', ')}), "property" (unit number or empty string),
"confidence" ("high", "medium" or "unsure").
If unsure, set confidence to "unsure" and category to "Other". Never invent unit numbers.
Items:
`;
}
