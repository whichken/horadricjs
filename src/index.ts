import { join } from "path"
import express, { json } from "express"

import { logger } from "./logger"
import { verifyConfigExists } from "./settings"
import { Queue } from "./queue"
import { SonarrEvent } from "./schemas/sonarr"
import { RadarrEvent } from "./schemas/radarr"

verifyConfigExists()

const app = express()
const queue = new Queue()

// Middleware
app.use(json())

// Log all incoming requests
app.use((req, _res, next) => {
  logger.debug(`[${req.ip}] ${req.method} ${req.path}`)
  if (req.body) logger.debug("Request body.", req.body)
  next()
})

app.get("/", (_req, res) => {
  return res.json({ success: true })
})

app.post(["/manual", "/manual/:tag"]).use((req, res) => {
  const event = req.body as { path: string }

  if (!event.path) return res.status(400).json({ error: "Must provide path" })

  queue.process(event.path, req.params.tag)

  return res.status(204).send()
})

app.post(["/sonarr", "/sonarr/:tag"]).use((req, res) => {
  const event = req.body as SonarrEvent

  // Check for test message
  if (event.eventType === "Test") {
    logger.success("Received test message from sonarr!")
    return res.status(200).send()
  }

  // Determine path
  let path = join(event.series.path, event.episodeFile.relativePath)
  queue.process(path, req.params.tag)

  return res.status(204).send()
})

app.post(["/radarr", "/radarr/:tag"]).use((req, res) => {
  const event = req.body as RadarrEvent

  // Check for test message
  if (event.eventType === "Test") {
    logger.success("Received test message from radarr!")
    return res.status(200).send()
  }

  // Determine path
  let path = join(event.movie.folderPath, event.movieFile.relativePath)
  queue.process(path, req.params.tag)

  return res.status(204).send()
})

app.listen(process.env.PORT || 5000, () => logger.info(`Server is listening on ${process.env.PORT || 5000}`))
