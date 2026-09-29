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
`cancel_disabled`, `slot_unavailable`, `verification_failed`,
`practitioner_change_not_allowed`, `destination_not_allowed`,
`report_already_recorded`.

## Relais

| Sens | Forme |
|---|---|
| service → poste (`GET /v1/care/next`) | `{ item: { kind: "command", id, envelope } }` ou `{ item: { kind: "availability", id, query: { practitionerRef?, windows, limit } } }`, ou 204 |
| poste → service (`POST /v1/care/result`) | `{ id, result }` ; `result` = verdict, ou `{ status, slots, reason? }` pour une disponibilité |

Le poste s'authentifie par un jeton de poste (le service ne garde que
l'empreinte) ; le jeton est conservé dans le coffre chiffré de NJP CARE et
aucune commande de la fenêtre ne le rend.

## Preuves croisées

- `contract/fixtures/*.json` (enveloppes réellement émises par le banc) sont
  rejouées par `cargo test -p njp-local-api acceptance` dans NJP CARE.
- `dist/package/njp.call-0.1.0.njpx` signé ici est vérifié par
  `cargo test -p njp-update-guard --test paquet_njp_call` dans NJP CARE.
