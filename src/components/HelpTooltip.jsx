import { useState } from 'react'
import { X, HelpCircle } from 'lucide-react'

// Each tip: { id, title, description, position: 'top'|'bottom'|'left'|'right' }
export function HelpTooltip({ tips }) {
  const [active, setActive] = useState(false)
  const [dismissed, setDismissed] = useState({})

  const visible = tips.filter(t => !dismissed[t.id])

  return (
    <>
      {/* Help button */}
      <button
        onClick={() => setActive(!active)}
        className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border transition-colors ${active ? 'bg-amber-500 text-black border-amber-500' : 'bg-gray-800 text-gray-400 hover:text-white border-gray-700'}`}
      >
        <HelpCircle size={13} />
        <span className="hidden sm:inline">Help</span>
      </button>

      {/* Overlay */}
      {active && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={() => setActive(false)} />

          {/* Tips panel */}
          <div className="absolute bottom-0 left-0 right-0 pointer-events-auto bg-gray-900 border-t border-gray-800 rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HelpCircle size={16} className="text-amber-400" />
                <h3 className="text-white font-bold text-sm">Help Guide</h3>
              </div>
              <button onClick={() => setActive(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {visible.map(tip => (
                <div key={tip.id} className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex gap-3">
                  <div className="flex-1">
                    <p className="text-amber-400 text-xs font-bold mb-0.5">{tip.title}</p>
                    <p className="text-gray-300 text-xs leading-relaxed">{tip.description}</p>
                  </div>
                  <button
                    onClick={() => setDismissed(prev => ({ ...prev, [tip.id]: true }))}
                    className="text-gray-600 hover:text-gray-400 shrink-0 mt-0.5"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="text-center py-6 text-gray-500 text-sm">
                  All tips dismissed. Click × on any tip to bring it back on next open.
                </div>
              )}
            </div>

            <button
              onClick={() => setActive(false)}
              className="w-full mt-3 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
