import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  amountNum_, st_, isNonTxnSMS_, normDate_, normKey_, normBucket_, normCategory_,
  pendingPayeeKey, compositeKey_, historyTotals, cellToDateStr, safeCallback, ymd, serialToDate
} from '../lib/util.js';

import { parseKotak_, parseKotakSMS_, parseSMS_, parseSBISMS_ } from '../lib/parse.js';

test('amountNum_ strips commas', () => {
  assert.equal(amountNum_('1,234.50'), 1234.5);
  assert.equal(amountNum_(1234.5), 1234.5);
});

test('st_ uppercases and trims', () => {
  assert.equal(st_('  pending '), 'PENDING');
  assert.equal(st_(''), '');
  assert.equal(st_(null), '');
});

test('isNonTxnSMS_ matches OTP / one-time / dont share', () => {
  assert.equal(isNonTxnSMS_('Your OTP is 123456'), true);
  assert.equal(isNonTxnSMS_('one-time password'), true);
  assert.equal(isNonTxnSMS_("don't share this code"), true);
  assert.equal(isNonTxnSMS_('Rs.500 debited'), false);
});

test('normDate_ normalises dd-Mon-yy and dd-mm-yy', () => {
  assert.equal(normDate_('15-Jan-26'), '2026-01-15');
  assert.equal(normDate_('15-01-26'), '2026-01-15');
  assert.equal(normDate_('03-Dec-25'), '2025-12-03');
});

test('normKey_ strips titles and keeps first 9 letters', () => {
  assert.equal(normKey_('Mr. Adarsh Kumar'), 'ADARSHKUM');
  assert.equal(normKey_('KAKOLI SAHA'), 'KAKOLISAH');
  assert.equal(normKey_('Shri Sampurnaa Das'), 'SAMPURNAA');
  assert.equal(normKey_(''), '');
});

test('normBucket_/normCategory_ normalise case', () => {
  assert.equal(normBucket_('internal'), 'Internal');
  assert.equal(normBucket_('INTERNAL'), 'Internal');
  assert.equal(normBucket_('Business'), 'Business');
  assert.equal(normCategory_('self transfer'), 'Self transfer');
  assert.equal(normCategory_('Tenant rent'), 'Tenant rent');
  assert.equal(normCategory_('bogus'), 'bogus'); // unknown passes through
});

test('pendingPayeeKey lowercases and collapses whitespace', () => {
  assert.equal(pendingPayeeKey('  Adarsh   Kumar '), 'adarsh kumar');
  assert.equal(pendingPayeeKey('KAKOLI SAHA'), 'kakoli saha');
});

test('compositeKey_ builds date|direction|amount', () => {
  assert.equal(compositeKey_('2026-01-15', 'DEBIT', '1,234.50'), '2026-01-15|DEBIT|1234.50');
});

test('historyTotals matches frontend historySum', () => {
  const items = [
    { direction: 'DEBIT', amount: 100, bucket: 'Business' },
    { direction: 'DEBIT', amount: 50, bucket: 'Personal' },
    { direction: 'CREDIT', amount: 300, bucket: 'Business' },
    { direction: 'DEBIT', amount: 20, bucket: 'Internal' },
    { direction: 'CREDIT', amount: 5, bucket: 'Internal' },
  ];
  assert.deepEqual(historyTotals(items), {
    sent: 150, received: 300, business: 100, personal: 50, internal: 25
  });
});

test('cellToDateStr converts Sheets serial and ISO and dd-Mon-yy', () => {
  assert.equal(cellToDateStr(46023), '2026-01-01'); // 2026-01-01 serial
  assert.equal(cellToDateStr('2026-01-15'), '2026-01-15');
  assert.equal(cellToDateStr('15-Jan-26'), '2026-01-15');
  assert.equal(cellToDateStr(''), '');
});

test('safeCallback validates JSONP names', () => {
  assert.equal(safeCallback('cb_abc123'), 'cb_abc123');
  assert.equal(safeCallback('alert(1)'), null);
  assert.equal(safeCallback('1abc'), null);
});

test('parseSMS_ handles a BOI debit', () => {
  const t = parseSMS_('Rs.500.00 debited from a/c XX1234 on 15-Jan-26. UPI ref No. 123456789012 credited to ADARSH via UPI');
  assert.equal(t.direction, 'DEBIT');
  assert.equal(t.amount, '500.00');
  assert.equal(t.ref, '123456789012');
  assert.equal(t.date, '2026-01-15');
  assert.equal(t.party, 'ADARSH');
});

test('parseKotakSMS_ handles a Kotak debit', () => {
  const t = parseKotakSMS_('Sent Rs.250.00 from XX7991 to CHAIWALA on 15-Jan-26. UPI ref no. 123456789012');
  assert.equal(t.direction, 'DEBIT');
  assert.equal(t.amount, '250.00');
  assert.equal(t.ref, '123456789012');
  assert.equal(t.party, 'CHAIWALA');
});

test('parseSBISMS_ only accepts the 2175 account', () => {
  const t = parseSBISMS_('A/c XX2175 Debited Rs.1000.00 on 15/01/26. Transferred to Asit. Avl Bal Rs. 5000');
  assert.equal(t.direction, 'DEBIT');
  assert.equal(t.amount, '1000.00');
  assert.equal(t.date, '2026-01-15');
  assert.equal(t.party, 'Asit');
  assert.equal(t.account, 'Mother SBI current');
  assert.equal(parseSBISMS_('A/c XX9999 Debited Rs.1000.00 on 15/01/26'), null);
});

console.log('All tests passed.');
