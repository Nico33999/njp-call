# Données personnelles et de santé — cartographie et points à valider

> Voir aussi `FLUX-DE-DONNEES.md` (flux détaillés, conservation, sous-traitants,
> projet d'information des appelants).

> Document de travail. **Aucune conformité (RGPD, HDS, AI Act) n'est déclarée.**
> Chaque point « à valider » exige une preuve et une validation humaine
> (DPO, juriste, éditeur).

## 1. Flux

```text
appelant ─voix─► fournisseur téléphonique (STT/TTS) ─texte─► service NJP CALL
service ─(option) texte─► fournisseur d'IA        [désactivé sans décision]
service ─commande typée─► relais ─► poste NJP CARE (coffre chiffré SQLCipher)
```

| Donnée | Où | Durée proposée |
|---|---|---|
| audio | fournisseur téléphonique, transitoire | **aucune conservation** |
| texte des répliques | journal de session, stockage durable chiffré | durée de l'appel + reprise ; compacté à la clôture (pierre tombale sans propos) ; abandonné : purgé après 30 j |
| message, demande de rappel, compte rendu | coffre NJP CARE | réglage `retention.callRecordDays` (défaut 90 j) — à valider |
| journaux techniques | service | identifiants et statuts seulement, expurgés |

## 2. Sous-traitants et localisation — à valider

- Hébergeur du service NJP CALL : **non choisi**. Si des données de santé y
  transitent ou y sont stockées : hébergeur **certifié HDS** requis.
- Fournisseur téléphonique : **non choisi** (`TELEPHONIE.md`).
- Fournisseur d'IA : **non choisi** ; l'ancien prototype envoyait les
  conversations à un fournisseur hors UE — ce chemin est supprimé.

## 3. Droits et gestes

- Information de l'appelant : annonce systématique d'une assistante
  **automatisée** (obligation de transparence liée à l'IA à valider
  juridiquement), mention de la finalité et des droits à rédiger.
- Accès, rectification, effacement, export : les objets vivent dans NJP CARE ;
  la désinstallation propose de **conserver ou supprimer** explicitement.
- Minimisation : ni numéro de sécurité sociale, ni détail de santé demandé ;
  une question médicale est transmise telle quelle au professionnel.

## 4. Analyses à mener

- AIPD : **probablement requise** (données de santé, traitement automatisé,
  personnes vulnérables) — à confirmer par le DPO.
- Registre des traitements du cabinet : à compléter.
- Contrats article 28 avec chaque sous-traitant.

## 5. Sécurité appliquée dans ce dépôt

Isolation par cabinet (jeton de poste → cabinet), webhooks signés et
horodatés, limites de taille/fréquence/délai, validation stricte en entrée et
en sortie, liste blanche HTTPS des sorties (SSRF), journaux expurgés, aucun
secret dans le navigateur ni dans les exports, idempotence, défense contre
l'injection de consignes (règles hiérarchisées, propos = données).
