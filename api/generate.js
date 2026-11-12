const SYSTEM_PROMPT_BASE = `You are an expert Google Ads copywriter. Generate ad assets as strict JSON only (no markdown, no extra text).
Return exactly this shape:
{
  "headlines": ["..."],        // 10 items, each <= 30 characters
  "descriptions": ["..."],     // 4 items, each <= 90 characters
  "keywords": ["..."],         // 8 relevant keywords/phrases
  "posterIdea": "..."          // 1 poster concept in 2 short lines
}
Rules:
- Headlines: exactly 10, each max 30 characters.
- Descriptions: exactly 4, each max 90 characters.
- Keywords: exactly 8.
- Poster idea: exactly 2 short lines.
- Do not include numbering, labels, or quotes inside the strings beyond normal text.
- Keep copy relevant to the provided product, audience, and tone.
- Never write medical or guaranteed-result claims. Do not use phrases like 'dermatologist approved', 'clinically proven', 'guaranteed results', 'cures', or 'fade dark spots fast'. Keep claims soft and honest, like 'helps you glow' or 'made for daily care'. Keep every headline under 30 characters and every description under 90 characters.
- Every description must be a complete sentence under 90 characters, never cut off mid-word.`;

function buildSystemPrompt(language, benefit) {
  let extra = '';
  const lang = (typeof language === 'string' && language.trim()) ? language.trim() : 'English';
  extra += `\n- Write all ad copy in ${lang}. Hinglish means Hindi written in English letters.`;
  if (typeof benefit === 'string' && benefit.trim()) {
    extra += `\n- Highlight this main benefit: ${benefit.trim()}.`;
  }
  return SYSTEM_PROMPT_BASE + extra;
}

function extractJSON(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Invalid JSON response from model');
}

function trimToWord(str, max) {
  if (typeof str !== 'string') return '';
  const s = str.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) return cut.slice(0, lastSpace).trim();
  return s.slice(0, max).trim();
}

function normalize(data) {
  const headlines = Array.isArray(data.headlines) ? data.headlines.slice(0, 10).map((s) => String(s || '').trim()) : [];
  const descriptions = Array.isArray(data.descriptions) ? data.descriptions.slice(0, 4).map((s) => String(s || '').trim()) : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 8).map((s) => String(s).trim()).filter(Boolean) : [];
  const posterIdea = typeof data.posterIdea === 'string' ? data.posterIdea.trim() : '';

  if (headlines.length !== 10 || descriptions.length !== 4 || keywords.length !== 8 || !posterIdea) {
    throw new Error('Model returned incomplete ad assets');
  }
  return { headlines, descriptions, keywords, posterIdea };
}

function fitToLimits(data) {
  return {
    headlines: data.headlines.map((s) => (s.length > 30 ? trimToWord(s, 30) : s)),
    descriptions: data.descriptions.map((s) => (s.length > 90 ? trimToWord(s, 90) : s)),
    keywords: data.keywords,
    posterIdea: data.posterIdea
  };
}

function hasOverLimit(data) {
  return data.headlines.some((s) => s.length > 30) || data.descriptions.some((s) => s.length > 90);
}

async function callGemini(model, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(err) {
  return err && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://readyad.vercel.app',
    'https://ai-ad-generator-live.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ];
  const isAllowedOrigin = origin && (allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin));
  if (isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
  }

  const { productName, audience, tone, language, benefit } = req.body || {};
  if (!productName || !audience || !tone) {
    return res.status(400).json({ error: 'productName, audience, and tone are required' });
  }

  const overallStart = Date.now();
  const overallLimit = 25000;
  const model = 'gemini-3.5-flash-lite';

  try {
    const userPrompt = `Product: ${productName}\nTarget audience: ${audience}\nTone: ${tone}`;
    const systemPrompt = buildSystemPrompt(language, benefit);
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 1200
      }
    };

    let response = null;
    let lastErrMsg = 'Gemini API request failed';
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const elapsed = Date.now() - overallStart;
      const remaining = overallLimit - elapsed;
      if (remaining <= 0) {
        return res.status(503).json({ error: 'Server busy hai, please dobara try karo' });
      }
      const timeoutMs = Math.min(15000, remaining);
      try {
        response = await callGemini(model, apiKey, body, timeoutMs);
      } catch (err) {
        if (isTimeoutError(err) || Date.now() - overallStart >= overallLimit) {
          return res.status(503).json({ error: 'Server busy hai, please dobara try karo' });
        }
        if (attempt < maxAttempts) continue;
        throw err;
      }

      if (response.ok) break;

      try {
        const errData = await response.json();
        lastErrMsg = errData.error && errData.error.message ? errData.error.message : lastErrMsg;
      } catch {}

      if (attempt < maxAttempts && Date.now() - overallStart < overallLimit) {
        continue;
      }
    }

    if (!response || !response.ok) {
      let errMsg = lastErrMsg;
      if (response) {
        try {
          const errData = await response.json();
          errMsg = errData.error && errData.error.message ? errData.error.message : errMsg;
        } catch {}
        return res.status(response.status).json({ error: errMsg });
      }
      return res.status(503).json({ error: 'Server busy hai, please dobara try karo' });
    }

    const result = await response.json();
    const text = result.candidates &&
      result.candidates[0] &&
      result.candidates[0].content &&
      result.candidates[0].content.parts &&
      result.candidates[0].content.parts[0] &&
      result.candidates[0].content.parts[0].text
      ? result.candidates[0].content.parts[0].text
      : '';

    if (!text) {
      throw new Error('Empty response from model');
    }

    const parsed = extractJSON(text);
    let normalized = normalize(parsed);

    if (hasOverLimit(normalized)) {
      const elapsed = Date.now() - overallStart;
      const remaining = overallLimit - elapsed;
      if (remaining > 0) {
        try {
          const shortenPrompt = `Shorten any headline over 30 characters and any description over 90 characters. Every description must be a complete sentence under 90 characters, never cut off mid-word. Keep meaning and tone. Return the same JSON shape with exactly 10 headlines, 4 descriptions, 8 keywords, and posterIdea.\nCurrent JSON:\n${JSON.stringify(normalized)}`;
          const shortenBody = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: shortenPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
              maxOutputTokens: 1200
            }
          };
          const shortenTimeout = Math.min(15000, remaining);
          const shortenResp = await callGemini(model, apiKey, shortenBody, shortenTimeout);
          if (shortenResp && shortenResp.ok) {
            const shortenResult = await shortenResp.json();
            const shortenText = shortenResult.candidates &&
              shortenResult.candidates[0] &&
              shortenResult.candidates[0].content &&
              shortenResult.candidates[0].content.parts &&
              shortenResult.candidates[0].content.parts[0] &&
              shortenResult.candidates[0].content.parts[0].text
              ? shortenResult.candidates[0].content.parts[0].text
              : '';
            if (shortenText) {
              const shortenParsed = extractJSON(shortenText);
              normalized = normalize(shortenParsed);
            }
          }
        } catch (e) {
          if (isTimeoutError(e)) {
            return res.status(503).json({ error: 'Server busy hai, please dobara try karo' });
          }
        }
      }
    }

    const finalData = fitToLimits(normalized);
    return res.status(200).json(finalData);
  } catch (err) {
    if (isTimeoutError(err)) {
      return res.status(503).json({ error: 'Server busy hai, please dobara try karo' });
    }
    const msg = err && err.message ? err.message : 'Failed to generate ads';
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
};
