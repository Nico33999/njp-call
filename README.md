# NJP Call - Assistant d'accueil téléphonique IA

Application web moderne pour configurer et simuler un assistant IA d'accueil téléphonique professionnel.

## ✨ Nouveauté : Vraie IA intégrée !
- L'assistant utilise maintenant **Groq (Llama 3.3)** via une fonction serverless Vercel pour des réponses naturelles et intelligentes.
- Fallback automatique vers la logique locale si l'IA est indisponible.
- Comportement fidèle à ta configuration (nom, ton, services, horaires...).

## Configuration de l'IA (obligatoire pour la vraie IA)
1. Va dans les **Settings** de ton projet Vercel
2. **Environment Variables** → Ajoute :
   - `GROQ_API_KEY` = ta clé API Groq (gratuite sur https://console.groq.com)
3. Redeploie le projet

Sans la clé, l'application utilise le mode simulation locale (toujours fonctionnel).

## Développement
```bash
pnpm install
pnpm dev
```

## Build & Déploiement Vercel
```bash
pnpm build
```

Le site est prêt pour la production avec vraie IA conversationnelle.

## Structure
- `client/` : Frontend React + Vite
- `api/chat.ts` : Proxy IA (Groq)
- `server/` : Ancien serveur statique (non utilisé sur Vercel)

## Design
Style Néo-Brutaliste Télécom (Signal) — fluide et professionnel.

Prochaines améliorations possibles : vraie intégration téléphonie (Twilio, etc.), historique persistant, analytics.