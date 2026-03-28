// Network print client — talks to a local print server on the venue's LAN.
// The print server IP/port is configurable (defaults to localhost:6543 for dev).

let printServerUrl = 'http://localhost:6543'

/** Set the print server URL at runtime (called from settings/config) */
export function setPrintServerUrl(url: string) {
  printServerUrl = url
}

export async function isNetworkPrinterAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${printServerUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function printViaNetwork(data: Uint8Array): Promise<boolean> {
  try {
    const res = await fetch(`${printServerUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: Array.from(data) }),
      signal: AbortSignal.timeout(5000),
    })
    const json = await res.json()
    return json.success === true
  } catch {
    return false
  }
}
