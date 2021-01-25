import consola, { LogLevel, BasicReporter } from "consola"

const logger = consola.create({
  reporters: [new BasicReporter()],
  level: process.env.DEBUG ? LogLevel.Debug : LogLevel.Info
})

logger.debug("Debug mode enabled. Logging will be noisy.")

export { logger }
