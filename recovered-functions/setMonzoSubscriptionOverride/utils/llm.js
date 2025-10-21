const aiUsageLogger = require("./aiUsageLogger");

async function callLLMJson({ system, user, purpose, userId, expectJson = false, temperature = 0.2, provider = 'gemini', model = 'gemini-1.5-flash' }) {
  const attempts = 3; // initial + 2 retries
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      let text;
      if (provider === 'openai') {
        text = await callOpenAIChat({ system, user, model, expectJson, temperature });
      } else {
        text = await callGemini({ system, user, model, expectJson, temperature });
      }
      // lightweight usage log
      const wrapped = aiUsageLogger.wrapAICall('google-ai-studio', 'gemini-1.5-flash');
      await wrapped(async () => ({ ok: true }), { userId, functionName: purpose, purpose });
      return text;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  if (expectJson) return '{}';
  throw lastErr || new Error('LLM unavailable');
}

async function callGemini({ system, user, model = 'gemini-1.5-flash', expectJson, temperature }) {
  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY;
  if (!apiKey) throw new Error('GOOGLEAISTUDIOAPIKEY not configured');
  const mdl = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
    generationConfig: Object.assign({}, expectJson ? { responseMimeType: 'application/json' } : {}, { temperature: temperature ?? 0.2 })
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text).join('');
  if (!text) throw new Error('Empty response from Gemini');
  return text;
}

async function callOpenAIChat({ system, user, model = 'gpt-4o-mini', expectJson, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const url = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model,
    temperature: temperature ?? 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response from OpenAI');
  return text;
}

module.exports = { callLLMJson };
