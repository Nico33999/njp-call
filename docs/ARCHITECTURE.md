# NJP CALL — architecture

## 1. Chaîne de décision

```text
réplique ─► compréhension (IA ou lecture de repli) ─► état conversationnel
        ─► moteur de règles (engine.ts) ─► commande typée (commands.ts)
        ─► NJP CARE (moteur Rust : portes, validation, idempotence) ─► résultat
        ─► réponse écrite à partir du STATUT RÉEL
```

- Le modèle de langage ne produit que `Understanding` (intention, entités,
  oui/non). Il n'émet aucune commande et n'annonce aucun résultat.
- Le moteur de règles exige une **reformulation complète** et un **« oui »
  explicite** avant toute commande.
- `confirmed` n'est rendu que par NJP CARE, en mode réel, avec une référence.
  `guardResult` transforme tout autre cas en `failed`.

## 2. Commandes et statuts

`message.create`, `callback.request`, `appointment.request`,
`appointment.book`, `appointment.reschedule`, `appointment.cancel`,
`call.transfer`, `call.report`. Statuts : `simulated`, `requested`, `pending`,
`confirmed`, `refused`, `failed`, `unsupported`.

Clé d'idempotence : `callId/type/rang`, stable à travers les rejeux.

| Situation | Statut | Ce que l'appelant entend |
|---|---|---|
| aucun connecteur | `unsupported` | rien n'a été enregistré |
| simulation explicite | `simulated` | « [Simulation] aucune opération réelle » |
| NJP CARE hors ligne, message/demande | `pending` (en file) | « transmis », pas « confirmé » |
| NJP CARE hors ligne, réservation | `failed care_offline` | aucun rendez-vous pris ; proposition d'une **demande** |
| coupure après envoi | rejeu même clé, sinon `pending outcome_unknown` | jamais « rien n'a été fait » à tort |
| créneau pris entre-temps | `refused slot_unavailable` | nouvelle recherche |

## 3. Session

`core/session.ts` : journal ordonné (événements, compréhension, créneaux,
envois, résultats). Doublon d'événement ignoré ; reprise après panne par
rejeu sans rappeler ni l'IA ni NJP CARE ; commande en vol renvoyée avec la
même clé. L'horloge du moteur est celle de l'événement.

## 4. Service 24/7 et relais

Le poste NJP CARE ouvre une requête sortante authentifiée (`/v1/care/next`)
et rend chaque verdict (`/v1/care/result`). Aucun port entrant sur le poste.
Jeton par poste → un cabinet ; le service ne garde que l'empreinte.

## 5. Rendu dans NJP CARE

Le paquet est **déclaratif** (`docs/PAQUET.md`) : il ne contient pas de code.
L'espace « Secrétariat » et les enrichissements (Aujourd'hui, planning,
fiche patient) sont rendus par NJP CARE, activés par un paquet vérifié.

## 6. Réel / simulé / externe

| Élément | État |
|---|---|
| moteur de conversation, règles, session, idempotence | réel, testé |
| rappels automatiques (moteur) | réel, testé ; aucun canal SMS/voix branché |
| service HTTP, webhooks signés, relais, limites | réel, testé en local |
| écriture dans NJP CARE | réelle côté moteur Rust (dépôt njp-care) |
| fournisseur téléphonique (audio, STT, TTS) | **simulateur** ; choix externe (`TELEPHONIE.md`) |
| compréhension par IA | désactivée sans fournisseur validé ; lecture de repli |
| clé de distribution des paquets | **externe** ; clé d'essai seulement |
| hébergement du service, HDS, contrats | **externe** (`DONNEES-DE-SANTE.md`) |
