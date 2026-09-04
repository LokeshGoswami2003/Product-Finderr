const { start } = require('./src/server')

start().catch((error) => {
  process.stderr.write(`Server startup failed: ${error.message}\n`)
  process.exitCode = 1
})