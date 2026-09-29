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
service NJP CALL 24/7 ◄──── relais authentifié (le poste se connecte) ────► moteur Rust NJP CARE
```

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `core/` | moteur pur : commandes typées, passerelles, conversation, règles, session, dates Europe/Paris, urgences, rappels, téléphonie abstraite |
| `service/` | service 24/7 : webhooks signés, relais vers le poste, limites, journaux expurgés, IA optionnelle |
| `client/` | configurateur et **banc de recette** (simulation explicite, rien n'est réel) |
| `extension/` | manifeste Store (contrat NJP CARE v2) et surfaces déclarées |
| `scripts/` | construction, signature, vérification du paquet ; détection de secrets ; fixtures de contrat |
| `contract/fixtures/` | enveloppes réellement émises par des appels simulés, rejouées par les tests Rust de NJP CARE |
| `keys/` | clé **publique** d'essai. Aucune clé privée. |
| `docs/` | architecture, paquet, téléphonie, données de santé |

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
```

## Ce qui est réel, ce qui est simulé

Voir `docs/ARCHITECTURE.md` §6. En bref : le moteur, le service, le relais et
le paquet signé sont réels et testés ; le fournisseur téléphonique, le
fournisseur d'IA et la clé de distribution sont des **décisions externes**
non prises. Aucune conformité réglementaire n'est déclarée.
