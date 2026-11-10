// ============================================================
// Deb Finance Tracker — hybrid Gmail forwarder (tiny GAS script)
// ============================================================
// This is the ONLY remaining Google Apps Script. It forwards new Kotak
// transaction emails to the Vercel backend, which parses, dedups and logs
// them into Google Sheets. All the real logic now lives in the repo.
//
// Setup:
//   1. Create a new Apps Script project (script.google.com).
//   2. Paste this file into Code.gs.
//   3. Fill in WEB_APP_URL and APP_KEY below.
//   4. Add a time-driven trigger: "forwardKotakEmails", every hour.
//
// Re-sending is safe — the backend dedups by reference number.

var WEB_APP_URL = 'https://YOUR-PROJECT.vercel.app/api/exec';
var APP_KEY = 'REPLACE_WITH_YOUR_APP_KEY';

// Kotak alert emails usually come from a fixed sender. Adjust this query if
// your bank uses a different address or if you have a dedicated label.
var KOTAK_QUERY = 'from:alerts@kotak.com is:unread';

function forwardKotakEmails() {
  var threads = GmailApp.search(KOTAK_QUERY, 0, 50);
  var messages = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (msg.isUnread()) {
        messages.push({ subject: msg.getSubject(), body: msg.getPlainBody() });
        msg.markRead();
      }
    });
  });

  if (!messages.length) return;

  var payload = JSON.stringify({ key: APP_KEY, action: 'ingest', messages: messages });
  var response = UrlFetchApp.fetch(WEB_APP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  });
  Logger.log(response.getContentText());
}
