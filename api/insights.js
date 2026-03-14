const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['x-internal-secret']
  if (!INTERNAL_SECRET || authHeader !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // SECURITY: never forward req.body directly to Anthropic.
  // Only extract the user data payload — model, system prompt, and
  // max_tokens are hardcoded here and cannot be overridden by the client.
  const { prompt } = req.body
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' })
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system:
        "You are a hospitality business analyst for Beeshop's Place Lounge, a Nigerian restaurant and bar. Analyze the performance data provided and give 5-6 sharp, actionable bullet-point insights. Be specific with numbers. Use Nigerian Naira symbol ₦. No headers, just bullet points starting with •.",
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await response.json()
  res.status(response.status).json(data)
}
