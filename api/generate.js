const SYSTEM_PROMPT = `You are an expert Google Ads copywriter. Generate ad assets as strict JSON only (no markdown, no extra text).
Return exactly this shape:
{
  "headlines": ["..."],        // 15 items, each <= 30 characters
  "descriptions": ["..."],     // 4 items, each <= 90 characters
  "keywords": ["..."],         // 10 relevant keywords/phrases
  "posterIdea": "..."          // 1 detailed poster concept
}
Rules:
- Headlines: exactly 15, each max 30 characters.
- Descriptions: exactly 4, each max 90 characters.
- Keywords: exactly 10.
- Do not include numbering, labels, or quotes inside the strings beyond normal text.
- Keep copy relevant to the provided product, audience, and tone.
- Never write medical or guaranteed-result claims. Do not use phrases like 'dermatologist approved', 'clinically proven', 'guaranteed results', 'cures', or 'fade dark spots fast'. Keep claims soft and honest, like 'helps you glow' or 'made for daily care'. Keep every headline under 30 characters and every description under 90 characters.`;

function extractJSON(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Invalid JSON response from model');
}

function trimTo(str, max) {
  if (typeof str !== 'string') return '';
  return str.length <= max ? str : str.slice(0, max).trim();
}

function normalize(data) {
  const headlines = Array.isArray(data.headlines) ? data.headlines.slice(0, 15).map((s) => trimTo(String(s), 30)) : [];
  const descriptions = Array.isArray(data.descriptions) ? data.descriptions.slice(0, 4).map((s) => trimTo(String(s), 90)) : [];
  const keywords = Array.isArray(data.keywords) ? data.keywords.slice(0, 10).map((s) => String(s).trim()).filter(Boolean) : [];
  const posterIdea = typeof data.posterIdea === 'string' ? data.posterIdea.trim() : '';

  if (headlines.length !== 15 || descriptions.length !== 4 || keywords.length !== 10 || !posterIdea) {
    throw new Error('Model returned incomplete ad assets');
  }
  return { headlines, descriptions, keywords, posterIdea };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(model, apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
  }

  const { productName, audience, tone } = req.body || {};
  if (!productName || !audience || !tone) {
    return res.status(400).json({ error: 'productName, audience, and tone are required' });
  }

  try {
    const userPrompt = `Product: ${productName}\nTarget audience: ${audience}\nTone: ${tone}`;
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 3000,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    let response;
    let lastErrMsg = 'Gemini API request failed';
    const primaryModel = 'gemini-3.8-flash';

    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await callGemini(primaryModel, apiKey, body);
      if (response.ok) break;
      if (response.status === 503 || response.status === 429) {
        try {
          const errData = await response.json();
          lastErrMsg = errData.error && errData.error.message ? errData.error.message : lastErrMsg;
        } catch {}
        if (attempt < 3) {
          await sleep(1000);
          continue;
        }
      } else {
        try {
          const errData = await response.json();
          lastErrMsg = errData.error && errData.error.message ? errData.error.message : lastErrMsg;
        } catch {}
        return res.status(response.status).json({ error: lastErrMsg });
      }
    }

    if (!response.ok && (response.status === 503 || response.status === 429)) {
      response = await callGemini('gemini-2.5-flash-lite', apiKey, body);
    }

    if (!response.ok) {
      let errMsg = lastErrMsg;
      try {
        const errData = await response.json();
        errMsg = errData.error && errData.error.message ? errData.error.message : errMsg;
      } catch {}
      return res.status(response.status).json({ error: errMsg });
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
    const normalized = normalize(parsed);
    return res.status(200).json(normalized);
  } catch (err) {
    const msg = err && err.message ? err.message : 'Failed to generate ads';
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
};
