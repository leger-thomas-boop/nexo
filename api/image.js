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
      // ── MODE ÉDITION PHOTO — reproduit le comportement de ChatGPT Image Editing ──
      const mediaType = imageMediaType || 'image/jpeg';

      const preserveRules = [];
      if (preserveFace !== false) preserveRules.push('subject identity and exact facial features (face shape, skin tone, hair, eyes, expression)');
      preserveRules.push('body shape and proportions');
      preserveRules.push('pose');
      if (preserveBackground !== false) preserveRules.push('background, exactly as in the original');
      preserveRules.push('clothing (unless the user explicitly asks to change it)');
      preserveRules.push('lighting and color temperature');
      preserveRules.push('framing/crop and camera angle');
      preserveRules.push('overall photo realism, grain and resolution — must look like an untouched real photograph, not an AI-generated render');

      // 1. Claude décrit précisément le sujet ET génère l'instruction d'édition
      //    Décrire le sujet en détail donne à gpt-image-1 une ancre concrète pour ne pas "réinventer" la personne.
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: `You are simulating ChatGPT's image editing behavior (gpt-image-1 edit mode), which is known for being highly faithful to the source image. Your job is to write the editing instruction that will be sent to gpt-image-1.

User's request: "${prompt}"

STEP 1 — Silently observe this photo's specific, concrete details: the subject's approximate age, hair color/style, skin tone, facial structure, exact clothing (colors, type), body position, what's visible in the background, the lighting direction/quality, and the camera framing (close-up, full body, angle).

STEP 2 — Write a single editing instruction that:
1. Starts with: "This is a photo editing task, not a new image generation. Keep the uploaded photo essentially unchanged except for the specific edit described below."
2. Restates the key identifying details you observed (e.g. "the person has [hair color] hair, wearing [exact clothing description], sitting/standing [pose], in front of [background description]") so the model anchors on the real subject instead of inventing a generic one.
3. Describes EXACTLY what to change — be specific about position, size, color and material of the new/modified element. If the request is vague (e.g. "add a kebab"), make it concrete and realistic (placement, scale, lighting consistent with the scene).
4. Explicitly lists what MUST stay identical: ${preserveRules.join('; ')}.
5. Ends with: "Do not regenerate or restyle the rest of the image. Do not change the person's identity. Photorealistic result, same photographic quality, grain and resolution as the original upload."

Reply with ONLY the final instruction text, no preamble, no markdown, no explanation.` }
            ]
          }]
        })
      });
      const claudeData = await claudeRes.json();
      const editPrompt = claudeData.content?.[0]?.text?.trim() ||
        `This is a photo editing task, not a new image generation. Keep the uploaded photo essentially unchanged except for: ${prompt}. Preserve ${preserveRules.join('; ')}. Do not regenerate or restyle the rest of the image. Photorealistic result.`;

      console.log('[Nova] edit prompt:', editPrompt);

      // 2. GPT Image 1 — édition avec image de référence, fidélité prioritaire
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
