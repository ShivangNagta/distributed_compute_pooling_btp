package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/api"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/service"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/store"
)

func main() {
	databasePath := os.Getenv("DATABASE_PATH")
	if databasePath == "" {
		databasePath = "data/coordinator.db"
	}

	st, err := store.Open(databasePath)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer func() { _ = st.Close() }()

	if err := st.Migrate(context.Background()); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	svc := service.New(st)
	router := api.NewRouter(svc)

	addr := ":3000"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("coordinator listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}
