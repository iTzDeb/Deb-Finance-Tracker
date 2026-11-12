// Manual eval of the Telegram intent layer (generic fixtures).
//   DEEPSEEK_KEY=... node scripts/eval-bot.mjs
import { askJSON } from '../lib/llm.js';
import { intentPrompt } from '../lib/bot.js';
import { normalizeActions } from '../lib/actions.js';

const fixtures = [
  { text: 'All 13 rupee transactions are for snacks. Personal in nature.', want: { type: 'bulk', amount: 13, bucket: 'Personal', category: 'snack' } },
  { text: 'All REF123456 transactions are personal; category - investment', want: { type: 'bulk', ref: 'REF123456', bucket: 'Personal', category: 'invest' } },
  { text: 'All ORION TRADERS transactions are personal; category - loan repayment', want: { type: 'rule', payee: 'orion', bucket: 'Personal', category: 'loan' } },
  { text: 'Transfers to PAYEE A from Bank A or Bank B are internal transfers', want: { type: 'rule', payee: 'payee a', bucket: 'Internal' } },
  { text: 'ACME MART is personal snacks', want: { type: 'rule', payee: 'acme', bucket: 'Personal', category: 'snack' } },
  { text: 'Transactions from ACME MART', want: { type: 'transactions', payee: 'acme' } },
  { text: 'Any transactions from PAYEE B?', want: { type: 'transactions', payee: 'payee b' } },
  { text: 'PAYEE C 2600 is personal shopping. Add note - curtains, refunded. Hide this transaction from family view', want: { type: 'rule', payee: 'payee c', bucket: 'Personal', category: 'shop', note: 'curtain', hide: true } },
  { text: 'THE LANDLORD of unit 39: all money sent is business rent.', want: { type: 'rule', payee: 'landlord', bucket: 'Business', category: 'rent' } },
  { text: 'Hide PAYEE A and PAYEE B transactions', want: { type: 'hide', payee: 'payee a' } },
  { text: 'No no personal, not business. My salary', want: { bucket: 'Personal' }, history: ['PAYEE D credits are for Business / Staff'] },
  { text: 'PAYEE D credits are Personal, Teaching Payments', want: { type: 'rule', payee: 'payee d', bucket: 'Personal', category: 'teaching', direction: 'CREDIT' } }
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
    const data = (await askJSON(intentPrompt(f.text, null, [], f.history || []))).data;
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
