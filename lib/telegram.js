// ==========================================
// Minimal Telegram Bot API client for the conversation bot.
// ==========================================

import { TG_TOKEN, TG_CHAT } from './config.js';

export function botConfigured() {
  return !!(TG_TOKEN && TG_CHAT);
}

async function call(method, payload) {
  if (!botConfigured()) throw new Error('Telegram is not configured');
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `telegram ${res.status}`);
  return data.result;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function sendMessage(text, keyboard) {
  return call('sendMessage', {
    chat_id: TG_CHAT,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

export function editMessage(messageId, text, keyboard) {
  return call('editMessageText', {
    chat_id: TG_CHAT,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}

export function answerCallback(callbackQueryId, text = '') {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
}

export function setWebhook(url, secret) {
  return call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
}

export function webhookInfo() {
  return call('getWebhookInfo', {});
}

export function setMyCommands(commands) {
  return call('setMyCommands', { commands });
}

export function getMyCommands() {
  return call('getMyCommands', {});
}

export function setChatMenuButton(menuButton) {
  return call('setChatMenuButton', { menu_button: menuButton });
}

export function sendChatAction(action = 'typing') {
  return call('sendChatAction', { chat_id: TG_CHAT, action });
}
