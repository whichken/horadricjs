import ffmpeg, { FfmpegCommand, FfprobeData } from "fluent-ffmpeg"
import { promisify } from "util"
import { randomBytes } from "crypto"
import { logger } from "./logger"
import { Profile, RuleClause, Rule, EncodingProfile } from "./schemas/profile"
import { parse, dirname } from "path"
import { copyFileSync, unlinkSync, mkdirSync, existsSync } from "fs"
import { Consola } from "consola"
import { getDestPath, getProfile, getSourcePath, getTempPath } from "./settings"

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
  public logger: Consola
  public requestId: string
  public profile: Profile

  public srcStreams?: Stream[]
  public destStreams?: Stream[]

  public srcPath: string
  public tempPath?: string
  public destPath?: string

  constructor(srcPath: string, profileName?: string) {
    // Assign a random id to all videos so logs can be correlated when processing concurrently
    this.requestId = randomBytes(2).toString("hex")
    this.logger = logger.withTag(`video:${this.requestId}`)

    this.profile = getProfile(profileName)

    for (const mapping of this.profile.pathMappings || [])
      if (srcPath.startsWith(mapping.from)) srcPath = srcPath.replace(mapping.from, mapping.to)
    this.srcPath = getSourcePath(srcPath)

    this.logger.info(`Request to process ${this.srcPath} with ${profileName || "default"} profile`)
  }

  async analyze() {
    if (!existsSync(this.srcPath)) {
      this.logger.warn(`Path ${this.srcPath} no longer exists or is otherwise unaccessible`)
      throw Error(`Path ${this.srcPath} no longer exists or is otherwise unaccessible`)
    }

    const ffprobe = promisify(ffmpeg.ffprobe)
    this.logger.debug("Beginning probe of source file:")

    try {
      const result = (await ffprobe(this.srcPath)) as FfprobeData
      this.srcStreams = []

      for (const stream of result.streams) {
        let bitrate = stream.bit_rate && stream.bit_rate !== "N/A" ? parseInt(stream.bit_rate) : undefined
        if (!bitrate && stream.tags?.["BPS-eng"]) bitrate = parseInt(stream.tags?.["BPS-eng"])

        const common: Stream = {
          index: stream.index,
          type: stream.codec_type! as "video" | "audio" | "subtitle",
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
              framerate = +(parseInt(parts[0]) / parseInt(parts[1])).toFixed(3)
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
            this.logger.debug(`\tIgnoring ${stream.codec_type} stream (idx:${stream.index})`)
            continue
        }

        this.logger.debug(`\t${JSON.stringify(this.srcStreams.slice(-1).pop())}`)
      }
    } catch (error) {
      this.logger.error("Unable to probe video", error)
      throw error
    }
  }

  configure() {
    this.destStreams = []

    // Set destination path
    const path = parse(this.srcPath)
    let filename = (this.profile.fileRenames || []).reduce(
      (prev, current) => prev.replace(new RegExp(current.regex), current.substitution),
      path.name
    )
    this.destPath = getDestPath(path.dir, `${filename}.${this.profile.extension || "mkv"}`)
    this.tempPath = getTempPath(`${randomBytes(16).toString("hex")}.${this.profile.extension || "mkv"}`)

    this.logger.debug(`Set temporary encode path to ${this.tempPath}`)
    this.logger.debug(`Set destination path to ${this.destPath}`)

    // Select the appropriate streams
    this.logger.debug("Selecting streams to include in output:")
    for (const type of ["video", "audio", "subtitle"]) {
      let primary: Stream
      if (this.profile.selection[type]?.primary)
        primary = this.srcStreams
          .filter(s => s.type === type)
          .find(s => this.profile.selection[type].primary.some(r => new RuleEvaluator(r).evaluate(s)))

      if (!primary && type !== "subtitle") {
        primary = this.srcStreams.filter(s => s.type === type).pop()
        this.logger.debug(`\tNo ${type} stream passed primary rules. Using the first available stream.`)
      }

      if (primary) {
        this.destStreams.push({ ...primary, primary: true })
        this.logger.debug(`\t${JSON.stringify({ index: primary.index, type: primary.type, primary: true })}`)
      }

      // Select any secondary streams that should be used
      if (this.profile.selection[type]?.allowSecondary && this.profile.selection[type]?.secondary) {
        const secondary = this.srcStreams
          .filter(s => s.type === type && s !== primary)
          .filter(s => this.profile.selection[type].secondary.some(r => new RuleEvaluator(r).evaluate(s)))
          .map(s => ({ ...s, primary: false }))
        this.destStreams.push(...secondary)
        secondary.forEach(s =>
          this.logger.debug(`\t${JSON.stringify({ index: s.index, type: s.type, primary: false })}`)
        )
      }
    }

    // Execute all streams thru the rule engine to determine their encoding settings
    this.logger.debug("Determining encoding settings:")
    for (const stream of this.destStreams) {
      // Default to just copying the stream if no rule changes it
      stream.profile = { codec: "copy" }

      for (const rule of this.profile.encoder.filter(r => r.type === stream.type))
        if (new RuleEvaluator(rule).evaluate(stream)) stream.profile = { ...stream.profile, ...rule.result }

      this.logger.debug(
        `\t${JSON.stringify({
          index: stream.index,
          codec: stream.profile.codec,
          ...(stream.profile.codec !== "copy" && { ...stream.profile })
        })}`
      )
    }
  }

  async encode() {
    return new Promise((resolve, reject) => {
      let command: FfmpegCommand = ffmpeg(this.srcPath)

      for (const [index, stream] of this.destStreams.entries()) {
        command.addOption(`-map 0:${stream.index}`)

        command.addOption(`-c:${index} ${stream.profile.codec}`)

        if (stream.profile.codec !== "copy") {
          const filters: string[] = []
          if (stream.profile.size) filters.push(`scale=${stream.profile.size}`)
          if (stream.profile.tonemap)
            filters.push(
              "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
            )
          if (filters.length) command.complexFilter(`[0:${stream.index}]${filters.join(",")}`)

          if (stream.profile.crf) command.addOption(`-crf ${stream.profile.crf}`)
          if (stream.profile.bitrate) command.addOption(`-b:${index} ${stream.profile.bitrate}`)
          if (stream.profile.preset) command.addOption(`-preset ${stream.profile.preset}`)
          if (stream.profile.tune) command.addOption(`-tune ${stream.profile.tune}`)
        }
      }

      // Promise callbacks
      command.on("end", (stdout: string, stderr: string) => {
        this.logger.info("Encoding completed successfully")
        resolve(this.tempPath)
      })
      command.on("error", (err, stdout, stderr) => reject(err))

      // Other callbacks
      let throttled = false
      command.on("stderr", (stderr: string) => {
        if (stderr.startsWith("frame=") && !throttled) {
          this.logger.debug(stderr)
          throttled = true
          setTimeout(() => (throttled = false), 60000)
        }
      })

      command.on("start", (command: string) => {
        this.logger.info("Starting encode")
        this.logger.debug(command)
      })

      // Start encode
      command.save(this.tempPath)
    })
  }

  move() {
    try {
      // Make sure the output directory exists
      mkdirSync(dirname(this.destPath), { recursive: true })
      copyFileSync(this.tempPath, this.destPath)
      unlinkSync(this.tempPath)
      this.logger.success(`Successfully created ${this.destPath}`)
    } catch (error) {
      this.logger.error("Unable to move file to final location.", error)
    }
  }
}
