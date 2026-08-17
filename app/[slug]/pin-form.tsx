//app/[slug]/pin-form.tsx

'use client'

import { useState } from 'react'
import { verifyEventPin } from '../actions'

export default function PinForm({ eventId, slug, title }: { eventId: string, slug: string, title: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    
    const formData = new FormData(e.currentTarget)
    const result = await verifyEventPin(formData)
    
    if (!result.success && result.error) {
      setError(result.error)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full border border-gray-100">
        <div className="text-center mb-6">
          <span className="text-4xl block mb-2">🔒</span>
          <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
          <p className="text-gray-500 text-sm mt-2">Dieses Event ist passwortgeschützt.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="slug" value={slug} />
          
          <div>
            <input 
              type="text" 
              name="pin" 
              required 
              className="w-full border border-gray-300 p-3 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-lg tracking-widest font-mono" 
              placeholder="Event-PIN eingeben" 
            />
          </div>

          {error && <p className="text-red-500 text-sm text-center font-bold bg-red-50 p-2 rounded">{error}</p>}

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
          >
            {isLoading ? 'Prüfe Code...' : 'Freischalten'}
          </button>
        </form>
      </div>
    </div>
  )
}