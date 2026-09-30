# Flux de données, conservation, sous-traitants, information des appelants

> **Cible actuelle : traitement au poste du cabinet.** Ce document décrit les flux du **service hébergé**, qui n'est plus la cible. Les flux de la cible — traitement au poste du cabinet — sont décrits, avec ce qui sort encore vers l'opérateur et le cloud NJP CARE, dans NJP CARE `desktop/docs/NJP-CALL-POSTE-LOCAL.md` §2–3.

> **Matériau préparatoire. Ce n'est PAS une validation réglementaire.** Aucune
> conformité (RGPD, HDS, AI Act) n'est déclarée. Chaque ligne « à valider »
> exige une décision et une preuve (DPO, juriste, éditeur). Complète
> `DONNEES-DE-SANTE.md`.

## 1. Flux

```text
appelant ──voix──► fournisseur téléphonique (STT/TTS)          [non choisi]
                        │ texte reconnu, événements signés
                        ▼
                 service NJP CALL (hébergeur UE, HDS si santé) [non choisi]
                   │  journal de l'appel EN COURS (chiffré)
                   │  (option) texte ──► fournisseur d'IA      [désactivé sans approbation]
                   ▼
                 relais (file chiffrée) ◄── le POSTE relève (HTTPS, jeton de poste)
                                              ▼
                                  NJP CARE (coffre SQLCipher du cabinet)
                                              │ réservation : autorité des créneaux
                                              ▼
                                  cloud NJP CARE (titre neutre, horaires, référence de tentative)
(rappels, si choisis) service ──SMS/voix──► prestataire de rappels  [non choisi]
```

## 2. Données et durées (proposées)

| Donnée | Lieu | Durée proposée | Statut |
|---|---|---|---|
| audio | fournisseur téléphonique | aucune conservation | à garantir contractuellement |
| propos de l'appel en cours | service (chiffré) | jusqu'à la clôture ; puis pierre tombale sans propos | implémenté |
| appel abandonné (jamais clos) | service | purgé après `NJP_CALL_RETENTION_DAYS` (30 j) | implémenté |
| commandes et verdicts du relais | service (chiffré) | purgés 30 j après leur terme | implémenté |
| dernière déclaration du poste | service (chiffré) | remplacée à chaque déclaration | implémenté |
| rappels programmés | service (chiffré) | purgés 30 j après leur terme | implémenté (aucun canal branché) |
| message, rappel, demande, compte rendu | coffre NJP CARE | réglage du cabinet (`retention.callRecordDays`, 90 j par défaut) | à valider |
| journaux techniques | service | identifiants et statuts, expurgés | durée à fixer par l'hébergeur |
| sauvegardes du service | hébergeur | à fixer (≤ durée de rétention + 7 j proposé) | à valider |

Ce qui ne quitte jamais NJP CARE vers le cloud pour une réservation
téléphonique : nom, numéro, motif. Le cloud reçoit le titre neutre
« Rendez-vous », les horaires et la référence de tentative.

## 3. Sous-traitants (à compléter après choix)

| Rôle | Candidat | Localisation | Art. 28 | HDS | Sous-traitants ultérieurs |
|---|---|---|---|---|---|
| hébergeur du service | — | UE exigée | à signer | requis si santé | à obtenir |
| téléphonie (numéro, STT, TTS) | — | UE exigée | à signer | à évaluer | à obtenir |
| IA (facultatif) | — | UE exigée | à signer | à évaluer | à obtenir ; non-réutilisation des données exigée |
| rappels SMS / voix | — | UE exigée | à signer | à évaluer | à obtenir |

## 4. Information des appelants — projet de texte (à valider)

Annonce d'ouverture (déjà prononcée par le moteur) : l'appelant est informé
qu'il parle à une **assistante vocale automatisée** du cabinet.

Projet de mention complémentaire, à faire valider avant usage :

> « Vos propos sont transcrits pour transmettre votre demande au cabinet
> [nom]. L'enregistrement audio n'est pas conservé. Vos informations sont
> utilisées uniquement par le cabinet pour traiter votre demande. Pour vos
> droits d'accès, de rectification ou d'effacement, adressez-vous au cabinet.
> Pour parler à une personne, appuyez sur 0 ou dites-le. En cas d'urgence,
> raccrochez et composez le 15 ou le 112. »

## 5. Analyses à mener

AIPD (probablement requise), registre du cabinet, contrats article 28, choix
et preuve de la localisation, politique de conservation des journaux et
sauvegardes de l'hébergeur.
