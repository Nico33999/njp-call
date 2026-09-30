# NJP CALL — by NJP CARE

La **secrétaire vocale automatisée** du cabinet, distribuée comme **extension
officielle** depuis le NJP CARE STORE. Elle répond aux appels, s'annonce comme
assistante automatisée, prend messages, demandes de rappel et demandes de
rendez-vous, propose des créneaux réellement autorisés, et n'annonce une
opération qu'après confirmation par NJP CARE.

NJP CARE reste l'autorité (cabinet, utilisateur, permissions, patients,
planning, messages). NJP CALL ne crée ni fichier patients, ni agenda, ni
authentification.

```text
dépôt NJP CALL ──► paquet .njpx versionné et signé ──► NJP CARE STORE
                                                         │ installation, permissions, activation
                                                         ▼
                                  NJP CARE : espace « Secrétariat », Aujourd'hui, planning…
opérateur du cabinet ── SIP/RTP ──► POSTE D'ACCUEIL (NJP CARE) : voix locale, moteur, coffre
```

**Cible : traitement au poste du cabinet.** Les appels sont décrochés,
compris et enregistrés **dans NJP CARE**, sur un poste du cabinet : ligne SIP
de l'opérateur existant, reconnaissance vocale locale, moteur de conversation
porté en Rust, journal au coffre. Aucun serveur NJP CALL, aucun service d'IA
externe. Ce dépôt reste la **référence** du moteur : `contract/conformance/`
exporte 39 appels et un corpus de langue que le port Rust de NJP CARE doit
reproduire à l'identique (`pnpm conformance:check`). Le `service/` est un outil
de recette, pas la cible. Détails, flux sortants et limites : NJP CARE
`desktop/docs/NJP-CALL-POSTE-LOCAL.md`.

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `core/` | moteur pur : commandes typées, passerelles, conversation, règles, session, dates Europe/Paris, urgences, rappels, téléphonie abstraite |
| `service/` | **outil de recette** (ancien mode hébergé, non recommandé) — service 24/7 : stockage durable chiffré, webhooks signés, relais à bail vers le poste, déclaration du poste, limites, journaux expurgés, IA optionnelle (approuvée) |
| `deploy/` | gabarits d'exploitation (unité systemd, environnement sans valeur) — rien n'est déployé |
| `client/` | configurateur et **banc de recette** (simulation explicite, rien n'est réel) |
| `extension/` | manifeste Store (contrat NJP CARE v2) et surfaces déclarées |
| `scripts/` | construction, signature, vérification du paquet ; détection de secrets ; fixtures de contrat |
| `contract/fixtures/` | enveloppes réellement émises par des appels simulés, rejouées par les tests Rust de NJP CARE |
| `contract/conformance/` | appels et corpus de langue du moteur de référence, que le port Rust de NJP CARE doit reproduire à l'identique |
| `keys/` | clé **publique** d'essai. Aucune clé privée. |
| `docs/` | architecture, contrat NJP CARE, paquet, téléphonie, exploitation, flux de données, données de santé, validations externes avant pilote |

## Commandes

```bash
pnpm install --frozen-lockfile
pnpm typecheck        # navigateur + moteur + service + scripts
pnpm test             # vitest (aucun appel réseau réel, aucune donnée réelle)
pnpm build            # configurateur
pnpm package:build    # dist/package/njp.call-<version>.njpx (+ .minisig si NJP_CALL_SIGNING_KEY_FILE)
pnpm package:verify
pnpm check:secrets
pnpm ci               # tout ce qui précède
pnpm store:backup <fichier>   # sauvegarde à chaud du stockage (NJP_CALL_DB_PATH)
pnpm store:verify <fichier>   # vérifie une sauvegarde (NJP_CALL_STORAGE_KEY)
```

## Ce qui est réel, ce qui est simulé

Voir `docs/ARCHITECTURE.md` §6. En bref : le moteur, le service, le relais et
le paquet signé sont réels et testés ; le fournisseur téléphonique, le
fournisseur d'IA et la clé de distribution sont des **décisions externes**
non prises. Aucune conformité réglementaire n'est déclarée.
