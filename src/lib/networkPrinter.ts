// Network print client — talks to local print server on localhost:6543
// The print server forwards bytes to the thermal printer at 192.168.0.10:9100

const PRINT_SERVER = 'http://localhost:6543'

export async function isNetworkPrinterAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${PRINT_SERVER}/health`, {
      signal: AbortSignal.timeout(1000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function printViaNetwork(data: Uint8Array): Promise<boolean> {
  try {
    const res = await fetch(`${PRINT_SERVER}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: Array.from(data) }),
      signal: AbortSignal.timeout(8000),
    })
    const json = await res.json()
    return json.success === true
  } catch {
    return false
  }
}
