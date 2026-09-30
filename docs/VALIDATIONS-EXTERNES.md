# Validations externes — ce qu'il reste à éprouver avant un pilote

> **Cible actuelle : traitement au poste du cabinet.** Depuis le passage au traitement au poste, l'hébergement, le fournisseur de voix programmable et le fournisseur d'IA ne sont plus des prérequis. Les validations qui restent pour la cible sont listées dans NJP CARE `desktop/docs/NJP-CALL-POSTE-LOCAL.md` §8 et §10.

> Préparation, pas exécution : aucun compte payant, numéro, contrat ou
> hébergement n'a été pris. Rien ici ne rend le pilote possible : il faut que
> les intégrations soient réalisées et les validations réussies (§6).
> Verdict actuel : **prêt pour une recette locale, pas pour un pilote.**

## 0. Les étapes, séparées

| Étape | Données | Réservation automatique | État |
|---|---|---|---|
| 1. Recette locale (serveur NJP CARE réel, base dédiée) | fictives | activée sur le coffre du banc seulement | **faite** : `njp-care` `npm run recette:*` et `test:autorite` |
| 2. Recette distante isolée (VM dédiée, tunnel SSH) | fictives | idem | préparée (`njp-care/desktop/docs/RECETTE-ISOLEE.md`) ; VM à fournir |
| 3. Premier appel téléphonique de test | fictives, volontaires | **désactivée** | plan §3 ; opérateur à accorder |
| 4. Pilote avec de vrais appelants | réelles | désactivée tant que l'étape 2 n'a pas réussi contre le serveur du pilote | conditions §6 |
| 5. Production | réelles | selon validation | diagnostic de production puis autorisation distincte |

Une migration de la production **n'est pas** un prérequis des étapes 1 à 3.

## 1. Autorité des rendez-vous

- Éprouvée contre le **vrai serveur** NJP CARE sur base dédiée : `npm run
  test:autorite` (27/0 base éphémère ; 25/0 × 3 sur un même environnement de
  recette, avant et après redémarrage).
- **État de la production : non vérifié.** Les en-têtes des migrations
  disent ce qui a été décidé, pas ce que contient la base. Diagnostic
  structurel en lecture seule prêt (`njp-care/desktop/docs/DIAGNOSTIC-SCHEMA.md`,
  `npm run diagnostic:schema`, éprouvé 15/0) ; à exécuter par le propriétaire.

## 2. Fournisseurs (sources officielles, consultées le 2026-09-29)

[V] vérifié sur page officielle ; [AC] à confirmer (aucune preuve officielle
trouvée). Certification d'un fournisseur ≠ périmètre certifié ≠ services
commandés ; localisation UE ≠ HDS ≠ conformité de la chaîne.

### Hébergement

| | OVHcloud Public Cloud | Scaleway Instances |
|---|---|---|
| Support payant pour HDS | [V] **obligatoire** : « Les clients utilisant des produits HDS doivent souscrire un support Business ou Enterprise » [1][2] ; périmètre exact (compte ou service) [AC] | [V] **obligatoire** pour le Public Cloud [5] |
| Prix du support Business | [V] max(250 € HT, 10 % de la facture) [4] | [V] max(250 € HT, 10 % des dépenses nettes) [6] |
| Périmètre certifié | [V] Public Cloud Instances, Block/Object/Cold Storage, bases managées… (doc du 2026-06-02) [1] ; gammes d2/b3, régions, sauvegardes d'instance/volume [AC] | [V] Instances, Block/Object Storage, VPC, Load Balancer, Kapsule, Elastic Metal, Dedibox ; activités 1–4 pour Instances/stockage ; France seulement [5] ; types de VM éligibles [AC] |
| Version HDS | [V] « HDS v2018 », 2024 « doit être mise en place en 2024 » (texte probablement périmé) [1] ; en vigueur [AC] | [AC] |
| Certificat | [V] remis sur demande [3] | [AC] |
| Démarches | [V] case HDS sur le projet + conditions particulières [2] ; frais de l'option [AC] | [V] contrat HDS par le commercial, avenant par nouveau produit [5] ; frais Public Cloud [AC] |
| Block Storage HDS | [AC] | [V] volume neuf, fr-par-1/2/3, chiffré par le client, pas d'export de snapshot hors HDS [8] |

Pour la recette (données fictives), **HDS n'est pas nécessaire** : le
support imposé ne s'applique qu'aux produits HDS.

### Téléphonie entrante française

