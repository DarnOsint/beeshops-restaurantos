import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { AlertCircle, RefreshCw, Search, ThumbsDown, ThumbsUp, UtensilsCrossed } from 'lucide-react'

type MenuCategory = { name?: string | null }
type MenuItem = {
  id: string
  name: string
  price: number
  description?: string | null
  image_url?: string | null
  menu_categories?: MenuCategory | null
}

type ZonePriceRow = {
  menu_item_id: string
  category_id: string
  price: number
}

type TableCategory = {
  id: string
  name: string
}

type ItemGroup = 'Food' | 'Drinks' | 'Cocktails' | 'Milkshakes' | 'Others'
type Group = 'All' | ItemGroup

const todayWAT = () => {
  const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

function buildRatedKey(zoneId: string) {
  return `rated:${zoneId}:${todayWAT()}`
}

export default function ZoneMenuView() {
  const { zoneId } = useParams<{ zoneId: string }>()
  const navigate = useNavigate()
  const [zone, setZone] = useState<TableCategory | null>(null)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataSource, setDataSource] = useState<'api' | 'supabase' | 'unknown'>('unknown')
  const [debugApiError, setDebugApiError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeGroup, setActiveGroup] = useState<Group>('All')
  const [rated, setRated] = useState(false)
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)

  const debug = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1'
    } catch {
      return false
    }
  }, [])

  const normalizeMenu = (items: unknown): MenuItem[] => {
    if (!Array.isArray(items)) return []
    return (items as any[]).map((item) => ({
      id: String(item?.id ?? ''),
      name: String(item?.name ?? ''),
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
      description: item?.description ?? null,
      image_url: item?.image_url ?? null,
      menu_categories: item?.menu_categories ?? null,
    }))
  }

  const resolveZone = async (): Promise<TableCategory | null> => {
    if (!zoneId) return null
    // 1) Normal case: zoneId is a real `table_categories.id`
    const direct = await supabase
      .from('table_categories')
      .select('id, name')
      .eq('id', zoneId)
      .single()
    if (!direct.error && direct.data) return direct.data as TableCategory

    // 2) Back-compat: zoneId is a zone name (older/handwritten QR labels)
    const byName = await supabase
      .from('table_categories')
      .select('id, name')
      .ilike('name', zoneId)
      .maybeSingle()
    if (!byName.error && byName.data) return byName.data as TableCategory

    // 3) Back-compat: QR contains a table id but points to /zone/:id.
    // Redirect to the real zone for that table.
    const tableRes = await supabase
      .from('tables')
      .select('id, category_id, table_categories(id, name)')
      .eq('id', zoneId)
      .maybeSingle()
    if (!tableRes.error && tableRes.data) {
      const zid = (tableRes.data as any).table_categories?.id || (tableRes.data as any).category_id
      if (zid) {
        navigate(`/zone/${zid}`, { replace: true })
        return null
      }
    }

    return null
  }

  const load = async () => {
    if (!zoneId) return
    setLoading(true)
    setError(null)
    setDebugApiError(null)
    setDataSource('unknown')
    try {
      // Prefer server-side resolved payload (service role) so public scans work even with RLS.
      try {
        const resp = await fetch(
          `/api/public/zone-menu?zone=${encodeURIComponent(zoneId)}&t=${Date.now()}`
        )
        if (resp.ok) {
          const json = (await resp.json()) as
            | { redirectZoneId?: string | null; zone?: TableCategory; menu?: MenuItem[] }
            | { error?: string }
          if ('redirectZoneId' in json && json.redirectZoneId) {
            navigate(`/zone/${json.redirectZoneId}`, { replace: true })
            return
          }
          if ('zone' in json && json.zone && Array.isArray((json as any).menu)) {
            setZone(json.zone)
            setMenu(normalizeMenu((json as any).menu))
            setDataSource('api')
            setLoading(false)
            return
          }
          if (debug && 'error' in json && (json as any).error) {
            setDebugApiError(String((json as any).error))
          }
        } else if (debug) {
          try {
            const j = await resp.json()
            setDebugApiError(String((j as any)?.error ?? resp.statusText))
          } catch {
            setDebugApiError(resp.statusText || `HTTP ${resp.status}`)
          }
        }
      } catch {
        /* fall back to client-side Supabase */
      }

      const resolved = await resolveZone()
      if (!resolved) throw new Error('zone_not_found')

      const [zoneRes, menuRes, zonePriceRes] = await Promise.all([
        Promise.resolve({ data: resolved, error: null }),
        supabase
          .from('menu_items')
          .select('id, name, price, description, image_url, menu_categories(name)')
          .order('name'),
        supabase
          .from('menu_item_zone_prices')
          .select('menu_item_id, category_id, price')
          .eq('category_id', resolved.id),
      ])

      if (zoneRes.error) throw zoneRes.error
      setZone(zoneRes.data as TableCategory)

      const baseMenu = (menuRes.data || []) as MenuItem[]
      const priceRows = (zonePriceRes.data || []) as unknown as ZonePriceRow[]
      const zonePriceByItem = new Map<string, number>()
      for (const row of priceRows) {
        if (row?.menu_item_id && row.price != null) {
          zonePriceByItem.set(row.menu_item_id, Number(row.price))
        }
      }

      setMenu(
        baseMenu.map((item) => ({
          ...item,
          price: Number.isFinite(zonePriceByItem.get(item.id))
            ? (zonePriceByItem.get(item.id) as number)
            : Number.isFinite(Number(item.price))
              ? Number(item.price)
              : 0,
        }))
      )
      setDataSource('supabase')
    } catch {
      setError('Could not load prices. Please refresh.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    if (zoneId) {
      setRated(Boolean(localStorage.getItem(buildRatedKey(zoneId))))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId])

  const getGroup = (item: MenuItem): ItemGroup => {
    const cat = (item.menu_categories?.name || '').toLowerCase().trim()
    if (!cat) return 'Others'

    if (cat.includes('cocktail') || cat.includes('mocktail')) return 'Cocktails'
    if (cat.includes('milkshake') || cat.includes('smoothie') || cat.includes('fruit punch'))
      return 'Milkshakes'

    const drinkCats = new Set([
      'drinks',
      'soft drinks',
      'wine',
      'spirits',
      'energy drink',
      'shot',
      'beer',
    ])
    if (drinkCats.has(cat)) return 'Drinks'

    if (cat === 'food' || cat.includes('food') || cat.includes('grill') || cat.includes('soup'))
      return 'Food'

    return 'Others'
  }

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return menu
    return menu.filter((item) => item.name.toLowerCase().includes(q))
  }, [menu, search])

  const groupOrder = useMemo(
    () => ['Food', 'Drinks', 'Cocktails', 'Milkshakes', 'Others'] as ItemGroup[],
    []
  )

  const groupCounts = useMemo(() => {
    const counts: Record<ItemGroup, number> = {
      Food: 0,
      Drinks: 0,
      Cocktails: 0,
      Milkshakes: 0,
      Others: 0,
    }
    for (const item of searchFiltered) counts[getGroup(item)] += 1
    return counts
  }, [searchFiltered])

  const filtered = useMemo(() => {
    if (activeGroup === 'All') return searchFiltered
    return searchFiltered.filter((item) => getGroup(item) === activeGroup)
  }, [searchFiltered, activeGroup])

  const submitRating = async (value: 'up' | 'down') => {
    if (!zoneId || ratingBusy) return
    if (rated) return
    setRatingBusy(true)
    setRatingError(null)
    try {
      const payload = {
        zone_id: zoneId,
        zone_name: zone?.name || null,
        rating: value,
      }
      const { error: insertError } = await supabase.from('service_ratings').insert(payload)
      if (insertError) throw insertError
      localStorage.setItem(buildRatedKey(zoneId), value)
      setRated(true)
    } catch {
      setRatingError('Ratings are not available right now.')
    } finally {
      setRatingBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="flex items-center gap-2 text-amber-500">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Loading prices…</span>
        </div>
      </div>
    )
  }

  if (error || !zoneId) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center">
          <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-white font-bold mb-2">Could not load</p>
          <p className="text-gray-500 text-sm mb-4">{error || 'Invalid link.'}</p>
          <button
            onClick={load}
            className="bg-amber-500 text-black font-bold px-5 py-2.5 rounded-xl inline-flex items-center gap-2"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
              <UtensilsCrossed size={17} className="text-black" />
            </div>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-sm leading-tight">Beeshop&apos;s Place</h1>
              <p className="text-amber-400 text-xs font-medium truncate">
                Prices for {zone?.name || 'Zone'}
              </p>
            </div>
          </div>
          <button
            onClick={load}
            className="text-gray-400 hover:text-white p-2 bg-gray-800 rounded-xl border border-gray-700"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="sticky top-[64px] z-20 border-b border-gray-800 bg-gray-950/95 backdrop-blur">
        <div className="max-w-lg mx-auto w-full px-4 pt-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="max-w-lg mx-auto w-full px-4 pb-4 pt-3">
          <div className="flex gap-2 overflow-x-auto">
            {(['All', ...groupOrder] as Group[]).map((g) => {
              const count = g === 'All' ? searchFiltered.length : groupCounts[g]
              if (g !== 'All' && count === 0) return null
              const active = activeGroup === g
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setActiveGroup(g)}
                  className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                  }`}
                >
                  {g}
                  <span className="ml-2 text-[10px] text-gray-500">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="border-b border-gray-800 bg-gray-900/60 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <p className="text-gray-400 text-xs font-semibold mb-2">Rate the service</p>
          <div className="flex gap-2">
            <button
              onClick={() => submitRating('up')}
              disabled={rated || ratingBusy}
              className={`flex-1 rounded-xl py-3 text-sm font-bold border transition-colors ${
                rated
                  ? 'bg-gray-800 text-gray-500 border-gray-800'
                  : 'bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/20'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <ThumbsUp size={16} /> Good
              </span>
            </button>
            <button
              onClick={() => submitRating('down')}
              disabled={rated || ratingBusy}
              className={`flex-1 rounded-xl py-3 text-sm font-bold border transition-colors ${
                rated
                  ? 'bg-gray-800 text-gray-500 border-gray-800'
                  : 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/15'
              }`}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <ThumbsDown size={16} /> Bad
              </span>
            </button>
          </div>
          {ratingError ? <p className="text-red-400 text-xs mt-2">{ratingError}</p> : null}
          {rated && !ratingError ? (
            <p className="text-gray-500 text-xs mt-2">Thanks — rating received.</p>
          ) : null}
          <p className="text-gray-600 text-[11px] mt-2">
            This QR code is for checking prices only. Orders are placed through your waitron.
          </p>
        </div>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-4">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-600">No items found</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden p-3"
              >
                <div className="w-full h-20 bg-gray-800 rounded-xl overflow-hidden mb-2 flex items-center justify-center">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <UtensilsCrossed size={18} className="text-gray-600" />
                  )}
                </div>
                <p className="text-white text-sm font-semibold leading-tight line-clamp-2">
                  {item.name}
                </p>
                <p className="text-amber-400 font-bold text-sm mt-1">
                  ₦{item.price.toLocaleString()}
                </p>
                {item.menu_categories?.name ? (
                  <p className="text-gray-500 text-[11px] mt-1 truncate">
                    {item.menu_categories.name}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {debug ? (
        <div className="max-w-lg mx-auto w-full px-4 pb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-[11px] text-gray-400 space-y-1">
            <div>
              <span className="text-gray-500">debug</span> · zoneId: {zoneId} · resolved:{' '}
              {zone?.id || '—'} ({zone?.name || '—'}) · source: {dataSource}
            </div>
            <div>
              items: {menu.length} · priced:{' '}
              {menu.filter((m) => Number.isFinite(m.price) && m.price > 0).length}
              {debugApiError ? (
                <span className="text-red-400"> · apiError: {debugApiError}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
