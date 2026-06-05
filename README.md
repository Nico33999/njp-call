# NJP Call - Assistant d'accueil téléphonique IA

Application web moderne pour configurer et simuler un assistant IA d'accueil téléphonique professionnel.

## ✨ Améliorations récentes (Juin 2026)
- Configuration Vercel optimisée (SPA rewrites pour routing client-side)
- Nettoyage de `vite.config.ts` : suppression plugins Manus/dev-only, compatibilité Vercel
- Nettoyage `package.json` : suppression dépendances inutiles, build simplifié
- Prêt pour déploiement production

## Développement
```bash
pnpm install
pnpm dev
```

## Build
```bash
pnpm build
```

## Déploiement sur Vercel (recommandé)
1. Va sur [vercel.com](https://vercel.com) et importe le repo GitHub `Nico33999/njp-call`
2. Vercel détecte automatiquement Vite
3. Build : `pnpm build` | Output : `dist/public`
4. Déploie !

Le site est live-ready avec routing SPA.

## Structure
- `client/` : Frontend React + Vite (design Néo-Brutaliste Télécom)
- `server/` : Serveur statique minimal (non utilisé sur Vercel)
- `shared/` : Types partagés

## Design
Inspiré de "Signal — Néo-Brutaliste Télécom" (idées dans ideas.md) : couleurs franches, bordures épaisses, ombres décalées, responsive.

## Prochaines étapes suggérées
- Intégration IA réelle (OpenAI / Grok API pour simulation)
- Ajout d'assets locaux pour images
- Tests avec Vitest
- Domain custom + analytics

Conforme RGPD par design.