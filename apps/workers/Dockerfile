# TS-1: pin the exact Bun tag. `latest` must never appear here.
FROM oven/bun:1.3.14

WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /repo/apps/workers
# AR-1: send, import and scheduler workers are separately restartable
# containers built from this one image — see docker-compose.yml, which
# overrides `command:` per service (start:send / start:import /
# start:scheduler) rather than building three images for identical code.
CMD ["bun", "run", "start:send"]
