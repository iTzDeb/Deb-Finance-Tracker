// Manual eval of the Telegram intent layer (fixtures from the owner's real messages).
//   DEEPSEEK_KEY=... node scripts/eval-bot.mjs
// The live model is only called when the key is set; fixtures load otherwise.
import { askJSON } from '../lib/llm.js';
import { intentPrompt } from '../lib/bot.js';
import { normalizeActions } from '../lib/actions.js';

const fixtures = [
  { text: 'All 13 rupees transactions are for cigarettes. Personal in nature.', want: { type: 'bulk', amount: 13, bucket: 'Personal', category: 'cig' } },
  { text: 'All 500312789665/112026 transactions are personal; category - investment', want: { type: 'bulk', ref: '500312', bucket: 'Personal', category: 'invest' } },
  { text: 'All NAKUL AGARWAL transactions are personal; category - loan repayment', want: { type: 'rule', payee: 'nakul', bucket: 'Personal', category: 'loan' } },
  { text: 'Transfers to KAKOLI SAHA from Kotak or BOI are internal transfers from my account to business current account', want: { type: 'rule', payee: 'kakoli', bucket: 'Internal' } },
  { text: 'KSS Mart is personal cigarettes', want: { type: 'rule', payee: 'kss', bucket: 'Personal', category: 'cig' } },
  { text: 'Transactions from KSS MART', want: { type: 'transactions', payee: 'kss' } },
  { text: 'Any transactions from Adarsh Kumar?', want: { type: 'transactions', payee: 'adarsh' } },
  { text: 'Rohit Agarwal 2600 is personal shopping. Add note - Shalini aunty curtains, refunded by her. Hide this transaction from family view', want: { type: 'rule', payee: 'rohit', bucket: 'Personal', category: 'shop', note: 'curtain', hide: true } },
  { text: 'Ekta Khanna is the landlord of unit 39. All money sent to her is for business and for rent.', want: { type: 'rule', payee: 'ekta', bucket: 'Business', category: 'rent' } },
  { text: 'Hide shalini ghosh and anandita transactions', want: { type: 'hide', payee: 'shalini' } },
  { text: 'No no personal, not business. My salary', want: { bucket: 'Personal' } },
  { text: 'Ravindra Institute credits are Personal, Teaching Payments', want: { type: 'rule', payee: 'ravindra', bucket: 'Personal', category: 'teaching', direction: 'CREDIT' } }
];

const matches = (want, got) => (want instanceof RegExp ? want.test(got) : String(got || '').toLowerCase().includes(String(want).toLowerCase()));

if (!process.env.DEEPSEEK_KEY) {
  console.log('DEEPSEEK_KEY is not set; fixtures loaded (' + fixtures.length + ') but not run.');
  process.exit(0);
}

let pass = 0;
for (const f of fixtures) {
  let got = {};
  try {
    const data = (await askJSON(intentPrompt(f.text, null, [], []))).data;
    got = normalizeActions(data)[0] || {};
  } catch (err) { got = { error: err.message }; }
  const w = f.want;
  const ok = (!w.type || got.type === w.type)
    && (!w.amount || Number(got.match_amount) === w.amount)
    && (!w.ref || matches(w.ref, got.match_ref) || matches(w.ref, got.payee))
    && (!w.payee || matches(w.payee, got.payee) || matches(w.payee, (got.payees || []).join(' ')))
    && (!w.bucket || got.bucket === w.bucket)
    && (!w.category || matches(w.category, got.category))
    && (!w.direction || String(got.direction || '').toUpperCase() === w.direction)
    && (!w.note || matches(w.note, got.note))
    && (w.hide === undefined || !!got.hide === w.hide);
  if (ok) pass++;
  console.log((ok ? 'PASS ' : 'FAIL ') + f.text.slice(0, 70) + (ok ? '' : '  got=' + JSON.stringify(got).slice(0, 180)));
}
console.log('\n' + pass + '/' + fixtures.length + ' passed');
