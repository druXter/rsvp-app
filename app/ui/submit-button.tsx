// app/ui/submit-button.tsx

/**
 * Einheitlicher primärer Speichern-/Absenden-Button fürs ganze Projekt (Admin- wie
 * Gast-Formulare). `form` ordnet den Button einem Formular außerhalb seines eigenen
 * DOM-Teilbaums zu (siehe app/admin/edit/[id]/page.tsx) - so kann der Button z.B. nach
 * einem nachgelagerten Panel wie "Zugriff teilen" stehen, obwohl er zum weiter oben
 * stehenden Formular gehört.
 */
export default function SubmitButton({
  children,
  form,
  disabled = false,
  className = ''
}: {
  children: React.ReactNode
  form?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="submit"
      form={form}
      disabled={disabled}
      className={`w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
