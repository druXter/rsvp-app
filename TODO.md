# TODO

## Sicherheitsprüfung rsvp-app (11.11.2026)

Funde, Szenarien und Lösungsvorschläge in [docs/AUDIT-2026-11.md](docs/AUDIT-2026-11.md), je Fund ein Test in
`tests/e2e/audit-2026-11.spec.ts` bzw. `tests/unit/audit-2026-11.test.ts`. Ein Punkt ist erledigt, wenn sein Test grün
ist und die Änderung eingespielt wurde. Bericht, Tests und diese Datei erst committen, wenn alles behoben ist
(öffentliches Repository).

Stand 14.11.2026: alle 13 behoben, alle Tests grün, eingespielt; die Gegenseite im Abstimmungstool (Bindung an einen
Termin für R-02/R-04) ebenso. `PIN_COOKIE_SECRET` ist gesetzt; bestehende PIN-Cookies (mit der PIN im Klartext) gelten
nicht mehr, Gäste geben die PIN einmal neu ein.

- [x] **R-02** (hoch) Zu-/Absage nur für bestätigte Adressen ans Abstimmungstool melden (`rsvp-submission.ts`,
  `reconfirm-store.ts`); im Abstimmungstool `rsvpEventId` nicht aus jeder Meldung überschreiben.
  → behoben (`provenEmail` in `poll-notify.ts`; Abstimmungstool bindet `rsvpEventId` einmal und verwirft Meldungen anderer Termine, `app/lib/rsvp-binding.ts`).
- [x] **R-01** (hoch) Konto übernimmt nur selbst bestätigte frühere Antworten, bei Übernahme neuer `editToken`
  (`account-participant.ts`).
  → behoben (nur bestätigte Antworten, neuer `editToken`, Push-Abos weg; dazu: eine fremde Adresse eines angemeldeten Kontos gilt nicht mehr als bestätigt).
- [x] **R-03** (mittel) Gästeseiten reichen nur die nötigen Felder an `RsvpForm` - kein `verifyToken` im Quelltext.
  → behoben (`app/lib/guest-form.ts`).
- [x] **R-05** (mittel) Bot-Schutz: Ausnahme nur für einen existierenden `editToken` (`app/actions.ts`).
  → behoben.
- [x] **R-07** (mittel) E-Mail der Antwort: genau eine gültige Adresse (a), Adresswechsel gedrosselt (b).
  → behoben (`app/lib/rsvp-input.ts`, `emailChangeRules`).
- [x] **R-06** (mittel) Kapazität: Prüfen und Speichern atomar, auch bei Verifizierung und Nachrücken.
  → behoben (`app/lib/event-lock.ts`, auch `fillFreeSeats` und Verifizierung).
- [x] **R-04** (mittel) `poll-access` mit `eventId`, nur für `ABSTIMMUNGSTOOL_BASE_URL` signieren, `pollUrl` prüfen -
  zusammen mit dem Abstimmungstool, feste Prüfnachrichten auf beiden Seiten.
  → behoben (`eventId` im Nachweis, nur für `ABSTIMMUNGSTOOL_BASE_URL`, `pollUrl` nur http(s), Ergebnis nur an verknüpfte Termine; Abstimmungstool prüft die `eventId` gegen die gebundene `rsvpEventId`, feste Prüfnachricht auf beiden Seiten gleich).
- [x] **R-08** (niedrig) Drosselung: IPv6 auf /64 kürzen (a), PIN-Limit pro Ziel senken oder Mindestlänge (b).
  → behoben (/64, 30 je Stunde und Ziel, richtige PIN zählt nicht).
- [x] **R-09** (niedrig) PIN-Cookie: abgeleiteter Wert, `Secure`, `SameSite`; Seiten über `app/lib/pin.ts`.
  → behoben (HMAC mit `PIN_COOKIE_SECRET`, `Secure`, `SameSite=Lax`, fünf Seiten über `hasPinCookie`).
- [x] **R-10** (niedrig) Kalenderdatei: Link nur mit Token, der zum Termin gehört.
  → behoben.
- [x] **R-11** (Hinweis) Registrierung antwortet gleich, egal ob es das Konto gibt.
  → behoben (Mail „Du hast schon ein Konto“).
- [x] **R-12** (Hinweis) `auskunft.js`: unbestätigte Adressen kennzeichnen, nicht ungefragt mitlöschen.
  → behoben (Hinweis, löschen nur mit `--mit-unbestaetigten`).
- [x] **R-13** (Hinweis) Obergrenzen für Name und Freitexte der Antwort.
  → behoben.

Aus „Beobachtungen ohne Fund“ zu entscheiden:

- [ ] Adresse neuer Verwaltungskonten bestätigen lassen, bevor rsvp-app sie im Verbund bestätigt.
- [ ] Unbestätigte Teilnehmendenkonten nach einigen Tagen löschen.
- [ ] Fremde `editToken` (anderer Termin) beim Antworten wie keinen behandeln.