| | Twilio | Telnyx | Vonage |
|---|---|---|---|
| Numéro FR | [V] géographique (+331–5) et national (+339), particulier ou entreprise ; adresse en France ; entreprise : K-bis, justificatif, RCS/SIREN [13] ; même zone que l'indicatif [AC] ; délai [AC] | [V] adresse FR (< 3 mois), identité ou immatriculation, présence en France, **usage professionnel seulement**, ~72 h [14] | [AC] (pages inaccessibles, 403) |
| Essai | [V] 30 j, 75 min, appels vers 5 numéros vérifiés, pays d'inscription ; `<Say>`/`<Gather>` parole autorisés ; **`<Dial><Number>`, `<Stream>`, `<Record>` bloqués** ; plusieurs numéros après upgrade [15][16] ; numéro FR réglementé en essai [AC] | [V] 5 $ ; un seul numéro local du pays du compte ; entrants limités au numéro vérifié, 10 min ; **message automatique préfixé** [17] | [V] 2 € de crédit, mode DEMO [18] ; le reste [AC] |
| Lieu de traitement | [V] région IE1 possible pour la voix ; la STT `<Gather>` va au fournisseur « in the region where the Twilio account is homed … where possible » avec repli sur des points « often serviced in the US » ⇒ **pas de garantie UE stricte** [19][20] ; sous-traitants STT/TTS : AWS, Google, Deepgram (USA, traitement régional si région Twilio) [21] ; TTS [AC] | [V] voix via `api.telnyx.eu` / Francfort, Londres, Amsterdam [23] ; « Data Locality » UE = stockage au repos seulement [22] ; lieu de STT/TTS en appel [AC] ; sous-traitants Google, AWS, Microsoft (USA) [25] | [V] région UE Dublin, repli Francfort [26] ; STT Deepgram/Google [27] ; lieu [AC] |
| Prix France | [V] numéro 1,35 $/mois ; entrant 0,0100 $/min ; STT 0,02 $ par « use » (définition [AC]) ; TTS neural 0,0032 $/100 car. [29][30] | [V] tarifs « à partir de » (FR réel [AC]) : numéro ~1 $, entrant 0,002 $ + SIP 0,0032 $/min, STT 0,005–0,017 $/min, TTS Polly neural 0,000024 $/car. [31][32] | [AC] |
| Données de santé | [V] « Sensitive Data » inclut la santé ; garanties à la charge du client avant transmission [33] | [V] idem [34] ; interdites dans les « Storage Services » [35] | [AC] |
| HDS | aucune mention | aucune mention | aucune mention |

**Recommandation.**
- **Étape 3 (données fictives) : Twilio**, pour la seule raison que ses prix
  France et ses règles d'essai sont publiés. Avec une limite : le transfert
  vers un numéro (`<Dial><Number>`) n'est pas testable en essai. Le scénario
  « touche 0 » demande donc un compte payant, ou il est reporté.
- **Étape 4** : hébergement HDS (OVHcloud ou Scaleway, support Business
  obligatoire), et **avis juridique** sur l'opérateur. Aucun opérateur ne
  documente de certification HDS ni de traitement STT/TTS garanti dans
  l'UE.

### Budgets (HT, hors taxes et change, hypothèses explicites)

**(i) Recette synthétique** — 1 numéro FR, 1 mois, 50 appels × 3 min,
6 reconnaissances et 1 500 caractères de synthèse par appel :

