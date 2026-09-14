FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go env -w GOPROXY=https://goproxy.cn,direct && go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/steer-server ./cmd/steer-server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/steer-server /usr/local/bin/steer-server
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["steer-server"]
