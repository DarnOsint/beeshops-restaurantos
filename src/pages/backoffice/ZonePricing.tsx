import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Save } from 'lucide-react'

interface MenuItem {
  id: string
  name: string
  price: number
  menu_categories?: { name?: string; destination?: string } | null
}
interface Zone {
  id: string
  name: string
}
interface Props {
  onBack: () => void
}

export default function ZonePricing({ onBack }: Props) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [prices, setPrices] = useState<Record<string, number | string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('All')
  const [menuCategories, setMenuCategories] = useState<string[]>([])

  const fetchAll = async () => {
    const [itemsRes, zonesRes, pricesRes] = await Promise.all([
      supabase.from('menu_items').select('*, menu_categories(name, destination)').order('name'),
      supabase.from('table_categories').select('*').order('name'),
      supabase.from('menu_item_zone_prices').select('*'),
    ])
    const barItems = (itemsRes.data || []).filter(
      (i: MenuItem) => i.menu_categories?.destination === 'bar'
    ) as MenuItem[]
    setItems(barItems)
    setZones((zonesRes.data || []) as Zone[])
    setMenuCategories([
      'All',
      ...new Set(barItems.map((i) => i.menu_categories?.name).filter(Boolean)),
    ] as string[])
    const priceMap: Record<string, number> = {}
    ;(pricesRes.data || []).forEach(
      (p: { menu_item_id: string; category_id: string; price: number }) => {
        priceMap[`${p.menu_item_id}_${p.category_id}`] = p.price
      }
    )
    setPrices(priceMap)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [])

  const getPrice = (itemId: string, zoneId: string) => prices[`${itemId}_${zoneId}`] ?? ''
  const setPrice = (itemId: string, zoneId: string, value: string) =>
    setPrices((prev) => ({ ...prev, [`${itemId}_${zoneId}`]: value }))

  const saveAll = async () => {
    setSaving(true)
    const upserts: { menu_item_id: string; category_id: string; price: number }[] = []
    items.forEach((item) =>
      zones.forEach((zone) => {
        const val = prices[`${item.id}_${zone.id}`]
        if (val !== '' && val !== undefined && val !== null)
          upserts.push({
            menu_item_id: item.id,
            category_id: zone.id,
            price: parseFloat(String(val)),
          })
      })
    )
    if (upserts.length > 0) {
      const { error } = await supabase
        .from('menu_item_zone_prices')
        .upsert(upserts, { onConflict: 'menu_item_id,category_id' })
      if (error) {
        alert('Error saving: ' + error.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    alert('Zone prices saved successfully!')
  }

  const filtered =
    filterCat === 'All' ? items : items.filter((i) => i.menu_categories?.name === filterCat)

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold">Zone Pricing</h1>
            <p className="text-gray-400 text-xs">Set drink prices per zone</p>
          </div>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
        >
          <Save size={16} /> {saving ? 'Saving...' : 'Save All Prices'}
        </button>
      </div>
      <div className="p-6">
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {menuCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${filterCat === cat ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No bar items found</div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-400 text-xs uppercase tracking-wide px-4 py-3 font-medium">
                      Item
                    </th>
                    <th className="text-left text-gray-400 text-xs uppercase tracking-wide px-4 py-3 font-medium">
                      Base ₦
                    </th>
                    {zones.map((zone) => (
                      <th
                        key={zone.id}
                        className="text-left text-gray-400 text-xs uppercase tracking-wide px-4 py-3 font-medium whitespace-nowrap"
                      >
                        {zone.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-800 last:border-0 ${idx % 2 === 0 ? '' : 'bg-gray-800/30'}`}
                    >
                      <td className="px-4 py-3">
                        <p className="text-white text-sm font-medium">{item.name}</p>
                        <p className="text-gray-500 text-xs">{item.menu_categories?.name}</p>
                      </td>
                      <td className="px-4 py-3 text-amber-400 text-sm font-bold">
                        ₦{item.price.toLocaleString()}
                      </td>
                      {zones.map((zone) => (
                        <td key={zone.id} className="px-4 py-3">
                          <input
                            type="number"
                            value={getPrice(item.id, zone.id)}
                            onChange={(e) => setPrice(item.id, zone.id, e.target.value)}
                            placeholder={String(item.price)}
                            className="w-24 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
