FROM oven/bun:1.3.14-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY migrations ./migrations
COPY public ./public
COPY scripts ./scripts
COPY src ./src

RUN mkdir -p /data && chown bun:bun /data

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/shibumi-forms.sqlite

USER bun
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
