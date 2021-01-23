// https://github.com/Sonarr/Sonarr/wiki/Webhook-Schema
export type SonarrEvent = {
  eventType: "Grab" | "Download" | "Rename" | "Test"
  series: {
    id: number
    title: string
    path: string
    tvdbId: number | undefined
  }
  episodes: {
    id: number
    episodeNumber: number
    seasonNumber: number
    title: string
    airDate: string | undefined
    airDateUtc: string | undefined
  }[]
  release: {
    quality: string | undefined
    qualityVersion: number | undefined
    releaseGroup: string | undefined
    releaseTitle: string | undefined
    indexer: string | undefined
    size: number | undefined
  }
  episodeFile: {
    id: number
    relativePath: string
    path: string
    quality: string | undefined
    qualityVersion: string | undefined
    releaseGroup: string | undefined
    sceneName: string | undefined
  }
  isUpgrade: boolean | undefined
}
