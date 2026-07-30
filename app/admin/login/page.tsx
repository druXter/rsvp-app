// app/admin/login/page.tsx
import { loginAdmin } from '../actions'

/**
 * Admin-Login-Seite.
 * Stellt ein Formular zur Passworteingabe bereit und fängt Fehler (z.B. falsches Passwort) über URL-Parameter ab.
 */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Überprüfen, ob die URL einen Fehler-Parameter enthält (z.B. ?error=1), 
  // der von der loginAdmin-Server-Action nach einem fehlerhaften Versuch angehängt wird.
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-6">
        <h1 className="text-2xl font-bold text-center text-gray-900">Admin Login</h1>
        
        {/* Fehlermeldung nur bei Bedarf einblenden */}
        {hasError && (
          <div className="p-3 bg-red-50 text-red-700 text-sm rounded">
            Falsches Passwort. Bitte versuche es erneut.
          </div>
        )}

        {/* Das Login-Formular leitet die Eingabe an die Server-Action 'loginAdmin' weiter */}
        <form action={loginAdmin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">Passwort</label>
            <input 
              type="password" 
              name="password" 
              required 
              className="w-full border border-gray-300 p-2 rounded text-gray-900" 
              placeholder="Admin-Passwort eingeben" 
            />
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition">
            Einloggen
          </button>
        </form>
      </div>
    </main>
  )
}