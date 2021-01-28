import { join } from "path"
import { lstatSync, existsSync, readdirSync } from "fs"
import express, { json } from "express"

import { logger } from "./logger"
import { getProfile, getSourcePath, verifyConfigExists } from "./settings"
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

app.post("/manual(/:profile)?", (req, res) => {
  const event = req.body as { path: string }

  if (!event.path) return res.status(400).json({ error: "Must provide path" })

  // Allow directories instead of just a file
  const profile = getProfile(req.params.profile)
  let path = event.path
  for (const mapping of profile.pathMappings || [])
    if (path.startsWith(mapping.from)) path = path.replace(mapping.from, mapping.to)
  path = getSourcePath(path)

  if (!existsSync(path)) return res.status(400).json({ error: "Path doesn't exist" })

  if (lstatSync(path).isDirectory()) {
    const files = readdirSync(path)
    files.forEach(file => queue.process(join(event.path, file), req.params.profile))
  } else {
    queue.process(event.path, req.params.profile)
  }

  return res.status(204).send()
})

app.post("/sonarr(/:profile)?", (req, res) => {
  const event = req.body as SonarrEvent

  // Check for test message
  if (event.eventType === "Test") {
    logger.success("Received test message from sonarr!")
    return res.status(200).send()
  }

  // Determine path
  let path = join(event.series.path, event.episodeFile.relativePath)
  queue.process(path, req.params.profile)

  return res.status(204).send()
})

app.post("/radarr(/:profile)?", (req, res) => {
  const event = req.body as RadarrEvent

  // Check for test message
  if (event.eventType === "Test") {
    logger.success("Received test message from radarr!")
    return res.status(200).send()
  }

  // Determine path
  let path = join(event.movie.folderPath, event.movieFile.relativePath)
  queue.process(path, req.params.profile)

  return res.status(204).send()
})

app.listen(process.env.PORT || 5000, () => logger.info(`Server is listening on ${process.env.PORT || 5000}`))
