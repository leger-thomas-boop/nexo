export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, userEmail, imageBase64, imageMediaType, hdQuality, preserveFace, preserveBackground } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt manquant' });
    if (!userEmail) return res.status(401).json({ error: 'Non autorisé' });

    const SUPABASE_URL = 'https://zoycmayrynkisgiybqij.supabase.co';
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveWNtYXlyeW5raXNnaXlicWlqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDU4MzcxNSwiZXhwIjoyMDk2MTU5NzE1fQ.dTPsoVuqGFiqby2BHpkOplgZDTPr7_oYjuz1785gBDs';
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const MONTHLY_LIMIT = 35;

    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY manquante' });

    // ── Vérification profil & limite ─────────────────────────────────────
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(userEmail)}&select=is_premium,images_this_month,images_month_key`,
      { headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` } }
    );
    const profiles = await profileRes.json();
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    if (!profile.is_premium) return res.status(403).json({ error: 'Réservé aux membres Premium' });

    const monthKey = new Date().toISOString().slice(0, 7);
    let count = (profile.images_month_key === monthKey) ? (profile.images_this_month || 0) : 0;
    if (count >= MONTHLY_LIMIT) return res.status(429).json({ error: `Limite de ${MONTHLY_LIMIT} images/mois atteinte.` });

    let imageBase64Result = null;

    if (imageBase64) {
      // ── MODE ÉDITION PHOTO — gemini-2.5-flash-image (Nano Banana), fidélité maximale ──
      const mediaType = imageMediaType || 'image/jpeg';

      const preserveRules = [];
      if (preserveFace !== false) preserveRules.push('the exact subject identity and facial features (face shape, skin tone, hair, eyes, expression)');
      preserveRules.push('body shape and proportions');
      preserveRules.push('pose');
      if (preserveBackground !== false) preserveRules.push('the background exactly as in the original');
      preserveRules.push('clothing (unless the user explicitly asks to change it)');
      preserveRules.push('lighting and color temperature');
      preserveRules.push('framing/crop and camera angle');
      preserveRules.push('overall photo realism, grain and resolution — must look like an untouched real photograph');

      const editPrompt = `This is a precise photo editing task on the attached image, not a new image generation. Keep the photo essentially unchanged except for this specific edit: ${prompt}.

Strictly preserve: ${preserveRules.join('; ')}.

Do not regenerate, restyle, or reinterpret the rest of the image. Do not change the person's identity. The result must be photorealistic, with the same photographic quality, grain and resolution as the original upload — it should look like the original photo was simply edited, not recreated.`;

      console.log('[Nova] edit prompt:', editPrompt);

      const editRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: editPrompt },
              { inline_data: { mime_type: mediaType, data: imageBase64 } }
            ]
          }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      });
      const editData = await editRes.json();

      if (!editRes.ok) {
        console.error('[Nova edit] error:', JSON.stringify(editData));
        return res.status(500).json({ error: editData.error?.message || 'Édition échouée' });
      }

      const parts = editData.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find(p => p.inlineData || p.inline_data);
      imageBase64Result = imgPart ? (imgPart.inlineData?.data || imgPart.inline_data?.data) : null;

      if (!imageBase64Result) {
        console.error('[Nova edit] no image in response:', JSON.stringify(editData));
        return res.status(500).json({ error: 'Aucune image retournée. Réessayez avec une instruction plus simple.' });
      }

    } else {
      // ── MODE GÉNÉRATION (gemini-2.5-flash-image, texte → image) ──────────
      const genRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n\nPhotorealistic, high quality, natural lighting and proportions.` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
        })
      });
      const genData = await genRes.json();

      if (!genRes.ok) {
        console.error('[Nova gen] error:', JSON.stringify(genData));
        return res.status(500).json({ error: genData.error?.message || 'Génération échouée' });
      }

      const parts = genData.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find(p => p.inlineData || p.inline_data);
      imageBase64Result = imgPart ? (imgPart.inlineData?.data || imgPart.inline_data?.data) : null;

      if (!imageBase64Result) {
        console.error('[Nova gen] no image in response:', JSON.stringify(genData));
        return res.status(500).json({ error: 'Aucune image retournée. Réessayez avec un autre prompt.' });
      }
    }

    if (!imageBase64Result) return res.status(500).json({ error: 'Image non disponible' });

    // Incrémenter le compteur
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ images_this_month: count + 1, images_month_key: monthKey })
    });

    // Retourner l'image en base64 (data URL)
    const dataUrl = `data:image/png;base64,${imageBase64Result}`;
    return res.status(200).json({ image: dataUrl, remaining: MONTHLY_LIMIT - count - 1 });

  } catch (error) {
    console.error('[Nova] crash:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
