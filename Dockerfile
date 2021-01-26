FROM node:12 as build
WORKDIR /usr/app

# Install ffmpeg
RUN wget https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz && \
  wget https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz.md5 && \
  md5sum -c ffmpeg-git-amd64-static.tar.xz.md5 && \
  tar -xf ffmpeg-git-amd64-static.tar.xz --strip-components 1 -C /bin --wildcards --no-anchored 'ffmpeg' && \
  tar -xf ffmpeg-git-amd64-static.tar.xz --strip-components 1 -C /bin --wildcards --no-anchored 'ffprobe' && \
  rm ffmpeg-git-amd64-static.tar.xz*

# Install dependencies
COPY package.json .
RUN yarn

# Compile the typescript
COPY . .
RUN yarn build


FROM node:12-alpine
WORKDIR /usr/app

# Copy over the artifacts from the build stage
COPY --from=build ["/bin/ffmpeg", "/bin/ffprobe", "/bin/"]
COPY --from=build /usr/app/node_modules /usr/node_modules
COPY --from=build /usr/app/build /usr/app

EXPOSE 5000

VOLUME ["/data", "/out", "/config", "/transcode"]

ENV PORT=5000 \
  DATA_DIR=/data/ \
  OUT_DIR=/out/ \
  CONFIG_DIR=/config/ \
  TRANSCODE_DIR=/transcode/

CMD [ "node", "index.js" ]
