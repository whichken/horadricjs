import express, { json } from "express"
import { logger } from "./logger"
import { SonarrEvent } from "./schemas/sonarr"
import { VideoFile } from "./video"
import config from "./config.json"
import { Profile } from "./schemas/profile"
import { sep } from "path"

const app = express()

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

app.get("/test/:file", async (req, res) => {
  const video = new VideoFile(`./test/${req.params.file}.mkv`)
  await video.analyze()
  video.configure()
  video.encode()
  return res.json({ success: true })
})

app
  .post("/sonarr")
  .post("/sonarr/:tag")
  .use((req, res) => {
    const event = req.body as SonarrEvent

    // Check for test message
    if (event.eventType === "Test") {
      logger.success("Received test message from sonarr!")
      return res.status(200).send()
    }

    // Determine path
    let path = `${event.series.path}${sep}${event.episodeFile.relativePath}`

    setTimeout(
      async (path, profileName) => {
        // Encode lifecycle
        try {
          const video = new VideoFile(`/data/${path}`, profileName)
          await video.analyze()
          video.configure()
          await video.encode()
          video.move()
        } catch (error) {
          logger.error("An error occurred when encoding this file.", error)
        }
      },
      0,
      path,
      req.params.key
    )

    return res.status(204).send()
  })

app.listen(process.env.PORT || 5000, () => logger.info(`Server is listening on ${process.env.PORT || 5000}`))
