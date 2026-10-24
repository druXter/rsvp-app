// app/lib/escape-html.ts

/**
 * Für alles in HTML-Mails, was nicht fest im Code steht: Namen und Angaben von Gästen, aber auch Titel, Ort und
 * Texte der Verwaltung. Gäste können sich mit fremder Adresse anmelden - ohne Escaping ließe sich so über unseren
 * (DKIM-signierten) Absender beliebiges HTML an fremde Postfächer schicken. Nicht für `subject` und `text`.
 */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
