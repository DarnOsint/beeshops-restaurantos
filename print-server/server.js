// Beeshop's Place — Local Print Server
// Runs on localhost:6543 on the POS machine
// Receives ESC/POS bytes from the browser and forwards to printer IP:9100
// Config: reads printer IP from config.json if present, else uses default

const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')

// Load config
let config = { printer_ip: '192.168.0.10', printer_port: 9100, server_port: 6543 }
const configPath = path.join(__dirname, 'config.json')
try {
  if (fs.existsSync(configPath)) {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config = { ...config, ...loaded }
    console.log('Config loaded from config.json')
  }
} catch (e) {
  console.log('Using default config')
}

const PRINTER_IP = config.printer_ip
const PRINTER_PORT = config.printer_port
const SERVER_PORT = config.server_port

// CORS headers so beeshop.place can call localhost
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
    // Test printer connection
    let printerStatus = 'unknown'
    try {
      await new Promise((resolve, reject) => {
        const sock = new net.Socket()
        sock.setTimeout(2000)
        sock.connect(PRINTER_PORT, PRINTER_IP, () => {
          printerStatus = 'reachable'
          sock.destroy()
          resolve()
        })
        sock.on('error', () => { printerStatus = 'unreachable'; sock.destroy(); resolve() })
        sock.on('timeout', () => { printerStatus = 'timeout'; sock.destroy(); resolve() })
      })
    } catch { printerStatus = 'error' }

    res.writeHead(200, CORS_HEADERS)
    res.end(JSON.stringify({
      status: 'ok',
      printer: `${PRINTER_IP}:${PRINTER_PORT}`,
      printer_status: printerStatus,
      server_port: SERVER_PORT,
    }))
    return
  }

  // Config endpoint — update printer IP
  if (req.method === 'POST' && req.url === '/config') {
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
      try {
        const buf = Buffer.concat(body)
        const newConfig = JSON.parse(buf.toString())
        const updated = { ...config, ...newConfig }
        fs.writeFileSync(configPath, JSON.stringify(updated, null, 2))
        config = updated
        res.writeHead(200, CORS_HEADERS)
        res.end(JSON.stringify({ success: true, config: updated }))
        console.log(`Config updated: printer=${updated.printer_ip}:${updated.printer_port}`)
      } catch (err) {
        res.writeHead(400, CORS_HEADERS)
        res.end(JSON.stringify({ error: err.message }))
      }
    })
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

server.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log('='.repeat(50))
  console.log("  Beeshop's Place — Print Server")
  console.log('='.repeat(50))
  console.log(`  Listening on  0.0.0.0:${SERVER_PORT}`)
  console.log(`  Printer IP    ${PRINTER_IP}:${PRINTER_PORT}`)
  console.log('='.repeat(50))
  console.log('  Ready to receive print jobs...')
  console.log()
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${SERVER_PORT} already in use. Print server may already be running.`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
