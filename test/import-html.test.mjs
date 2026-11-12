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
test('findHeaderRow and pickSheet choose the transaction sheet', () => {
  const summary = [['Paytm Statement for:', "1 OCT'26 - 11 NOV'26"], ['Money Paid (Amount in Rs.)', '-209,768.18']];
  const passbook = [['Date', 'Time', 'Transaction Details', 'Amount', 'UPI Ref No.'], ['11/11/2026', '21:46:27', 'Paid to X', '-99.00', '123456789012']];
  assert.equal(sandbox.findHeaderRow(summary), -1);
  assert.equal(sandbox.findHeaderRow(passbook), 0);
  assert.equal(sandbox.pickSheet([{ name: 'Summary', rows: summary }, { name: 'Passbook Payment History', rows: passbook }]).name, 'Passbook Payment History');
  assert.equal(sandbox.pickSheet([{ name: 'Summary', rows: summary }]).name, 'Summary');
});

test('fromTable parses a Paytm passbook with signed amounts', () => {
  const csv = [
    'Date,Time,Transaction Details,Other Transaction Details (UPI ID or A/c No),Your Account,Amount,UPI Ref No.,Order ID,Remarks,Tags,Comment',
    '11/11/2026,21:46:27,"Paid to Sindhu Dixit",paytm.s31xahf@pty,Bank Of India - 45,-240.00,318975425210,,Transaction success,#🛒 Groceries,',
    '06/11/2026,02:11:10,"Received from Deb Zyoti Das",******7086@kotakbank,Bank Of India - 45,+200.00,667621332145,,,#💵 Money Received,',
    '01/11/2026,12:00:00,"Received from Adarsh Kumar",8584966190.wa.zqr@waicici,Bank Of India - 45,120.00,111090601749,,,#💵 Money Received,',
    '02/11/2026,10:00:00,"Automatic payment for Apple Media Services",appleservices.bdsi@hdfcbank,Bank Of India - 45,-99.00,104459475062,,Transaction success,#🏦 Services,',
    '03/11/2026,10:00:00,"Transferred to Self, Bank Of India - 4245",,Bank Of India - 45,120.00,218731450467,,,#💵 Self Transfer,'
  ].join('\n');
  const txns = sandbox.fromTable(sandbox.parseCSV(csv), 'Paytm');
  assert.equal(txns.length, 5);
  assert.equal(txns[0].stamp, '2026-11-11 21:46');
  assert.equal(txns[0].direction, 'DEBIT');
  assert.equal(txns[0].amount, 240);
  assert.equal(txns[0].party, 'Sindhu Dixit');
  assert.equal(txns[0].ref, '318975425210');
  assert.equal(txns[1].direction, 'CREDIT');
  assert.equal(txns[1].party, 'Deb Zyoti Das');
  assert.equal(txns[1].ref, '667621332145');
  assert.equal(txns[2].direction, 'CREDIT');
  assert.equal(txns[2].party, 'Adarsh Kumar');
  assert.equal(txns[3].party, 'Apple Media Services');
  assert.equal(txns[3].direction, 'DEBIT');
  assert.equal(txns[4].direction, 'CREDIT');
  assert.equal(txns[4].party, 'Self Transfer · Bank Of India - 4245');
});

test('narrationParts extracts SBI transfer payees', () => {
  const upi = sandbox.narrationParts('DEP TFR   UPI/CR/627498773714/PAYEE A/KKBK/9716714');
  assert.equal(upi.ref, '627498773714');
  assert.equal(upi.party, 'PAYEE A');
  const debit = sandbox.narrationParts('WDL TFR   UPI/DR/664335168378/PAYEE B/YESB/paytmqr6ja');
  assert.equal(debit.ref, '664335168378');
  assert.equal(debit.party, 'PAYEE B');
  const sbiy = sandbox.narrationParts('DEP TFR   SBIY226275104411469280067/M/Transfer to Family or 001 OF Mrs. KAKOLI SAHA AT 00093 JADAVPUR UNIVERSITY');
  assert.equal(sbiy.ref, 'SBIY226275104411469280067');
  assert.equal(sbiy.party, 'KAKOLI SAHA');
  const imps = sandbox.narrationParts('WDL TFR IMPS/628523987649/ICIC-xx470-RAKESH R/ Rent 0098286162096 AT 00093');
  assert.equal(imps.ref, '628523987649');
  assert.equal(imps.party, 'RAKESH R');
  const bill = sandbox.narrationParts('WDL TFR Bill Payment-SB41627801ZiYMrLO7hA 0098710801501');
  assert.equal(bill.ref, 'SB41627801ZiYMrLO7hA');
  assert.equal(bill.party, 'Bill Payment');
  assert.equal(sandbox.narrationParts('DEP TFR CSH DEP (CDM) MOB 7042777086').party, 'Cash Deposit');
  assert.equal(sandbox.narrationParts('DEP TFR UPI/REF/186111126600/CR 009 7735162098').ref, '186111126600');
  assert.equal(sandbox.narrationParts('DEP TFR UPI/REF/186111126600/CR 009 7735162098').party, 'UPI');
});

test('fromTable parses an SBI statement', () => {
  const rows = [
    ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
    ['02/10/2026', ' DEP TFR   UPI/CR/627498773714/PAYEE A/KKBK/9716714', '', '', '100.00', '5909.00'],
    ['02/10/2026', ' WDL TFR   UPI/DR/664335168378/PAYEE B/YESB/paytmqr6ja', '', '60.00', '', '18425.00']
  ];
  const txns = sandbox.fromTable(rows, 'Mother SBI current');
  assert.equal(txns.length, 2);
  assert.equal(txns[0].direction, 'CREDIT');
  assert.equal(txns[0].amount, 100);
  assert.equal(txns[0].party, 'PAYEE A');
  assert.equal(txns[0].ref, '627498773714');
  assert.equal(txns[1].direction, 'DEBIT');
  assert.equal(txns[1].amount, 60);
  assert.equal(txns[1].party, 'PAYEE B');
  assert.equal(txns[1].ref, '664335168378');
  assert.equal(txns[0].source, 'Import-Mother SBI current');
});
