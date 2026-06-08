// api/generate-image.js
// Route Vercel sécurisée : la clé OpenAI reste côté serveur.
// Dans Vercel > Settings > Environment Variables, ajoute : OPENAI_API_KEY=sk-...

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { prompt, size = '1024x1024', quality = 'medium' } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY manquante côté serveur.' });
    }

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'Prompt image manquant ou trop court.' });
    }

    if (prompt.length > 1200) {
      return res.status(400).json({ error: 'Prompt trop long. Réduisez la demande.' });
    }

    const allowedSizes = ['1024x1024', '1024x1536', '1536x1024'];
    const allowedQualities = ['low', 'medium', 'high'];

    const safeSize = allowedSizes.includes(size) ? size : '1024x1024';
    const safeQuality = allowedQualities.includes(quality) ? quality : 'medium';

    const finalPrompt = `
Tu es Nova, créatrice d'images pour Nexo.
Crée une image propre, moderne, exploitable commercialement.
Demande utilisateur : ${prompt.trim()}
Évite les textes illisibles, les logos de marques existantes et les éléments protégés.
`.trim();

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: finalPrompt,
        size: safeSize,
        quality: safeQuality,
        n: 1,
        output_format: 'png'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Erreur OpenAI pendant la génération.'
      });
    }

    const first = data?.data?.[0];
    const image = first?.b64_json
      ? `data:image/png;base64,${first.b64_json}`
      : first?.url;

    if (!image) {
      return res.status(500).json({ error: 'Image non reçue depuis OpenAI.' });
    }

    return res.status(200).json({ image });
  } catch (error) {
    return res.status(500).json({ error: 'Erreur serveur génération image.' });
  }
}
