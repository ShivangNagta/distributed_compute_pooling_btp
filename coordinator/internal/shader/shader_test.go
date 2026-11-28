package shader

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

func TestPrepareJobSplitsTilesAndSetsKind(t *testing.T) {
	art := contracts.Artifact{
		EntryPoint: "main",
		Files:      []contracts.File{{Name: "shader.wgsl", Content: "Zm4gc2hhZGUoKSB7fQ=="}},
	}
	meta := map[string]any{"type": "wgsl", "width": float64(5), "height": float64(2)}

	prepared, tasks, err := PrepareJob(art, []string{"w1", "w2"}, meta)
	if err != nil {
		t.Fatalf("PrepareJob failed: %v", err)
	}
	if prepared.Kind != contracts.ArtifactKindShaderCompute {
		t.Fatalf("expected shader_compute kind, got %s", prepared.Kind)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}

	var t0, t1 TileInput
	_ = json.Unmarshal(tasks[0].Input, &t0)
	_ = json.Unmarshal(tasks[1].Input, &t1)
	if t0.Offset != [2]uint32{0, 0} || t0.Size != [2]uint32{3, 2} {
		t.Fatalf("unexpected tile 0: %+v", t0)
	}
	if t1.Offset != [2]uint32{3, 0} || t1.Size != [2]uint32{2, 2} {
		t.Fatalf("unexpected tile 1: %+v", t1)
	}
}

func TestAggregateTilesValidatesFullCoverage(t *testing.T) {
	res0, _ := json.Marshal(TileResult{PixelsBase64: base64.StdEncoding.EncodeToString(make([]byte, 2*2*4))})
	res1, _ := json.Marshal(TileResult{PixelsBase64: base64.StdEncoding.EncodeToString(make([]byte, 1*2*4))})
	in0, _ := json.Marshal(TileInput{Offset: [2]uint32{0, 0}, Size: [2]uint32{2, 2}, GlobalResolution: [2]uint32{3, 2}})
	in1, _ := json.Marshal(TileInput{Offset: [2]uint32{2, 0}, Size: [2]uint32{1, 2}, GlobalResolution: [2]uint32{3, 2}})

	tasks := []contracts.Task{
		{ID: "t0", Input: in0, Result: contracts.RawPtr(res0)},
		{ID: "t1", Input: in1, Result: contracts.RawPtr(res1)},
	}
	if err := AggregateTiles(tasks); err != nil {
		t.Fatalf("AggregateTiles failed: %v", err)
	}
}
