FROM node:24-alpine AS web
WORKDIR /build
COPY package*.json ./
COPY web/package.json ./web/package.json
RUN npm ci
COPY web ./web
ARG VITE_API_URL=
ARG VITE_READ_URL=
ARG VITE_WRITE_URL=
ARG VITE_FASTTASK_URL=
ARG VITE_FASTNEWS_URL=
ARG VITE_FASTPPT_URL=
ARG VITE_FASTLAB_URL=
ENV VITE_API_URL=$VITE_API_URL VITE_READ_URL=$VITE_READ_URL VITE_WRITE_URL=$VITE_WRITE_URL VITE_FASTTASK_URL=$VITE_FASTTASK_URL VITE_FASTNEWS_URL=$VITE_FASTNEWS_URL VITE_FASTPPT_URL=$VITE_FASTPPT_URL VITE_FASTLAB_URL=$VITE_FASTLAB_URL
RUN npm run build:web

FROM golang:1.26.8-alpine AS server
RUN apk add --no-cache build-base
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -ldflags='-s -w' -o /fastresearch ./cmd/fastresearch

FROM alpine:3.23
RUN apk add --no-cache ca-certificates libgcc && addgroup -S research && adduser -S -G research research
WORKDIR /app
ENV HOST=0.0.0.0 PORT=8787 FASTRESEARCH_DATA_DIR=/app/data FASTRESEARCH_STATIC_DIR=/app/dist
COPY --from=server /fastresearch /app/bin/fastresearch
COPY --from=web /build/dist /app/dist
RUN mkdir -p /app/data && chown research:research /app/data
USER research
VOLUME ["/app/data"]
EXPOSE 8787
ENTRYPOINT ["/app/bin/fastresearch"]
