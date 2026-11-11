// ==========================================
// Shared LLM adapter. DeepSeek is primary (paid, generous limits); Gemini is
// the fallback (the free tier is rate-limited).
// ==========================================

import { DEEPSEEK_KEY, GEMINI_KEY, GEMINI_MODEL } from './config.js';

async function deepseek(prompt) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0
    })
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('deepseek empty response');
  return JSON.parse(text);
}

async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini empty response');
  return JSON.parse(text);
}

export function llmConfigured() {
  return !!(DEEPSEEK_KEY || GEMINI_KEY);
}

// Returns { data, source }. DeepSeek first, then Gemini.
export async function askJSON(prompt) {
  const errors = [];
  if (DEEPSEEK_KEY) {
    try { return { data: await deepseek(prompt), source: 'DeepSeek' }; }
    catch (err) { errors.push(err.message); }
  }
  if (GEMINI_KEY) {
    try { return { data: await gemini(prompt), source: 'Gemini' }; }
    catch (err) { errors.push(err.message); }
  }
  throw new Error(errors.length ? `AI failed: ${errors.join('; ')}` : 'no AI provider configured');
}
