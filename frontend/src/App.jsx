import useSessionStore from './store/sessionStore'
import LoginPage from './pages/LoginPage'
import Sidebar from './components/Sidebar'
import StepIndicator from './components/StepIndicator'
import RequirementChat from './pages/RequirementChat'
import ResearchReport from './pages/ResearchReport'
import ProductCanvas from './pages/ProductCanvas'
import DocumentGeneration from './pages/DocumentGeneration'
import PrototypeGeneration from './pages/PrototypeGeneration'
import HistoryPortal from './pages/HistoryPortal'

function App() {
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated)
  const currentStep     = useSessionStore((s) => s.currentStep)
  const currentView     = useSessionStore((s) => s.currentView)

  if (!isAuthenticated) return <LoginPage />

  const isHistory = currentView === 'history'

  return (
    /*
     * h-screen + overflow-hidden on the root keeps the sidebar pinned.
     * The main column uses overflow-y-auto — ONE scroll region for all page content.
     * Each page's inner wrapper uses min-h-full so it always fills the viewport,
     * but can grow beyond it (panel expands → main area scrolls).
     */
    <div className="h-screen h-dvh flex overflow-hidden bg-slate-50 dark:bg-navy-950">

      {/* Sidebar — never scrolls */}
      <Sidebar />

      {/* Main column — the only scroll container */}
      <div className="flex-1 overflow-y-auto">

        {isHistory ? (
          <div className="min-h-full flex flex-col p-8">
            <div className="flex-1 flex flex-col bg-white dark:bg-navy-900
                            rounded-2xl shadow-sm border border-gray-200 dark:border-navy-700 p-6">
              <HistoryPortal />
            </div>
          </div>
        ) : (
          <div className="min-h-full flex flex-col p-8">
            <StepIndicator current={currentStep} />
            {/* Panel — flex-1 fills remaining height on short pages,
                        grows freely on long pages (no overflow-hidden).  */}
            <div className="flex-1 flex flex-col bg-white dark:bg-navy-900
                            rounded-2xl shadow-sm border border-gray-200 dark:border-navy-700 p-6">
              {currentStep === 'requirement' && <RequirementChat />}
              {currentStep === 'research'    && <ResearchReport />}
              {currentStep === 'canvas'      && <ProductCanvas />}
              {currentStep === 'documents'   && <DocumentGeneration />}
              {currentStep === 'prototype'   && <PrototypeGeneration />}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default App
