FROM oven/bun

EXPOSE 3000

COPY bun.lockb . 
COPY package.json . 

RUN bun install --frozen-lockfile

COPY src ./src 
CMD ["bun","src/server.ts"]
