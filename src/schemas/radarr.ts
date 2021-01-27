export type RadarrEvent = {
  eventType: "Download" | "Rename" | "Test"
  movie: {
    id: number
    title: string
    releaseDate: string
    folderPath: string
    tmdbId: number
    imdbId: string
  }
  remoteMovie: {
    tmdbId: number
    imdbId: string
    title: string
    year: number
  }
  movieFile: {
    id: number
    relativePath: string
    path: string
    quality: string | undefined
    qualityVersion: number | undefined
    releaseGroup: string | undefined
    sceneName: string | undefined
    size: number
  }
  isUpgrade: boolean | undefined
  downloadId: string | undefined
}
