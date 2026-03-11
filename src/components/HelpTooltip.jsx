import { useState, useEffect, useRef } from 'react'
import { X, HelpCircle, ChevronRight, ChevronLeft } from 'lucide-react'

export function HelpTooltip({ tips }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState(null)
  const btnRef = useRef()

  const current = tips[step]

  // Position the tooltip card below the help button by default
  // Each tip can override with a targetId to point at a specific element
  useEffect(() => {
    if (!open) return
    const targetId = current?.targetId
    const el = targetId ? document.getElementById(targetId) : btnRef.current
    if (!el) { setPos(null); return }
    const rect = el.getBoundingClientRect()
    const viewW = window.innerWidth
    const viewH = window.innerHeight
    const cardW = Math.min(280, viewW - 32)

    let left = rect.left
    let top = rect.bottom + 10
    // flip up if too close to bottom
    if (top + 180 > viewH) top = rect.top - 180 - 10
    // clamp horizontally
    if (left + cardW > viewW - 16) left = viewW - cardW - 16
    if (left < 16) left = 16

    setPos({ left, top, anchorLeft: rect.left + rect.width / 2, anchorTop: rect.bottom })
  }, [open, step, current])

  const close = () => { setOpen(false); setStep(0) }
  const next = () => step < tips.length - 1 ? setStep(s => s + 1) : close()
  const prev = () => step > 0 && setStep(s => s - 1)

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => { setStep(0); setOpen(true) }}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl border bg-gray-800 text-gray-400 hover:text-white border-gray-700 transition-colors"
      >
        <HelpCircle size={13} />
        <span className="hidden sm:inline">Help</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[999] pointer-events-none">
          {/* Dim overlay — clickable to close */}
          <div className="absolute inset-0 bg-black/50 pointer-events-auto" onClick={close} />

          {/* Tooltip card */}
          {pos && (
            <div
              className="absolute pointer-events-auto"
              style={{ left: pos.left, top: pos.top, width: Math.min(280, window.innerWidth - 32) }}
            >
              {/* Arrow pointing up to anchor */}
              <div
                className="absolute -top-2 w-4 h-2 overflow-hidden"
                style={{ left: Math.max(8, Math.min(pos.anchorLeft - pos.left - 8, Math.min(280, window.innerWidth - 32) - 24)) }}
              >
                <div className="w-4 h-4 bg-amber-500 rotate-45 translate-y-1" />
              </div>

              {/* Card */}
              <div className="bg-gray-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-amber-500 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-black font-bold text-sm">{current.title}</span>
                  <button onClick={close} className="text-black/60 hover:text-black">
                    <X size={15} />
                  </button>
                </div>

                {/* Body */}
                <div className="px-4 py-3">
                  <p className="text-gray-300 text-sm leading-relaxed">{current.description}</p>
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex items-center justify-between">
                  <span className="text-gray-600 text-xs">{step + 1} / {tips.length}</span>
                  <div className="flex items-center gap-2">
                    {step > 0 && (
                      <button onClick={prev} className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg bg-gray-800">
                        <ChevronLeft size={13} /> Prev
                      </button>
                    )}
                    <button onClick={next} className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg">
                      {step < tips.length - 1 ? <><span>Next</span><ChevronRight size={13} /></> : 'Done'}
                    </button>
                  </div>
                </div>

                {/* Step dots */}
                <div className="flex items-center justify-center gap-1 pb-3">
                  {tips.map((_, i) => (
                    <button key={i} onClick={() => setStep(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step ? 'bg-amber-500' : 'bg-gray-700'}`} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
