# Contrat avec NJP CARE

NJP CARE fait foi. Implémentation de référence : dépôt `njp-care`, branche
`claude/njp-care-call-extension-contract`, fichiers
`desktop/crates/vault-engine/src/secretariat.rs` (commandes),
`desktop/crates/update-guard/src/extension_package.rs` (paquet),
`desktop/crates/local-api/src/facade/secretariat.rs` (relais).

## Enveloppe de commande (`njp.call.command`, v1)

`format`, `v`, `extensionId`, `cabinetId`, `callId`, `seq`,
`idempotencyKey` (`callId/type/rang`), `issuedAt`, `command {type, payload}`.
Champ inconnu ⇒ refus (`deny_unknown_fields`). Un `patientRef` ne peut donc
pas être injecté : le rattachement à un dossier est un geste du praticien.

## Verdict

`{ idempotencyKey, status, reference?, reason?, replayed? }` — mêmes statuts
qu'ici. Codes de refus du moteur : `invalid:*`, `invalid_envelope`,
`extension_mismatch`, `extension_not_installed`, `extension_disabled`,
`extension_forbidden`, `package_not_verified`, `wrong_cabinet`,
`idempotency_conflict`, `booking_disabled`, `reschedule_disabled`,
`cancel_disabled`, `slot_unavailable`, `command_expired`,
`authority_refused`, `destination_not_allowed`, `report_already_recorded`.

### Réservation : l'autorité des créneaux

Le poste ne confirme une réservation que lorsque l'autorité (le cloud NJP
CARE, `/_api/appointments/create`, capacité vérifiée sous verrou,
dédoublonnage par `clientOperationRef`) l'a acceptée :

| Issue | Verdict |
|---|---|
| créée (ou dédoublonnée) | `confirmed`, référence du rendez-vous |
| refusée (créneau pris, y compris par une saisie dans NJP CARE) | `refused` / `slot_unavailable` |
| autorité injoignable, rien créé | `requested` / `authority_unreachable` (demande à valider) |
| réponse perdue | `pending` / `outcome_unknown` ; menée à terme par la reprise des créations |
| reçue plus de 2 min après émission | `refused` / `command_expired` (jamais appliquée) |

### Déplacer, annuler

Nom + numéro + horaire ne sont pas une identité forte : `requested` /
`recorded_as_request`, **même réponse** que le rendez-vous existe ou non ;
l'agenda n'est jamais modifié par téléphone.

## Relais (à bail)

| Sens | Forme |
|---|---|
| poste → service `GET /v1/care/next?wait=ms` | `{ item: { kind: "command", id, lease, envelope } }` ou `{ item: { kind: "availability", id, lease, query } }`, ou 204 |
| poste → service `POST /v1/care/result` | `{ id, lease, result }` ⇒ 204 enregistré (ou déjà, à l'identique) ; 409 bail périmé / verdict différent ; 404 inconnu pour ce cabinet ; 400 forme |
| poste → service `POST /v1/care/status` | `{ v: 1, extensionEnabled, permissions, bookingEnabled, remindersOnDisable, issuedAt, validForSeconds ≤ 86400 }` |
| poste → service `POST /v1/care/revoke` | désinstallation : jeton révoqué durablement |

`id` = `it_` + 24 hex, stable par (cabinet, clé d'idempotence) ; `lease` = 32
hex. Relever réserve, ne supprime pas ; sans verdict avant l'échéance du bail,
l'élément revient (temporisation 1 s → 5 min, 8 tentatives, puis `dead`
visible en supervision). Le verdict est validé strictement (champs connus,
clé identique, jamais `simulated`, `confirmed` avec référence) et enregistré
AVANT l'accusé.

Le poste s'authentifie par un jeton de poste (le service ne garde que
l'empreinte) ; le jeton est conservé dans le coffre chiffré de NJP CARE et
aucune commande de la fenêtre ne le rend. La relève est faite par le moteur
du poste en tâche de fond (une boucle), pas par une page.

## Preuves croisées

- `cargo test -p njp-local-api --lib e2e -- --ignored` (njp-care, avec
  `NJP_CALL_DIR`) : poste réel contre ce service réel, en HTTPS de test,
  redémarrages brutaux compris.

- `contract/fixtures/*.json` (enveloppes réellement émises par le banc) sont
  rejouées par `cargo test -p njp-local-api acceptance` dans NJP CARE.
- `dist/package/njp.call-0.1.0.njpx` signé ici est vérifié par
  `cargo test -p njp-update-guard --test paquet_njp_call` dans NJP CARE.
