# Validations externes — ce qu'il reste à éprouver avant un pilote

> Préparation, pas exécution : aucun abonnement, aucun numéro, aucun
> déploiement n'a été pris. Rien ici ne rend le pilote possible : il faut que
> les intégrations soient réalisées et les validations réussies (§6).
> Verdict actuel : **prêt pour une recette locale, pas pour un pilote.**

## 1. Autorité des rendez-vous

Recette écrite et réussie contre le **vrai serveur** NJP CARE sur base
éphémère (26/0, `njp-care` : `npm run test:autorite`,
`desktop/docs/AUTORITE-RENDEZ-VOUS.md`). Reste à la jouer contre un serveur
de test distant isolé (§7, action A1). Bloquant : les migrations 0003, 0006,
0007 ne sont pas appliquées en production. La réservation automatique reste
**désactivée par défaut** ; les demandes à valider fonctionnent sans elle.

## 2. Fournisseurs — comparatif (sources officielles relevées le 2026-09-29)

[V] = vérifié sur source officielle ; [C] = à confirmer (commercial ou
juridique). Localisation UE ≠ hébergeur certifié HDS ≠ chaîne conforme :
la voix, la transcription et la synthèse chez l'opérateur téléphonique sont
**hors** du périmètre HDS de l'hébergeur.

### Hébergement du service et de son stockage

| | OVHcloud Public Cloud | Scaleway Instances | Clever Cloud (PaaS) |
|---|---|---|---|
| HDS | [V] instances, block/object storage cités (HDS v2018) ; [C] gammes éligibles (d2 ?), région | [V] instances, block/object storage cités ; [C] gammes éligibles | [V] zones `parhds`/`grahds` ; [C] disque persistant (FS Buckets) éligible ? |
| Localisation | [V] région FR à choisir | [V] France | [V] France |
| DPA art. 28 | [V] publié | [V] DPA 2024 publié | [C] non trouvé |
| Contrat HDS | [V] Healthcare Addendum + option HDS | [V] via le commercial | [V] contrat spécifique |
| Support imposé pour HDS | [V] Business : 10 %, **min. 250 € HT/mois** | [V] Business : **250 € HT/mois** min. | non indiqué |
| Plus petite config (HT) | [V] d2-2 5,71 €/mois ; block 0,04307 €/Go/mois ; sauvegarde 0,01095 €/Go/mois | [V] DEV1-S 6,55 €/mois ; block 0,086 €/Go/mois ; IPv4 0,005 €/h | [V] supplément HDS **200 €/mois + coef. 1,4** ; [C] prix de base |
| Engagement | [V] à l'heure (d2) | [V] à l'heure | [V] à la seconde |

La liste ANS des hébergeurs certifiés n'a pas pu être lue (protection
anti-robot) : aucun certificat n'a été vérifié à la source. Sources :
ovhcloud.com (certification HDS, contrats, niveaux de support, tarifs Public
Cloud), docs.ovhcloud.com (certification HDS), scaleway.com (HDS, DPA,
assistance, tarifs), clever.cloud (health-hds, tarifs).

### Téléphonie entrante française

| | Twilio Programmable Voice | Telnyx (TeXML / Call Control) | Vonage Voice API |
|---|---|---|---|
| Numéro FR | [V] Kbis, adresse FR, SIREN/SIRET ; 1,35 $/mois | [V] identité + justificatif ; [C] prix FR (« from $1 ») | [C] page tarifs inaccessible (403) |
| Entrant | [V] 0,0100 $/min | [C] tarif FR | [C] |
| STT fr-FR | [V] `<Gather>` fr-FR ; 0,02 $ par utilisation ([C] définition exacte) | [V] prix publiés ; [C] fr-FR | [V] fr-FR ; [C] prix |
| TTS | [V] neural 0,0032 $/100 car. | [V] prix au caractère | [C] |
| Signature webhooks | [V] `X-Twilio-Signature` (HMAC-SHA1) | [V] Ed25519 horodaté | [V] JWT HS256 |
| Enregistrement | [V] non par défaut (`<Dial>`) | [C] | [C] |
| Traitement UE | [V] région IE1 avec exclusions ; **pas** « UE uniquement » | [V] STT/TTS Paris/Francfort sur option `data_boundary: EU` | [V] régions Dublin/Francfort ; [C] exclusivité |
| DPA / santé | [V] DPA ; données de santé = « Sensitive Data » | [V] DPA : **n'entend pas traiter** de données sensibles | [C] |
| HDS | aucune mention | aucune mention | aucune mention |
| Essai | [V] 75 min, pays d'inscription, destinataires vérifiés ; [C] numéro FR en essai | [C] | [C] |

OVHcloud Telecom écarté : pas d'API vocale à webhooks ni de STT/TTS publiés.
Sources : twilio.com (guidelines FR, tarifs voix FR, docs Gather/Dial/
sécurité/infrastructure, DPA, essai), telnyx.com (tarifs FR, Europe, DPA,
exigences numéros FR), developer.vonage.com (ASR, webhooks, régions).

