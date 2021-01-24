import ffmpeg, { FfmpegCommand, FfprobeData } from "fluent-ffmpeg"
import { promisify } from "util"
import { randomBytes } from "crypto"
import { logger } from "./logger"
import { Profile, RuleClause, Rule, EncodingProfile } from "./schemas/profile"
import { parse, sep, dirname } from "path"
import { copyFileSync, unlinkSync, mkdirSync } from "fs"

type Stream = {
  // Only guaranteed fields
  index: number
  type: "video" | "audio" | "subtitle"
  codec: string
  profile?: EncodingProfile

  // Common to all types, but not guaranteed to be known
  primary?: boolean
  title?: string
  language?: string
  bitrate?: number

  // video
  width?: number
  height?: number
  framerate?: number
  hdr?: boolean

  // audio
  channels?: number
  sampleRate?: number
}

class RuleEvaluator {
  constructor(public rule: Rule) {}

  evaluate(stream: object) {
    if (!this.rule.rules) return true
    return this.rule.rules.every(c => RuleEvaluator.evaluateClause(c, stream))
  }

  static evaluateClause(clause: RuleClause, stream: object) {
    const value = stream?.[clause.property]

    switch (clause.operator) {
      case ">":
        return value > clause.value
      case ">=":
        return value >= clause.value
      case "<":
        return value < clause.value
      case "<=":
        return value <= clause.value
      case "==":
        return value == clause.value
      case "!=":
        return value != clause.value
      case "contains":
        return (
          typeof value === "string" && value.toString().toLowerCase().includes(clause.value.toString().toLowerCase())
        )
      default:
        throw Error(`Invalid operator ${clause.operator}`)
    }
  }
}

export class VideoFile {
  public srcStreams?: Stream[]
  public destStreams?: Stream[]

  public tempPath?: string
  public destPath?: string

  constructor(public srcPath: string) {}

  async analyze() {
    const ffprobe = promisify(ffmpeg.ffprobe)

    try {
      const result = (await ffprobe(this.srcPath)) as FfprobeData
      logger.debug("Probe", JSON.stringify(result))
      this.srcStreams = []

      for (const stream of result.streams) {
        let bitrate = stream.bit_rate && stream.bit_rate !== "N/A" ? parseInt(stream.bit_rate) : undefined
        if (!bitrate && stream.tags?.["BPS-eng"]) bitrate = parseInt(stream.tags?.["BPS-eng"])

        const common: Stream = {
          type: stream.codec_type! as "video" | "audio" | "subtitle",
          index: stream.index,
          codec: stream.codec_name!,
          language: stream.tags?.language,
          title: stream.tags?.title,
          bitrate
        }

        switch (stream.codec_type) {
          case "video":
            let framerate = stream.r_frame_rate ? parseFloat(stream.r_frame_rate) : undefined
            if (stream.r_frame_rate?.includes("/")) {
              const parts = stream.r_frame_rate.split("/")
              framerate = parseInt(parts[0]) / parseInt(parts[1])
            }

            this.srcStreams.push({
              ...common,
              width: stream.width,
              height: stream.height,
              framerate: stream.r_frame_rate ? framerate : undefined,
              hdr: stream.color_space == "bt2020nc"
            })
            break

          case "audio":
            this.srcStreams.push({
              ...common,
              channels: stream.channels,
              sampleRate: stream.sample_rate
            })
            break

          case "subtitle":
            this.srcStreams.push({ ...common })
            break

          default:
            break
        }
      }
    } catch (error) {
      logger.error("Unable to analyze file!", error)
    }
  }

  configure(profile: Profile) {
    this.destStreams = []

    // Set destination path
    const path = parse(this.srcPath)
    this.destPath = `${path.dir.replace("/data/", "/out/")}${sep}${path.name} HEVC.${profile.extension || "mkv"}`
    this.tempPath = `/transcode/${randomBytes(16).toString("hex")}.${profile.extension || "mkv"}`

    // Select the appropriate streams
    for (const type of ["video", "audio", "subtitle"]) {
      let primary: Stream
      if (profile.selection[type]?.primary)
        primary = this.srcStreams
          .filter(s => s.type === type)
          .find(s => profile.selection[type].primary.some(r => new RuleEvaluator(r).evaluate(s)))

      if (!primary && type !== "subtitle") {
        primary = this.srcStreams.filter(s => s.type === type).pop()
        logger.warn(`No ${type} stream passed primary rules. Failing over to using the first available stream.`)
      }

      if (primary) {
        this.destStreams.push({ ...primary, primary: true })
        logger.debug(`Primary ${type} selected.`, primary)
      }

      // Select any secondary streams that should be used
      if (profile.selection[type]?.allowSecondary && profile.selection[type]?.secondary) {
        const secondary = this.srcStreams
          .filter(s => s.type === type && s !== primary)
          .filter(s => profile.selection[type].secondary.some(r => new RuleEvaluator(r).evaluate(s)))
          .map(s => ({ ...s, primary: false }))
        this.destStreams.push(...secondary)
        secondary.forEach(s => logger.debug(`Secondary ${type} selected.`, s))
      }
    }

    // Execute all streams thru the rule engine to determine their encoding settings
    for (const stream of this.destStreams) {
      // Default to just copying the stream if no rule changes it
      stream.profile = { codec: "copy" }

      for (const rule of profile.encoder.filter(r => r.type === stream.type))
        if (new RuleEvaluator(rule).evaluate(stream)) stream.profile = { ...stream.profile, ...rule.result }

      logger.debug(
        `Encoding settings selected for ${stream.primary ? "primary" : "secondary"} ${stream.type} (idx: ${
          stream.index
        }).`,
        stream.profile
      )
    }
  }

  async encode() {
    return new Promise((resolve, reject) => {
      let command: FfmpegCommand = ffmpeg(this.srcPath)

      for (const stream of this.destStreams) {
        command.addOption(`-map 0:${stream.index}`)

        const filters: string[] = []
        if (stream.profile.size) filters.push(`scale=${stream.profile.size}`)
        if (stream.profile.tonemap)
          filters.push(
            "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
          )
        // if (filters.length) command.addOption(`-filter:${stream.index} "${filters.join(",")}"`)
        if (filters.length) command.complexFilter(`[0:${stream.index}]${filters.join(",")}`)

        command.addOption(`-c:${stream.index} ${stream.profile.codec}`)

        if (stream.profile.codec !== "copy") {
          if (stream.profile.crf) command.addOption(`-crf ${stream.profile.crf}`)
          if (stream.profile.bitrate) command.addOption(`-b:${stream.index} ${stream.profile.bitrate}`)
        }
      }

      // Promise callbacks
      command.on("end", (stdout: string, stderr: string) => {
        logger.info("Encoding finished.")
        resolve(this.tempPath)
      })
      command.on("error", (err, stdout, stderr) => reject(err))

      // Other callbacks
      let lastUpdate = new Date()
      command.on("progress", (progress: any) => {
        // Progress updates come often. Throw a regulator on there so as not to drown in updates.
        const threshold = new Date()
        threshold.setSeconds(threshold.getSeconds() - 5)
        if (lastUpdate > threshold) return
        lastUpdate = new Date()
        logger.debug("Encoding progress.", { time: progress.timemark, fps: progress.currentFps })
      })

      command.on("start", (command: string) => logger.debug("Starting encode.", { command }))

      // Start encode
      command.save(this.tempPath)
    })
  }

  move() {
    // Make sure the output directory exists
    mkdirSync(dirname(this.destPath), { recursive: true })
    copyFileSync(this.tempPath, this.destPath)
    unlinkSync(this.tempPath)
  }
}
