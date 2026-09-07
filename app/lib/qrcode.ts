// app/lib/qrcode.ts
import QRCode from 'qrcode'

const baseUrl = () => process.env.BASE_URL || 'http://localhost:3000'

/**
 * Die gesicherte Admin-Route, die beim Scannen des QR-Codes den Gast einlässt.
 */
export function checkinUrl(rsvpId: string) {
  return `${baseUrl()}/admin/checkin/${rsvpId}`
}

/**
 * QR-Code als PNG-Buffer, zum Einbetten als CID-Anhang in E-Mails.
 */
export function generateCheckinQrBuffer(rsvpId: string): Promise<Buffer> {
  return QRCode.toBuffer(checkinUrl(rsvpId), { width: 300, margin: 1 })
}

/**
 * QR-Code als data:-URL, zur direkten Anzeige auf der Bestätigungsseite im Browser.
 */
export function generateCheckinQrDataUrl(rsvpId: string): Promise<string> {
  return QRCode.toDataURL(checkinUrl(rsvpId), { width: 300, margin: 1 })
}
