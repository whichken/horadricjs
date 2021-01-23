import consola, { LogLevel } from "consola"

// consola.level = process.env.DEBUG ? LogLevel.Debug : LogLevel.Info
consola.level = LogLevel.Debug

export { consola as logger }
