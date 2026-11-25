FROM rust:1-bookworm AS builder

WORKDIR /app

COPY . .

RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/target/release/coordinator /usr/local/bin/coordinator

ENV DATABASE_PATH=/data/coordinator.db

RUN mkdir -p /data

EXPOSE 3000

CMD ["coordinator"]
