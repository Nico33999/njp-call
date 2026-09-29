# Téléphonie

## Ce qui est construit

- Événements neutres (`call.started`, `caller.utterance` avec interruption et
  confiance, `caller.dtmf`, `caller.silence`, `transfer.result`, `call.ended`).
- `TelephonyProvider` : `say` (interruptible), `transfer` (vers une
  **référence** de destination, résolue côté service), `hangup`.
- Simulateur de banc : scénarios, doublons de webhook, silences, DTMF,
  transfert réussi/échoué, raccrochage.
- Service : webhooks HMAC horodatés, sérialisation par appel, reprise.
- Comportements : silence ×3 ⇒ fin propre ; touche 0 ⇒ humain ; numéro tapé ;
  transfert échoué ⇒ prise de message ; raccrochage avant « oui » ⇒ rien
  d'exécuté, compte rendu « abandoned ».

## Audio

Aucun audio n'est conservé par défaut. Toute conservation future exigera une
finalité, une durée, une information des appelants et une base juridique.

## Choix du fournisseur : décision externe restante

Aucun fournisseur réel n'est intégré. Critères à vérifier contractuellement
(`core/telephony.ts`, `PROVIDER_REQUIREMENTS`) : flux audio bidirectionnel avec
interruption, STT français en flux avec confiance, DTMF et silences, transfert
avec compte rendu, webhooks signés, aucun enregistrement par défaut,
traitement et stockage dans l'UE, compatibilité HDS si des données de santé
transitent, contrat article 28 et liste des sous-traitants ultérieurs,
portabilité du numéro du cabinet.

## Environnements, jamais confondus

| Environnement | Adaptateur | État |
|---|---|---|
| simulateur | `SimulatorInbound` (`service/inbound.ts`) | bancs et recette |
| bac à sable du fournisseur | adaptateur du fournisseur, compte d'essai | à écrire après choix |
| exploitation | même adaptateur, compte contractuel | `NJP_CALL_MODE=operationnel` refuse de démarrer tant qu'il n'existe pas |

## Ce qu'il faut pour un premier fournisseur

1. Le choix (critères ci-dessus) et les contrats (art. 28, localisation UE,
   aucun enregistrement par défaut).
2. Un adaptateur `TelephonyInbound` (vérification de signature du
   fournisseur, traduction de ses webhooks en événements neutres, rendu de
   la réponse dans son format) + l'implémentation `TelephonyProvider`
   (`say`, `transfer`, `hangup`) si le fournisseur est piloté par API.
3. Le passage du banc `tests/provider-contract.test.ts` (signature absente,
   fausse, altérée, périmée ; chaque événement ; refus du reste ; rendu),
   d'abord contre le bac à sable du fournisseur.
4. Délais et doublons : chaque webhook est rejouable (l'identifiant
   d'événement fait foi) ; un webhook sans réponse est rejoué par le
   fournisseur et reçoit la MÊME réponse (rejeu explicite) ; indisponibilité
   du service = le fournisseur doit basculer sur une annonce ou une
   messagerie (à configurer chez lui).
5. Un numéro de test, jamais le numéro réel d'un cabinet, jusqu'à la recette.

## Rappels SMS / voix

Moteur prêt (`core/reminders.ts`) ; aucun canal branché. États distingués :
`sent` (accepté par le prestataire), `delivered` (remis au téléphone),
`answered` (décroché), `voicemail`, `confirmed_by_patient` (réponse
explicite) — un répondeur ne vaut jamais confirmation. Envoi suspendu sans
déclaration fraîche du poste ; rappel rendu obsolète si le rendez-vous change
de version ou d'horaire (revérifié juste avant l'envoi). Issue inconnue
(délai après envoi) : jamais de second envoi automatique. Contrat de canal :
`tests/provider-contract.test.ts`.
