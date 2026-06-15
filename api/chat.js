export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system, webSearch } = req.body;

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: system,
      messages: messages,
      stream: true
    };

    if (webSearch === true) {
      body.tools = [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 2,
          user_location: {
            type: 'approximate',
            country: 'FR',
            timezone: 'Europe/Paris'
          }
        }
      ];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    // En cas d'erreur (clé invalide, modèle indisponible...), renvoyer le JSON d'erreur classique
    if (!response.ok || !response.body) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status || 500).json(errData);
    }

    // ── Streaming : on relaie au client uniquement le texte généré (text_delta) ──
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // garde la ligne incomplète pour le prochain chunk
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === 'content_block_delta' && evt.delta && evt.delta.type === 'text_delta') {
            res.write(evt.delta.text);
          }
        } catch (e) { /* ligne SSE incomplète/ignorée */ }
      }
    }

    return res.end();

  } catch (error) {
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: error.message });
  }
}
