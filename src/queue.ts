import pLimit, { Limit } from "p-limit"
import { logger } from "./logger"
import { VideoFile } from "./video"

export class Queue {
  private queue: Limit
  constructor() {
    const concurrency = process.env.CONCURRENCY || "2"
    this.queue = pLimit(parseInt(concurrency))
  }

  process(path: string, profileName?: string) {
    const video = new VideoFile(path, profileName)

    // Check if a delay exists on the profile
    if (video.profile.delay) {
      const now = new Date()
      now.setMinutes(now.getMinutes() + video.profile.delay)
      video.logger.info(`Delaying encoding until ${now.toISOString()}`)
    }

    setTimeout(() => {
      logger.debug(`There are ${this.queue.activeCount} active encodes and ${this.queue.pendingCount} waiting`)
      this.queue(async () => {
        try {
          await video.analyze()
          video.configure()
          await video.encode()
          video.move()
        } catch (error) {
          logger.error("An error occurred while encoding this file.", error)
        }
      })
    }, video.profile.delay * 60000)
  }
}
