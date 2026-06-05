import type { VercelRequest, VercelResponse } from '@vercel/node';

// Proxy to Groq for real conversational AI
// Fully respects customSystemPrompt and companyKnowledge from user config

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, config } = req.body;

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ 
      error: 'GROQ_API_KEY not configured in Vercel Environment Variables.' 
    });
  }

  try {
    // Priority to user's custom prompt if provided
    let systemPrompt = (config.customSystemPrompt && config.customSystemPrompt.trim().length > 15)
      ? config.customSystemPrompt
      : `Tu es ${config.assistantName || 'un assistant d\'accueil'} chez ${config.companyName || 'l\'entreprise'}.
Ton : ${config.tone || 'professionnel et chaleureux'}.

Services : ${config.services?.map((s: any) => s.name).join(', ') || 'Commercial, Support, Comptabilité, RH, Standard'}.
Horaires : ${config.openingHours || 'Lun-Ven 9h-18h'}.

Comportement :
- Naturel, poli, efficace et empathique comme une vraie secrétaire au téléphone.
- Détecte l'intention rapidement.
- Collecte les infos de façon progressive.
- Propose des solutions avant de transférer quand possible.
- Réponses courtes et adaptées au téléphone.

${config.companyKnowledge ? `Connaissances spécifiques :
${config.companyKnowledge}

` : ''}Réponds UNIQUEMENT en JSON :
{
  "response": "réponse naturelle ici",
  "action": "optionnel : transfer_call(...) | calendar_create_event(...) | send_email(...) | FIN D'APPEL",
  "nextPhase": "intent | collecting_info | confirming | closing"
}`;

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
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.75,
        max_tokens: 450,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) throw new Error(`Groq ${response.status}`);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    let parsed;
    try { parsed = JSON.parse(content); } 
    catch { parsed = { response: content || "Pouvez-vous reformuler ?", action: undefined }; }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ 
      error: 'IA temporairement indisponible',
      fallbackResponse: 'Désolé, petit problème technique. Que puis-je faire pour vous ?' 
    });
  }
}