| Poste | Montant |
|---|---|
| Twilio : 1,35 + 150 × 0,01 + 300 × 0,02 + 750 × 0,0032 | ≈ 11,25 $ |
| VM de recette sans HDS : OVHcloud d2-2 + IPv4 (à partir du 01/10/2026) | ≈ 7,68 € |
| **Total** | **≈ 20 €** (≈ 17–21 € selon l'hébergeur) |

**(ii) Pilote estimatif** — 1 cabinet, 1 mois, 600 appels × 2,5 min, mêmes
ratios :

| Poste | Montant |
|---|---|
| Twilio : 1,35 + 1 500 × 0,01 + 3 600 × 0,02 + 9 000 × 0,0032 | ≈ 117 $ |
| Hébergement HDS minimal (VM + IPv4 + sauvegarde + support Business 250 €) | ≈ 258 € (OVHcloud) / ≈ 262 € + frais de contrat (Scaleway) |
| **Total** | **≈ 360 € / mois**, dont ~70 % de support imposé |

**(iii) Inconnus ou sur devis** : frais de l'option ou du contrat HDS ;
éligibilité HDS des plus petites VM et des sauvegardes ; version HDS en
vigueur ; définition du « use » STT Twilio ; délais d'attribution des
numéros ; tarifs Telnyx France réels ; tous les tarifs Vonage ; avis
juridique (voix et STT/TTS de santé chez l'opérateur) ; AIPD.

Sources : [1] docs.ovhcloud.com/fr/guides/account-and-service-management/account-information/hds-certification
· [2] docs.ovhcloud.com/fr/guides/public-cloud/cross-functional/activate-hds-certification
· [3] ovhcloud.com/fr/enterprise/certification-conformity/hds/
· [4] ovhcloud.com/fr/support-levels/business/
· [5] scaleway.com/fr/security-and-compliance/hds/
· [6] scaleway.com/fr/assistance/
· [8] scaleway.com/en/docs/block-storage/how-to/host-healthcare-data/
· [13] twilio.com/en-us/guidelines/fr/regulatory
· [14] support.telnyx.com/en/articles/1311445-france-did-requirements
· [15] twilio.com/docs/usage/trials
· [16] twilio.com/docs/usage/trials/try-out-voice
· [17] developers.telnyx.com/docs/account-setup/levels-and-capabilities/trial
· [18] developer.vonage.com/en/account/guides/dashboard-management
· [19] twilio.com/docs/global-infrastructure/regional-product-and-feature-availability
· [20] twilio.com/docs/voice/twiml/gather
· [21] twilio.com/en-us/legal/sub-processors
· [22] developers.telnyx.com/docs/account-setup/data-locality
· [23] developers.telnyx.com/docs/voice/programmable-voice/voice-api-services-in-europe
· [25] telnyx.com/legal/subprocessors
· [26] developer.vonage.com/en/voice/voice-api/concepts/regions
· [27] developer.vonage.com/en/voice/voice-api/concepts/asr
· [29] twilio.com/en-us/voice/pricing/fr
· [30] assets.cdn.prod.twilio.com/pricing-csv/SiteNumbersPricing.csv
· [31] telnyx.com/pricing/call-control
· [32] telnyx.com/pricing/elastic-sip
· [33] twilio.com/en-us/legal/data-protection-addendum
· [34] telnyx.com/legal/data-processing-addendum
· [35] telnyx.com/terms-and-conditions-of-service — toutes consultées le 2026-09-29.
Inaccessibles (403) : les pages tarifs et juridiques de vonage.com.

## 3. Premier appel téléphonique de test

Objectif : **un appel réel**, participants volontaires, données fictives :
appel entrant → annonce de l'automatisation → message ou demande de
rendez-vous → réception dans NJP CARE → traitement visible. IA et rappels
sortants **désactivés** ; réservation **désactivée**. Service sur la VM de
recette (étape 2). Un appel simulé n'est jamais présenté comme réel.

### Branchement Twilio (à réaliser, pas fait)

| Élément | Décision |
|---|---|
| Adaptateur | `TwilioInbound implements TelephonyInbound` (`service/inbound.ts`), environnement `provider_sandbox` |
| Route | `POST /v1/telephony/twilio/webhook` (formulaire urlencodé), exposée par un frontal TLS de la VM |
| Signature | `X-Twilio-Signature` : HMAC-SHA1 de l'URL publique exacte + paramètres triés ; secret = jeton du compte (coffre de secrets) |
| Événements | 1er webhook ⇒ `call.started` ; `SpeechResult` ⇒ `caller.utterance` ; `Digits` ⇒ `caller.dtmf` ; échéance sans parole ⇒ `caller.silence` ; `DialCallStatus` ⇒ `transfer.result` ; `StatusCallback completed` ⇒ `call.ended` |
| Identifiant d'événement | `CallSid` + numéro de tour dans l'URL d'action (`?t=N`) : un rejeu du même tour ⇒ même identifiant ⇒ même réponse |
| Réponse | TwiML `<Say language="fr-FR">` + `<Gather input="speech dtmf" language="fr-FR" action="…?t=N+1">` ; `<Dial>` (hors essai) ; `<Hangup/>` ; jamais `record` |
| Banc de contrat | `tests/provider-contract.test.ts` contre l'adaptateur **avant** tout appel |

### Critères de réussite

| # | Scénario | Réussi si |
|---|---|---|
| 1 | Message | annonce « assistante automatisée » entendue ; message relu, confirmé, visible une fois dans NJP CARE |
| 2 | Demande de rendez-vous | « transmise, pas encore confirmée » ; demande « à valider » ; agenda inchangé |
| 3 | Touche 0 | transfert (compte payant) ou prise de message |
| 4 | Doublon de webhook | même réponse, aucun second message |
| 5 | Coupure du service 10 s pendant l'appel | rejeu du fournisseur ; aucun doublon ; fin propre |
| 6 | Poste éteint pendant l'appel | « transmise » ; remis une fois au rallumage |
| 7 | Redémarrage brutal du service entre deux appels | aucune perte ; relève reprise seule |
| 8 | Raccrochage avant « oui » | rien d'enregistré |
| 9 | Silence × 3 | fin propre annoncée |
| 10 | Journaux | aucun numéro, nom ni propos |

## 4. CI — état constaté, sans relance

- njp-call : https://github.com/Nico33999/njp-call/actions/runs/36600503160
  — jobs jamais attribués à un exécuteur (`runner_id: 0`, ~3 s, aucune étape,
  journaux 404).
- njp-care : https://github.com/Nico33999/njp-care/actions/runs/36601727834
  — `startup_failure`, pseudo-workflow « BuildFailed » ; aussi sur la base
  depuis l'exécution 23.
- `actionlint` 1.7.7 : aucune erreur. **Cause indéterminée ; tests locaux
  réussis.** Un échec avant toute étape et des journaux absents ne prouvent
  pas que l'exécuteur (runner) en soit la cause : ni lui, ni le workflow,
  ni un réglage du compte n'est désigné sans message GitHub explicite. Captures demandées : bannière de chaque exécution,
  Settings → Actions → General, Settings → Billing and plans.

## 5. Validations natives Windows et macOS

`njp-care` : `node scripts/recette-native.mjs` (avec `NJP_CALL_DIR`) joue
sur la machine où il est lancé tous les niveaux automatisables et imprime
ce qui exige un humain. Répétition Linux : 9 réussies, 0 non jouée.

| Niveau | Machine native nécessaire ? | Comment |
|---|---|---|
| A. Compilation moteur et shell | oui (chaîne native) | script, niveau A ; Windows aussi par `windows-commissioning` |
| B. Moteur : coffre, relais, autorité, HTTPS, poste ↔ service | oui pour prouver le natif (SQLCipher, TLS, PostgreSQL local : `PGBIN` sous Windows) | script, niveau B |
| C. Lancement de l'application et parcours (11 points : installation, relève visible, veille, verrouillage, coupure réseau, désactivation, désinstallation, sortie) | **oui, avec un humain** ; macOS après signature/notarisation (`MACOS-PLAN.md`) | liste imprimée par le script, rapport JSON à joindre |

## 6. Conditions avant un pilote

| # | Condition | État |
|---|---|---|
| 1 | Autorité validée sur l'environnement distant isolé, PUIS contre le serveur du pilote (diagnostic de schéma compatible) — sinon réservation désactivée | locale ✔ ; distante ✖ ; serveur du pilote ✖ |
| 2 | Téléphonie réelle testée (§3), adaptateur au banc de contrat | ✖ |
| 3 | Hébergement approuvé (HDS), contrat signé, TLS | ✖ |
| 4 | Sauvegarde restaurée sur l'environnement cible (`store:backup` / `store:verify`) | local ✔ ; cible ✖ |
| 5 | CI exécutée et verte ; niveaux A–C natifs | Linux A–B ✔ ; natif ✖ ; CI ✖ |
| 6 | Information des appelants, AIPD, contrats art. 28, avis sur l'opérateur | ✖ |
| 7 | Arrêt et retour à l'accueil humain répété une fois (§6 bis) | ✖ |
| 8 | Canal « essai » seul ; aucune clé officielle ni catalogue public | ✔ |

### 6 bis. Arrêt du service et retour à un accueil humain

1. Chez l'opérateur : basculer le numéro vers la ligne habituelle, ou vers
   une annonce qui invite à rappeler et rappelle 15/112 en cas d'urgence.
   C'est immédiat et indépendant du service.
2. `systemctl stop njp-call` (arrêt propre, file conservée).
3. Désactiver NJP CALL sur le poste : les messages reçus restent visibles.
4. Reprise : `/healthz`, redémarrage, rebascule du numéro, appel de contrôle.
5. Critère : moins de 5 minutes entre la décision et le premier appel reçu
   par un humain.