### Recommandation

- **Recette téléphonique (données fictives) : Twilio**, seul dont tous les
  prix France sont publiés, + hébergement **non HDS** en France pour la
  seule durée de la recette (aucune donnée réelle n'y transite).
- **Pilote avec de vrais appelants : hébergement HDS** (OVHcloud ou
  Scaleway, contrat HDS signé) **et** avis juridique sur l'opérateur : aucun
  ne documente de certification HDS, Twilio ne garantit pas un traitement
  exclusivement UE, et le DPA de Telnyx exclut les données sensibles.
  Telnyx (option UE) est l'alternative à étudier.

### Scénario de test chiffré (hypothèses explicites)

1 numéro FR, 1 mois, 50 appels de 3 min, 6 reconnaissances vocales par appel,
1 500 caractères de synthèse neurale par appel, transferts non comptés.

| Poste | Calcul | Montant |
|---|---|---|
| Numéro Twilio | | 1,35 $ |
| Minutes entrantes | 150 × 0,0100 $ | 1,50 $ |
| STT | 300 × 0,02 $ | 6,00 $ |
| TTS neural | 750 × 0,0032 $ | 2,40 $ |
| **Téléphonie** | | **11,25 $** |
| Hébergement de recette non HDS (OVHcloud d2-2 + 10 Go + sauvegarde) | 5,71 + 0,43 + 0,11 € | **≈ 6,25 € HT** |
| *Pour mémoire : même hébergement en HDS (support Business imposé)* | + 250 € | *≈ 256,25 € HT/mois* |

Taxes et change non inclus. [C] prix de l'option HDS elle-même, non publié.

## 3. Première recette téléphonique réelle

Objectif : **un appel réel**, participants volontaires, données fictives :
appel entrant → annonce de l'automatisation → message ou demande de
rendez-vous → réception dans NJP CARE → traitement visible. IA et rappels
sortants **désactivés**. Un appel simulé n'est jamais présenté comme réel.

### Branchement Twilio (à réaliser, pas fait)

| Élément | Décision |
|---|---|
| Adaptateur | `TwilioInbound implements TelephonyInbound` (`service/inbound.ts`), environnement `provider_sandbox` puis `production` |
| Route | `POST /v1/telephony/twilio/webhook` (formulaire `application/x-www-form-urlencoded`) |
| Signature | `X-Twilio-Signature` : HMAC-SHA1 de l'URL publique exacte + paramètres triés, secret = jeton d'authentification du compte (coffre de secrets) ; refus sinon |
| Événements | 1er webhook (`CallStatus=ringing/in-progress`) ⇒ `call.started` ; `SpeechResult` ⇒ `caller.utterance` ; `Digits` ⇒ `caller.dtmf` ; pas de parole à l'échéance ⇒ `caller.silence` ; `DialCallStatus` ⇒ `transfer.result` ; `StatusCallback` `completed` ⇒ `call.ended` |
| Identifiant d'événement | Twilio n'en fournit pas par tour : `CallSid` + numéro de tour porté par l'URL d'action (`?t=N`) — un rejeu du même tour garde le même identifiant, donc la même réponse (rejeu explicite) |
| Réponse | TwiML : `<Say language="fr-FR">` + `<Gather input="speech dtmf" language="fr-FR" action="…?t=N+1" timeout="5">` ; `<Dial>` vers la référence de destination résolue côté service ; `<Hangup/>` |
| Enregistrement | jamais demandé (aucun `record`) |
| Numéro routé | `NJP_CALL_NUMBER_ROUTES=+33…=<cabinet de test>` |
| Banc de contrat | `tests/provider-contract.test.ts` joué contre l'adaptateur **avant** tout appel réel |

### Critères de réussite

| # | Scénario | Réussi si |
|---|---|---|
| 1 | Appel, message | annonce « assistante automatisée » entendue ; message relu et confirmé ; message visible une fois dans NJP CARE, verbatim exact |
| 2 | Appel, demande de rendez-vous (réservation désactivée) | « demande transmise, pas encore confirmée » ; demande « à valider » dans NJP CARE ; agenda inchangé |
| 3 | Touche 0 | transfert vers la destination de test, ou prise de message si échec |
| 4 | Doublon de webhook (rejeu forcé via l'URL) | même réponse, aucun second message |
| 5 | Coupure réseau du service pendant l'appel (arrêt 10 s) | le fournisseur rejoue ; l'appel reprend ou se termine proprement ; aucun doublon |
| 6 | Poste NJP CARE éteint pendant l'appel | « transmise » ; message remis UNE fois au rallumage |
| 7 | Redémarrage brutal du service entre deux appels | aucune perte ; relève reprise seule |
| 8 | Raccrochage avant « oui » | rien d'enregistré ; compte rendu « abandonné » |
| 9 | Silence ×3 | fin propre annoncée |
| 10 | Journaux | aucun numéro, nom ou propos ; `/healthz` sans contenu |

## 4. CI — état constaté, sans relance

- njp-call : https://github.com/Nico33999/njp-call/actions/runs/36600503160
  (et 36600496981). Jobs créés, **jamais attribués à un exécuteur**
  (`runner_id: 0`, ~3 s, aucune étape, journaux 404).
- njp-care : https://github.com/Nico33999/njp-care/actions/runs/36601727834
  (et 36601689876). `startup_failure`, pseudo-workflow « BuildFailed » ;
  également sur la branche de base depuis l'exécution 23.
- `actionlint` 1.7.7 : aucune erreur dans les deux dépôts. **Cause
  indéterminée** tant qu'un message GitHub explicite ne la montre pas.

À capturer (connecté en propriétaire) : la bannière en tête de chaque page
d'exécution ci-dessus (texte complet), le détail d'un job njp-call, et les
écrans **Settings → Actions → General** (« Actions permissions » et
« Workflow permissions ») et **Settings → Billing and plans** (usage et
plafond Actions). Aucune relance en attendant.

## 5. Validations natives Windows et macOS

Trois niveaux, jamais confondus :

| Niveau | Windows x64 | macOS |
|---|---|---|
| Compilation | workflow `windows-commissioning` (manuel) — bloqué par la CI | non préparé : `desktop/docs/MACOS-PLAN.md` (prérequis Apple, signature) |
| Lancement de l'application | kit d'essai + `kit-validation-windows/PROTOCOLE.md` §5.1 | après signature et notarisation |
| Parcours utilisateur | protocole N → N+1 + parcours NJP CALL ci-dessous | idem, après les deux niveaux précédents |

Parcours NJP CALL à ajouter au protocole Windows (poste réel, données
fictives) : installation du paquet d'essai depuis le Store ; consentement
(réservation décochée) ; saisie du relais ; relève de fond visible dans les
réglages ; message reçu pendant que l'espace Secrétariat est fermé ;
verrouillage du coffre (relève en attente) ; mise en veille et réveil
(reconnexion) ; désactivation ; désinstallation (jeton révoqué). Rien de cela
n'a été exécuté nativement : les compilations faites ici sont Linux.

## 6. Conditions avant un pilote

| # | Condition | État |
|---|---|---|
| 1 | Autorité des rendez-vous validée contre un serveur de test distant, puis production migrée (0003/0006/0007) — sinon réservation désactivée | locale ✔ ; distante ✖ ; production ✖ |
| 2 | Téléphonie réelle testée (§3, 10 critères), adaptateur au banc de contrat | ✖ |
| 3 | Hébergement approuvé (HDS si données réelles), contrat signé, TLS | ✖ |
| 4 | Sauvegarde **restaurée** sur l'environnement cible (`pnpm store:backup` / `store:verify`, puis redémarrage sur la copie) | local ✔ ; cible ✖ |
| 5 | CI exécutée et verte ; parcours natifs Windows (et macOS si visé) | ✖ |
| 6 | Information des appelants validée (texte `FLUX-DE-DONNEES.md` §4), AIPD, contrats art. 28, avis sur l'opérateur | ✖ |
| 7 | Procédure d'arrêt et de retour à l'accueil humain (§6 bis) répétée une fois | ✖ |
| 8 | Canal « essai » seul ; aucune clé officielle ni catalogue public sans accord | ✔ |

### 6 bis. Arrêt du service et retour à un accueil humain

1. **Chez l'opérateur** (effet immédiat, indépendant du service) : basculer
   le numéro du cabinet vers la ligne habituelle (renvoi) ou une annonce
   « accueil fermé, rappelez / urgences 15-112 ». À préparer et tester avant
   le pilote.
2. **Service** : `systemctl stop njp-call` (arrêt propre, file conservée).
3. **Poste** : désactiver NJP CALL (le service le sait à la déclaration
   suivante) ; les messages déjà reçus restent dans l'espace Secrétariat.
4. **Reprise** : vérifier `/healthz`, redémarrer, rebasculer le numéro,
   passer un appel de contrôle.
5. Critère : moins de 5 min entre la décision et le premier appel reçu par
   un humain.

## 7. Ce qui est attendu du propriétaire

- **A1** — Un serveur NJP CARE de **test** isolé (migrations 0003/0006/0007)
  et deux comptes synthétiques (capacité 1) ; lancer
  `NJP_AUTHORITY_ORIGIN=… npm run test:autorite` ou me fournir ces accès par
  variables d'environnement. Et la décision sur la migration de production.
- **A2** — Accord pour un compte Twilio (essai puis payant), l'achat d'**un**
  numéro FR de test (Kbis/SIREN à fournir à Twilio) et un hébergement de
  recette non HDS (~6 € HT/mois + ~11 $ de téléphonie pour 50 appels).
- **A3** — Choix de l'hébergeur HDS pour le pilote (OVHcloud ou Scaleway),
  qui entraîne ~250 € HT/mois de support imposé ; avis juridique sur
  l'opérateur téléphonique et les données de santé.
- **A4** — Captures GitHub du §4.
- **A5** — Un poste Windows de recette (et un Mac si visé) pour les parcours
  natifs du §5.
