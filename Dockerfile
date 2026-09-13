# Chalk ingest, for the always-on box (Defiant) rather than GitHub Actions.
#
# This image is the repo-root scripts only. web/ is excluded by .dockerignore:
# the site is deployed to Vercel and has its own dependency tree, and pulling it
# in here would double the image for code that never runs.
FROM node:22-bookworm-slim

# Everything in this container is scheduled against Central time, which is where
# the box lives. Cron reads /etc/localtime rather than $TZ, so both are set; the
# entrypoint re-does this at runtime in case TZ is overridden by compose.
ENV TZ=America/Chicago
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends cron tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime \
 && echo "$TZ" > /etc/timezone

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the tree. The root
# package.json has no devDependencies, so this is the whole of it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x docker/entrypoint.sh docker/run-job.sh docker/healthcheck.sh

# Bind-mounted from the host so a run survives the container being rebuilt.
VOLUME ["/app/logs"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
