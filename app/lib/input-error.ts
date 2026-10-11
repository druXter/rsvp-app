// app/lib/input-error.ts

/**
 * Ungültige Eingabe in einem Verwaltungs-Formular (Einstellungen eines Events, Termins oder einer Reihe). Die
 * Server Actions geben ihre Meldung ans Formular zurück (app/admin/settings-form.tsx), statt die Seite mit einem
 * Fehler abstürzen zu lassen - Next.js zeigt die Meldung geworfener Fehler in Produktion nicht an.
 */
export class InputError extends Error {}
