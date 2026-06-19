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
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const MONTHLY_LIMIT = 35;

    if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY manquante' });

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
      // ── MODE ÉDITION PHOTO — fidélité maximale à l'image source ──────────
      const mediaType = imageMediaType || 'image/jpeg';

      const preserveRules = [];
      if (preserveFace !== false) preserveRules.push('the exact face identity, facial features, and expression');
      preserveRules.push('the body shape, pose and proportions of the subject');
      preserveRules.push('the clothing (unless the user explicitly asks to change it)');
      preserveRules.push('the lighting and color temperature');
      preserveRules.push('the camera angle and perspective');
      if (preserveBackground !== false) preserveRules.push('the background exactly as it is');
      preserveRules.push('the overall photorealistic quality — this must look like an unedited real photo, not an AI-generated scene');

      // 1. Claude analyse la photo et génère une instruction d'édition chirurgicale
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: `You are an expert photo editing AI assistant. Look at this photo carefully and write a precise, detailed image editing instruction in English for gpt-image-1, for this user request: "${prompt}"

Your instruction MUST:
1. Start with "Edit the uploaded photo." 
2. Describe EXACTLY what to change (be specific: position, size, color, material of the new/modified element)
3. Explicitly state to preserve: ${preserveRules.join('; ')}
4. End with "Photorealistic result, same photo quality and grain as the original."

If the user's request is vague (e.g. "add a kebab"), expand it into a precise, realistic description (e.g. where exactly it should be placed, how it should look) while keeping it natural.

Reply with ONLY the final instruction, no preamble, no explanation.` }
            ]
          }]
        })
      });
      const claudeData = await claudeRes.json();
      const editPrompt = claudeData.content?.[0]?.text?.trim() || `Edit the uploaded photo. ${prompt}. Preserve ${preserveRules.join('; ')}. Photorealistic result.`;

      console.log('[Nova] edit prompt:', editPrompt);

      // 2. GPT Image 1 — édition avec image de référence
      const formData = new FormData();
      const buffer = Buffer.from(imageBase64, 'base64');
      const blob = new Blob([buffer], { type: 'image/png' });
      formData.append('image', blob, 'image.png');
      formData.append('prompt', editPrompt);
      formData.append('model', 'gpt-image-1');
      formData.append('n', '1');
      formData.append('size', '1024x1024');
      formData.append('quality', hdQuality ? 'high' : 'medium');

      const editRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}` },
        body: formData
      });
      const editData = await editRes.json();

      if (!editRes.ok || !editData.data?.[0]) {
        console.error('[Nova edit] error:', JSON.stringify(editData));
        return res.status(500).json({ error: editData.error?.message || 'Édition échouée' });
      }

      imageBase64Result = editData.data[0].b64_json;

    } else {
      // ── MODE GÉNÉRATION (gpt-image-1 texte → image) ──────────────────────
      const genRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: prompt,
          n: 1,
          size: '1024x1024',
          quality: hdQuality === false ? 'medium' : 'high'
        })
      });
      const genData = await genRes.json();

      if (!genRes.ok || !genData.data?.[0]) {
        console.error('[Nova gen] error:', JSON.stringify(genData));
        return res.status(500).json({ error: genData.error?.message || 'Génération échouée' });
      }

      imageBase64Result = genData.data[0].b64_json;
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
