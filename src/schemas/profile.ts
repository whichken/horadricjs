export type Config = {
  profiles: {
    [profileName: string]: Profile
  }
}

export type Profile = {
  extension?: string
  pathMappings?: { from: string; to: string }[]
  fileRenames?: { regex: string; substitution: string }[]
  delay?: number
  selection: {
    video?: {
      primary?: (Rule & { type: "video" })[]
    }
    audio: {
      allowSecondary: boolean
      primary?: (Rule & { type: "audio" })[]
      secondary?: (Rule & { type: "audio" })[]
    }
    sub: {
      allowSecondary: boolean
      primary?: (Rule & { type: "sub" })[]
      secondary?: (Rule & { type: "sub" })[]
    }
  }
  encoder: Rule[]
}

export type EncodingProfile = {
  codec: string
  crf?: string
  bitrate?: string
  size?: string
  crop?: string | boolean
  preset?: string
  tune?: string
  tonemap?: boolean
  skip?: boolean
}

export type Rule = {
  type: "video" | "audio" | "sub"
  /** An optional human readable description of the rule. Its only purpose is to make the rule easier to understand. */
  description?: string
  rules?: RuleClause[]
  result: EncodingProfile
}

export type RuleClause = {
  property: string
  operator: ">" | ">=" | "<" | "<=" | "==" | "!=" | "contains"
  value: string | number | boolean
}
