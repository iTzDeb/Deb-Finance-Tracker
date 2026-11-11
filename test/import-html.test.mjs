import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The importer lives inline in import.html (no build step), so load the real
// script in a small sandbox and test the functions the page uses.
const html = readFileSync(new URL('../import.html', import.meta.url), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const sandbox = {
  console,
  document: { querySelector: () => ({ addEventListener() {}, innerHTML: '', textContent: '', value: '', style: {}, disabled: false }) },
  localStorage: { getItem: () => JSON.stringify({ url: 'x', key: 'y' }), setItem() {} },
  setTimeout, clearTimeout, URLSearchParams, AbortController,
  fetch: async () => ({ ok: true, json: async () => ({}) })
};
vm.createContext(sandbox);
vm.runInContext(inline, sandbox);

test('parseDate keeps a 4-digit year', () => {
  assert.equal(sandbox.parseDate('01-10-2026'), '2026-10-01');
  assert.equal(sandbox.parseDate('01/10/2026'), '2026-10-01');
  assert.equal(sandbox.parseDate('01-10-26'), '2026-10-01');
});

test('narrationParts extracts BOI UPI and NEFT payees', () => {
  const boi = sandbox.narrationParts('UPI/627498773714/DR/THANDI/YESB/q123/Sent u');
  assert.equal(boi.ref, '627498773714');
  assert.equal(boi.party, 'THANDI');
  const other = sandbox.narrationParts('UPI/DR/627498773714/THANDI/YESB');
  assert.equal(other.ref, '627498773714');
  assert.equal(other.party, 'THANDI');
  const neft = sandbox.narrationParts('NEFT/SBIN226275322203/SBIN/ITDTAX REFUND');
  assert.equal(neft.ref, 'SBIN226275322203');
  assert.equal(neft.party, 'ITDTAX REFUND');
});

test('narrationParts only takes a bare number as a ref', () => {
  assert.equal(sandbox.narrationParts('500312789665').ref, '500312789665');
  assert.equal(sandbox.narrationParts('500312789665/102026').ref, '');
});

test('narrationParts extracts Kotak and card payees', () => {
  const upi = sandbox.narrationParts('UPI/SHALINI GHOSH/UBIN/617985807272/Sent using P');
  assert.equal(upi.ref, '617985807272');
  assert.equal(upi.party, 'SHALINI GHOSH');
  const imps = sandbox.narrationParts('SentIMPS628600308833Kakoli Sah/SBINX2175/IMPS(Value Date: 13-10-2026)');
  assert.equal(imps.ref, '628600308833');
  assert.equal(imps.party, 'Kakoli Sah');
  const pci = sandbox.narrationParts('PCI/0165/PAYPAL *DEEPSEERWEA/402935773111126/14:34');
  assert.equal(pci.ref, '');
  assert.equal(pci.party, 'PAYPAL *DEEPSEERWEA');
});

test('fromTable parses a Kotak statement with a Dr / Cr column', () => {
  const csv = [
    '"Sl. No.","Transaction Date","Value Date","Description","Chq /Ref No.","Amount","Dr / Cr","Balance","Dr / Cr"',
    '"1","11-11-2026 19:09:47","11-11-2026","UPI/SHALINI GHOSH/UBIN/617985807272/Sent using P","UPI-210039702734","1,000.00","CR","4,180.14","CR"',
    '"2","11-11-2026 14:34:57","11-11-2026","PCI/0165/PAYPAL *DEEPSEERWEA/402935773111126/14:34","631509767683","210.19","DR","780.14","CR"'
  ].join('\n');
  const txns = sandbox.fromTable(sandbox.parseCSV(csv), 'Kotak');
  assert.equal(txns.length, 2);
  assert.equal(txns[0].stamp, '2026-11-11 19:09');
  assert.equal(txns[0].direction, 'CREDIT');
  assert.equal(txns[0].amount, 1000);
  assert.equal(txns[0].party, 'SHALINI GHOSH');
  assert.equal(txns[0].ref, '617985807272');
  assert.equal(txns[1].direction, 'DEBIT');
  assert.equal(txns[1].amount, 210.19);
  assert.equal(txns[1].party, 'PAYPAL *DEEPSEERWEA');
  assert.equal(txns[1].ref, '631509767683');
});

test('fromTable parses a BOI statement with reversals', () => {
  const csv = [
    'Sr No,Date,Remarks,Debit,Credit,Balance Amount',
    '1,01-10-2026,"UPI/627498773714/DR/THANDI/YESB/q/Sent u",75.00,,3876.02',
    '2,02-10-2026,"NEFT/SBIN226275322203/SBIN/ITDTAX REFUND",,10140.00,13547.02',
    '3,07-10-2026,"UPI/316342469615/DR/MANOJ /HDFC/vyapar/Sent u",400.00,,100',
    '4,07-10-2026,"UPI/316342469615/CR/MANOJ /HDFC/vyapar/Sent u",,400.00,500'
  ].join('\n');
  const txns = sandbox.fromTable(sandbox.parseCSV(csv), 'BOI');
  assert.equal(txns.length, 4);
  assert.equal(txns[0].stamp, '2026-10-01 00:00');
  assert.equal(txns[0].direction, 'DEBIT');
  assert.equal(txns[0].amount, 75);
  assert.equal(txns[0].party, 'THANDI');
  assert.equal(txns[0].ref, '627498773714');
  assert.equal(txns[1].stamp.slice(0, 10), '2026-10-02');
  assert.equal(txns[1].direction, 'CREDIT');
  assert.equal(txns[1].amount, 10140);
  assert.equal(txns[1].party, 'ITDTAX REFUND');
  assert.equal(txns[2].party, 'MANOJ');
  assert.equal(txns[2].ref, '316342469615');
  assert.equal(txns[3].direction, 'CREDIT');
  assert.equal(txns[3].amount, 400);
});
