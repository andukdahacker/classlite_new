import { useTranslation } from 'react-i18next'

function App() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cl-paper)]">
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.welcome')}
      </h1>
    </div>
  )
}

export default App
