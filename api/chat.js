export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, system, webSearch } = req.body;

    // Build the request body
    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: system,
      messages: messages
    };

    // Activer la recherche web uniquement si demandé (ex : Luna)
    if (webSearch === true) {
      body.tools = [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
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

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
