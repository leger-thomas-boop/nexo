export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, userToken } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });
    if (!userEmail || !userToken) return res.status(401).json({ error: 'Non autorisé' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;
    // Clé service pour bypass RLS (à ajouter dans Vercel env vars)
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
    const MONTHLY_LIMIT = 20;

    // Vérifie d'abord que le token est valide via Supabase Auth
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${userToken}` }
    });
    const authData = await authRes.json();
    if (!authData.email || authData.email !== userEmail) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Récupère le profil avec la clé service (bypass RLS)
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

    if (count >= MONTHLY_LIMIT) {
      return res.status(429).json({
        error: `Limite de ${MONTHLY_LIMIT} images par mois atteinte. Renouvellement le 1er du mois.`
      });
    }

    // Génération avec Replicate (Flux 1.1 Pro)
    const replicateRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          output_format: 'webp',
          output_quality: 80,
          safety_tolerance: 2,
          prompt_upsampling: true
        }
      })
    });

    const prediction = await replicateRes.json();
    if (!replicateRes.ok || prediction.error) {
      return res.status(500).json({ error: prediction.error || 'Erreur Replicate' });
    }

    // Récupère l'URL (avec polling si pas encore prête)
    let imageUrl = null;
    if (prediction.output) {
      imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    } else if (prediction.id) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` }
        });
        const pollData = await poll.json();
        if (pollData.status === 'succeeded') {
          imageUrl = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
          break;
        }
        if (pollData.status === 'failed') {
          return res.status(500).json({ error: 'Génération échouée' });
        }
      }
    }

    if (!imageUrl) return res.status(500).json({ error: 'Image non disponible' });

    // Incrémente le compteur avec clé service
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE,
        Authorization: `Bearer ${SUPABASE_SERVICE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        images_this_month: count + 1,
        images_month_key: monthKey
      })
    });

    return res.status(200).json({
      image: imageUrl,
      remaining: MONTHLY_LIMIT - count - 1
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
