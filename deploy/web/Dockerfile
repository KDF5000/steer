FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./

ARG NEXT_PUBLIC_STEER_API_URL=http://localhost:8080/api/v1
ENV NEXT_PUBLIC_STEER_API_URL=${NEXT_PUBLIC_STEER_API_URL}
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global wrangler@4.92.0
WORKDIR /app
COPY --from=build /app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000 || exit 1

CMD ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--ip", "0.0.0.0", "--port", "3000", "--local"]
