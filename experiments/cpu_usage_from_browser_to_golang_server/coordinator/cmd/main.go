package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type metrics struct {
	Cpu    string `json:"Cpu"`
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Access-Control-Allow-Origin", "*")
        w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if r.Method == http.MethodOptions {
            w.WriteHeader(http.StatusNoContent)
            return
        }
        next(w, r)
    }
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/cpu/performance", corsMiddleware(cpuPerformance))

	fmt.Println("Server running on :8090...")
	if err := http.ListenAndServe(":8090", mux); err != nil {
		fmt.Printf("Error starting server: %s\n", err)
	}
}

// curl -X POST http://localhost:8090/cpu/performance -d '{"Cpu": "4"}' -H "Content-Type: application/json"
func cpuPerformance(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var metrics metrics
	if err := json.NewDecoder(r.Body).Decode(&metrics); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}
	fmt.Println(metrics.Cpu)
	json.NewEncoder(w).Encode(metrics.Cpu)
}
