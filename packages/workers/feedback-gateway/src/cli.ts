import { feedbackGatewayConfigFromEnv, createConfiguredFeedbackGateway } from './config.js'
import { createFeedbackGatewayServer } from './server.js'

const config = feedbackGatewayConfigFromEnv()
const service = createConfiguredFeedbackGateway(config)
const server = createFeedbackGatewayServer({
  service,
  ...(config.authToken ? { authToken: config.authToken } : {}),
  maxBodyBytes: config.maxBodyBytes
})

server.listen(config.port, config.host, () => {
  console.log(`[feedback-gateway] listening on http://${config.host}:${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) {
        console.error('[feedback-gateway] shutdown failed:', error.message)
        process.exitCode = 1
      }
    })
  })
}
