import type { VercelRequest, VercelResponse } from '@vercel/node';

// Simple proxy to Groq API for real AI responses
// User must set GROQ_API_KEY in Vercel Environment Variables

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, config } = req.body;

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ 
      error: 'GROQ_API_KEY not configured. Add it in Vercel Project Settings > Environment Variables.' 
    });
  }

  try {
    const systemPrompt = `Tu es ${config.assistantName || 'un assistant d\'accueil'} chez ${config.companyName || 'l\'entreprise'}.
Ton ton : ${config.tone || 'professionnel et chaleureux'}.

Services disponibles : ${config.services?.map((s: any) => s.name).join(', ') || 'Standard, Commercial, Support, Comptabilité, RH'}.

Horaires : ${config.openingHours || 'Lun-Ven 9h-18h'}.

Règles :
- Sois naturel, poli et efficace comme une vraie secrétaire au téléphone.
- Détecte l'intention : transfert vers un service, prise de rendez-vous, message/rappel, urgence, ou info générale.
- Collecte les infos nécessaires étape par étape (nom, téléphone, email, motif).
- Pour les transferts : dis que tu transfères et simule le résultat.
- Pour les rendez-vous : propose des créneaux et confirme.
- Réponds en français.
- Garde les réponses courtes et adaptées au téléphone (pas de longs paragraphes).
- Si c'est fermé, propose de prendre un message.

Réponds UNIQUEMENT au format JSON suivant :
{
  "response": "ta réponse naturelle ici",
  "action": "optionnel: transfer_call(\"Service\") | calendar_create_event(...) | send_email(...) | FIN D'APPEL | ALERTE URGENCE",
  "nextPhase": "greeting | intent | collecting_info | confirming | closing"
}

Ne mets aucun texte en dehors du JSON.`;

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: any) => ({
        role: m.role === 'caller' ? 'user' : 'assistant',
        content: m.content
      }))
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Fast and excellent French
        messages: groqMessages,
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response from the model
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { response: content, action: undefined, nextPhase: 'intent' };
    }

    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('AI Proxy Error:', error);
    return res.status(500).json({ 
      error: 'AI service temporarily unavailable',
      fallbackResponse: 'Désolé, je rencontre un petit problème technique. Pouvez-vous répéter ?' 
    });
  }
}
