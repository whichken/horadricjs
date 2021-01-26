import { join, resolve } from "path"
import { existsSync, copyFileSync } from "fs"
import { Profile } from "./schemas/profile"
import { logger } from "./logger"

const CONFIG_FILE = resolve(join(process.env.CONFIG_DIR || "./", "config.json"))
const DATA_DIR = resolve(process.env.DATA_DIR || "../test/")
const TRANSCODE_DIR = resolve(process.env.TRANSCODE_DIR || "../transcode/")
const OUT_DIR = resolve(process.env.OUT_DIR || "../out/")

function verifyConfigExists() {
  if (!existsSync(CONFIG_FILE)) {
    copyFileSync("config.default.json", CONFIG_FILE)
    logger.warn("Configuration file not found. Creating one with defaults.")
  }
}

function getProfile(profileName?: string): Profile {
  const config = require(CONFIG_FILE)
  return config.profiles[profileName] || config.profiles.default
}

function getSourcePath(path: string): string {
  return join(DATA_DIR, path)
}

function getTempPath(path: string): string {
  return join(TRANSCODE_DIR, path)
}

function getDestPath(srcDir: string, filename: string): string {
  return join(srcDir.replace(DATA_DIR, OUT_DIR), filename)
}

export { getProfile, getSourcePath, getTempPath, getDestPath, verifyConfigExists }
