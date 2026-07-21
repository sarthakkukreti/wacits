# TS-1: pin the exact Bun tag. `latest` must never appear here.
FROM oven/bun:1.3.14

WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /repo/apps/webhook
EXPOSE 8788
CMD ["bun", "run", "start"]
