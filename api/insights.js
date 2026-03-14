export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // SECURITY: never forward req.body directly to Anthropic.
  // Only extract the user data payload — model, system prompt, and
  // max_tokens are hardcoded here and cannot be overridden by the client.
  const { prompt } = req.body
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' })
  }

  // Forward to Anthropic
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:
        "You are a hospitality business analyst for Beeshop's Place Lounge, a Nigerian restaurant and bar. Analyze the performance data provided and give 5-6 sharp, actionable bullet-point insights. Be specific with numbers. Use Nigerian Naira symbol ₦. No headers, just bullet points starting with •.",
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await response.json()
  if (!response.ok) {
    console.error('Anthropic API error:', response.status, JSON.stringify(data))
    return res.status(502).json({ error: data.error?.message || 'Anthropic API error' })
  }
  res.status(200).json(data)
}
