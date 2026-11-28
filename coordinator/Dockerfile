FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 go build -o /coordinator ./cmd/coordinator

FROM alpine:3.21

WORKDIR /app

COPY --from=builder /coordinator /usr/local/bin/coordinator

ENV DATABASE_PATH=/data/coordinator.db

RUN mkdir -p /data

EXPOSE 3000

CMD ["coordinator"]
