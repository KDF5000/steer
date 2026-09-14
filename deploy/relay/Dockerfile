# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build

ARG RELAY_VERSION=v0.3.1
RUN apk add --no-cache ca-certificates git
RUN go env -w GOPROXY=https://goproxy.cn,direct
RUN CGO_ENABLED=0 go install -trimpath \
    -ldflags="-s -w -X github.com/KDF5000/relay.Version=${RELAY_VERSION}" \
    github.com/KDF5000/relay/cmd/relay-server@${RELAY_VERSION}

FROM alpine:3.22

RUN apk add --no-cache ca-certificates wget \
    && addgroup -S -g 10001 relay \
    && adduser -S -D -H -u 10001 -G relay relay \
    && install -d -o relay -g relay /var/lib/relay/artifacts

COPY --from=build /go/bin/relay-server /usr/local/bin/relay-server

USER relay
EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["/usr/local/bin/relay-server"]
