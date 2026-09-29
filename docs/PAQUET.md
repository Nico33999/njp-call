# Paquet d'extension `.njpx`

## Format (v1)

JSON canonique (clés triées, aucun espace, fichiers triés, saut de ligne final) :
`format`, `formatVersion`, `manifest`, `files[] {path, size, sha256, content(base64)}`.
Chemins autorisés : `manifest.json`, `surfaces.json`, `defaults/*.json`,
`rules/*.json`. **Aucun code exécutable.**

## Signature

minisign, algorithme `ED` (Ed25519 sur BLAKE2b-512), le format déjà vérifié par
NJP CARE pour ses mises à jour. Le commentaire de confiance — lui-même signé —
lie la signature à l'identité :

```
njp-extension id=njp.call version=0.1.0 sha256=<empreinte> channel=essai contrat=2
```

Une signature valide d'un autre paquet, d'une autre version ou d'un autre canal
est donc refusée.

## Clés

- `keys/extensions-essai.pub` : clé **publique d'essai**.
- La clé privée d'essai est engendrée hors dépôt (`scripts/keygen-test.ts`
  refuse d'écrire dans un dépôt Git).
- Le canal `stable` est refusé avec une clé d'essai, ici et dans NJP CARE.
- La clé de **distribution** est une décision externe (conservation hors ligne,
  procédure analogue à `njp-care/desktop/keys/PROCEDURE-CLES.md`).

## Reproductibilité

`pnpm package:build` deux fois ⇒ mêmes octets. La CI compare l'empreinte
produite sur Linux, Windows et macOS.

## Entrée de catalogue

`dist/package/catalog-entry.json` : `id`, `version`, `channel`, `contrat`,
`hote`, `permissions`, `file`, `size`, `sha256`, `signature`, `keyId`.
