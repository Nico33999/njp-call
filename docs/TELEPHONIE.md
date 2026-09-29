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
