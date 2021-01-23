import express, { json } from "express"
import { logger } from "./logger"
import { SonarrEvent } from "./schemas/sonarr"
import { VideoFile } from "./video"
import config from "./config.json"
import { Profile } from "./schemas/profile"

const app = express()

// Middleware
app.use(json())

// Log all incoming requests
app.use((req, _res, next) => {
  logger.info(`[${req.ip}] ${req.method} ${req.path}`)
  next()
})

app.get("/test/:file", async (req, res) => {
  const video = new VideoFile(`./test/${req.params.file}.mkv`)
  await video.analyze()
  video.configure(config.profiles.default as any)
  const result = await video.encode()
  return res.json(result)
  // return res.json()
})

app
  .post("/sonarr")
  .post("/sonarr/:tag")
  .use((req, res) => {
    const event = req.body as SonarrEvent

    // Check for test message
    if (event.eventType === "Test") {
      logger.success("Received test message from sonarr!")
      logger.debug("Message", req.body)
      return res.status(200).send()
    }

    // Use the correct profile
    const profile: Profile = config.profiles[req.params.key] || config.profiles.default

    // Determine path
    let path = event.episodeFile.path
    for (const prefix of profile.pathPrefixes) if (path.startsWith(prefix)) path.replace(prefix, "")

    logger.info(`Request to process ${path} with ${req.params.key || "default"} profile.`)
    if (profile.delay) logger.debug(`Delaying encode for ${profile.delay} minutes.`)

    setTimeout(
      async (path, profile) => {
        // Encode lifecycle
        try {
          const video = new VideoFile(`/data/${path}`)
          await video.analyze()
          video.configure(profile)
          await video.encode()
          video.move()
        } catch (error) {
          logger.error("An error occurred when encoding this file.", error)
        }
      },
      (profile.delay || 0) * 60000,
      path,
      profile
    )

    return res.status(204).send()
  })

app.listen(5000, () => logger.success("Server is listening"))
