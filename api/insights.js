const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Reject requests that don't carry the internal secret
  const authHeader = req.headers['x-internal-secret']
  if (!INTERNAL_SECRET || authHeader !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req.body)
  })

  const data = await response.json()
  res.status(response.status).json(data)
}
