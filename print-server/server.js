// Beeshop's Place — Local Print Server
// Runs on localhost:6543 on the POS machine
// Receives ESC/POS bytes from the browser and forwards to printer IP:9100

const http = require('http')
const net = require('net')

const PRINTER_IP = '192.168.0.10'
const PRINTER_PORT = 9100
const SERVER_PORT = 6543

// CORS headers so beeshop.place can call localhost
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Printer connection timed out'))
    }, 5000)

    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(data, (err) => {
        if (err) {
          clearTimeout(timeout)
          socket.destroy()
          reject(err)
          return
        }
        // Give printer time to receive before closing
        setTimeout(() => {
          clearTimeout(timeout)
          socket.destroy()
          resolve()
        }, 500)
      })
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

const server = http.createServer(async (req, res) => {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, CORS_HEADERS)
    res.end(JSON.stringify({ status: 'ok', printer: `${PRINTER_IP}:${PRINTER_PORT}` }))
    return
  }

  // Print endpoint
  if (req.method === 'POST' && req.url === '/print') {
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(body)
        const json = JSON.parse(buf.toString())

        if (!json.data || !Array.isArray(json.data)) {
          res.writeHead(400, CORS_HEADERS)
          res.end(JSON.stringify({ error: 'Missing data array' }))
          return
        }

        const printData = Buffer.from(json.data)
        await sendToPrinter(printData)
        console.log(`[${new Date().toLocaleTimeString()}] Printed ${printData.length} bytes OK`)
        res.writeHead(200, CORS_HEADERS)
        res.end(JSON.stringify({ success: true, bytes: printData.length }))
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Print error:`, err.message)
        res.writeHead(500, CORS_HEADERS)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  res.writeHead(404, CORS_HEADERS)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(SERVER_PORT, '127.0.0.1', () => {
  console.log('╔════════════════════════════════════════╗')
  console.log("║   Beeshop's Place — Print Server       ║")
  console.log('╠════════════════════════════════════════╣')
  console.log(`║  Listening on  localhost:${SERVER_PORT}          ║`)
  console.log(`║  Printer IP    ${PRINTER_IP}:${PRINTER_PORT}        ║`)
  console.log('╠════════════════════════════════════════╣')
  console.log('║  Ready to receive print jobs...        ║')
  console.log('╚════════════════════════════════════════╝')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${SERVER_PORT} already in use. Print server may already be running.`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
