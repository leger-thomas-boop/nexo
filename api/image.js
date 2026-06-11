export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, imageBase64, imageMediaType } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });
    if (!userEmail) return res.status(401).json({ error: 'Non autorisé' });

    const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const MONTHLY_LIMIT = 20;

    if (!SUPABASE_SERVICE) return res.status(500).json({ error: 'Config serveur manquante' });

    // Vérifie le profil
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(userEmail)}&select=is_premium,images_this_month,images_month_key`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const profiles = await profileRes.json();
    const profile = profiles[0];

    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    if (!profile.is_premium) return res.status(403).json({ error: 'Réservé aux membres Premium' });

    const monthKey = new Date().toISOString().slice(0, 7);
    let count = (profile.images_month_key === monthKey) ? (profile.images_this_month || 0) : 0;
    if (count >= MONTHLY_LIMIT) return res.status(429).json({ error: `Limite de ${MONTHLY_LIMIT} images par mois atteinte.` });

    let finalPrompt = prompt;
    let imageUrl = null;
    let predictionId = null;

    if (imageBase64) {
      // ── MODE ÉDITION ─────────────────────────────────────────────────────
      // 1. Claude analyse la photo et construit un prompt précis en anglais
      const mediaType = imageMediaType || 'image/jpeg';
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 }
              },
              {
                type: 'text',
                text: `You are an expert at writing image editing prompts for Flux Kontext AI. 
The user wants to modify this image with the following instruction: "${prompt}"

Write a precise English prompt for Flux Kontext that:
1. Starts by describing the key elements of the original image to preserve
2. Then clearly describes the modification to apply
3. Keeps the subject/person/object from the original photo intact
4. Is specific and detailed

Reply with ONLY the prompt, nothing else. No explanation, no quotes.`
              }
            ]
          }]
        })
      });
      const claudeData = await claudeRes.json();
      if (claudeData.content && claudeData.content[0]) {
        finalPrompt = claudeData.content[0].text.trim();
      }

      // 2. Flux Kontext Pro avec la photo + prompt amélioré
      const dataUri = `data:${mediaType};base64,${imageBase64}`;
      const kontextRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait'
        },
        body: JSON.stringify({
          input: {
            prompt: finalPrompt,
            input_image: dataUri,
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 2
          }
        })
      });

      const kontextPred = await kontextRes.json();
      if (!kontextRes.ok) return res.status(500).json({ error: 'Kontext: ' + JSON.stringify(kontextPred) });

      if (kontextPred.output) {
        imageUrl = Array.isArray(kontextPred.output) ? kontextPred.output[0] : kontextPred.output;
      } else {
        predictionId = kontextPred.id;
      }

    } else {
      // ── MODE GÉNÉRATION : Flux 1.1 Pro ───────────────────────────────────
      const genRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait'
        },
        body: JSON.stringify({
          input: {
            prompt: prompt,
            width: 1024,
            height: 1024,
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 2,
            prompt_upsampling: true
          }
        })
      });

      const genPred = await genRes.json();
      if (!genRes.ok) return res.status(500).json({ error: 'Flux: ' + JSON.stringify(genPred) });

      if (genPred.output) {
        imageUrl = Array.isArray(genPred.output) ? genPred.output[0] : genPred.output;
      } else {
        predictionId = genPred.id;
      }
    }

    // Polling
    if (!imageUrl && predictionId) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
          headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` }
        });
        const pollData = await poll.json();
        if (pollData.status === 'succeeded') {
          imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
          break;
        }
        if (pollData.status === 'failed') {
          return res.status(500).json({ error: pollData.error || 'Génération échouée' });
        }
      }
    }

    if (!imageUrl) return res.status(500).json({ error: 'Image non disponible' });

    // Incrémente le compteur
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ images_this_month: count + 1, images_month_key: monthKey })
    });

    return res.status(200).json({ image: imageUrl, remaining: MONTHLY_LIMIT - count - 1 });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
