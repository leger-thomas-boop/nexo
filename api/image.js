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
    const MONTHLY_LIMIT = 20;

    if (!SUPABASE_SERVICE) return res.status(500).json({ error: 'Config serveur manquante: SUPABASE_SERVICE_KEY vide' });

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

    let imageUrl = null;

    if (imageBase64) {
      // ── MODE ÉDITION : photo envoyée → Flux Kontext Pro ──────────────────
      // Upload l'image sur Replicate
      const mediaType = imageMediaType || 'image/jpeg';
      const buffer = Buffer.from(imageBase64, 'base64');
      const blob = new Blob([buffer], { type: mediaType });
      const formData = new FormData();
      formData.append('content', blob, 'image.jpg');

      const uploadRes = await fetch('https://api.replicate.com/v1/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.urls?.get) {
        return res.status(500).json({ error: 'Upload image échoué: ' + JSON.stringify(uploadData) });
      }
      const inputImageUrl = uploadData.urls.get;

      // Appel Flux Kontext Pro
      const kontextRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REPLICATE_TOKEN}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait'
        },
        body: JSON.stringify({
          input: {
            prompt: prompt,
            input_image: inputImageUrl,
            output_format: 'webp',
            output_quality: 90,
            safety_tolerance: 2
          }
        })
      });

      const kontextPred = await kontextRes.json();
      if (!kontextRes.ok) return res.status(500).json({ error: JSON.stringify(kontextPred) });

      if (kontextPred.output) {
        imageUrl = Array.isArray(kontextPred.output) ? kontextPred.output[0] : kontextPred.output;
      } else if (kontextPred.id) {
        for (let i = 0; i < 25; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const poll = await fetch(`https://api.replicate.com/v1/predictions/${kontextPred.id}`, {
            headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` }
          });
          const pollData = await poll.json();
          if (pollData.status === 'succeeded') {
            imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
            break;
          }
          if (pollData.status === 'failed') return res.status(500).json({ error: pollData.error || 'Édition échouée' });
        }
      }

    } else {
      // ── MODE GÉNÉRATION : texte seul → Flux 1.1 Pro ──────────────────────
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
      if (!genRes.ok) return res.status(500).json({ error: JSON.stringify(genPred) });

      if (genPred.output) {
        imageUrl = Array.isArray(genPred.output) ? genPred.output[0] : genPred.output;
      } else if (genPred.id) {
        for (let i = 0; i < 25; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const poll = await fetch(`https://api.replicate.com/v1/predictions/${genPred.id}`, {
            headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` }
          });
          const pollData = await poll.json();
          if (pollData.status === 'succeeded') {
            imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
            break;
          }
          if (pollData.status === 'failed') return res.status(500).json({ error: pollData.error || 'Génération échouée' });
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
