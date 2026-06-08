export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, size, quality } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: size || '1024x1024',
        quality: quality || 'standard',
        response_format: 'url'
      })
    });

    const data = await response.json();
    if (!response.ok || !data.data || !data.data[0]) {
      return res.status(500).json({ error: data.error?.message || 'Erreur génération image' });
    }

    return res.status(200).json({ image: data.data[0].url });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
