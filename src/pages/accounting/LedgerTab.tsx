import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import type { LedgerEntry } from './types'

interface Props {
  ledgerEntries: LedgerEntry[]
  dateRange: string
}

export default function LedgerTab({ ledgerEntries, dateRange }: Props) {
  const [selected, setSelected] = useState<LedgerEntry | null>(null)
  const [search, setSearch] = useState('')

  const exportPDF = () => {
    const doc = createPDF('General Ledger', dateRange)
    const body = ledgerEntries.map((e) => [
      new Date(e.date).toLocaleDateString('en-NG'),
      e.ref ?? '',
      e.description ?? '',
      e.staff ?? '',
      e.method ?? '',
      e.credit ? '₦' + Number(e.credit).toLocaleString() : '',
      e.debit ? '₦' + Number(e.debit).toLocaleString() : '',
      '₦' + Number(e.balance).toLocaleString(),
    ])
    addTable(
      doc,
      ['Date', 'Ref', 'Description', 'Staff', 'Method', 'Credit', 'Debit', 'Balance'],
      body
    )
    savePDF(doc, `ledger-${dateRange}-${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const closingBalance = ledgerEntries[0]?.balance ?? 0

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-xs">General Ledger — {dateRange}</p>
          <p className="text-white font-bold text-lg">{ledgerEntries.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-gray-400 text-xs">Closing Balance</p>
            <p
              className={`font-bold text-lg ${closingBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              ₦{closingBalance.toLocaleString()}
            </p>
          </div>
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2 rounded-xl transition-colors"
          >
            <Download size={12} /> Export PDF
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ledger entries…"
          className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-500"
        />
        {ledgerEntries.filter(
          (e) =>
            !search ||
            (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
            (e.ref || '').toLowerCase().includes(search.toLowerCase()) ||
            (e.type || '').toLowerCase().includes(search.toLowerCase())
        ).length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">
            No entries for this period
          </div>
        ) : (
          ledgerEntries
            .filter(
              (e) =>
                !search ||
                (e.description || '').toLowerCase().includes(search.toLowerCase()) ||
                (e.ref || '').toLowerCase().includes(search.toLowerCase()) ||
                (e.type || '').toLowerCase().includes(search.toLowerCase())
            )
            .map((entry, i) => (
              <button
                key={entry.id + i}
                onClick={() => setSelected(entry)}
                className={`w-full bg-gray-900 border rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-gray-600 transition-colors text-left ${entry.type === 'debit' ? 'border-red-500/20' : 'border-gray-800'}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${entry.type === 'debit' ? 'bg-red-400' : 'bg-green-400'}`}
                  />
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{entry.description}</p>
                    <p className="text-gray-500 text-xs">
                      {new Date(entry.date).toLocaleDateString('en-NG')} · {entry.staff || 'System'}{' '}
                      · <span className="capitalize">{entry.method || '—'}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {entry.credit > 0 && (
                    <p className="text-green-400 font-bold text-sm">
                      +₦{entry.credit.toLocaleString()}
                    </p>
                  )}
                  {entry.debit > 0 && (
                    <p className="text-red-400 font-bold text-sm">
                      -₦{entry.debit.toLocaleString()}
                    </p>
                  )}
                  <p className={`text-xs ${entry.balance >= 0 ? 'text-gray-400' : 'text-red-400'}`}>
                    Bal: ₦{entry.balance.toLocaleString()}
                  </p>
                </div>
              </button>
            ))
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h3 className="text-white font-bold">Entry Details</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {(
                [
                  { label: 'Reference', value: selected.ref },
                  { label: 'Description', value: selected.description },
                  { label: 'Date', value: new Date(selected.date).toLocaleDateString('en-NG') },
                  {
                    label: 'Time',
                    value: new Date(selected.date).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  },
                  { label: 'Staff', value: selected.staff || 'System' },
                  { label: 'Method', value: selected.method || '—' },
                  {
                    label: 'Credit',
                    value: selected.credit > 0 ? '₦' + selected.credit.toLocaleString() : '—',
                    color: 'text-green-400',
                  },
                  {
                    label: 'Debit',
                    value: selected.debit > 0 ? '₦' + selected.debit.toLocaleString() : '—',
                    color: 'text-red-400',
                  },
                  {
                    label: 'Balance',
                    value: '₦' + selected.balance.toLocaleString(),
                    color: selected.balance >= 0 ? 'text-white' : 'text-red-400',
                  },
                ] as { label: string; value: string; color?: string }[]
              ).map((row) => (
                <div key={row.label} className="flex justify-between items-start gap-4">
                  <span className="text-gray-500 text-xs">{row.label}</span>
                  <span className={`text-sm font-medium text-right ${row.color ?? 'text-white'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
