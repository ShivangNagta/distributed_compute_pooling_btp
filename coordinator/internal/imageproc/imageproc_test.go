package imageproc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"reflect"
	"testing"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

func strPtr(s string) *string { return &s }

func TestTileInputsContainOnlyTheirRGBAColumns(t *testing.T) {
	img := &image.NRGBA{
		Pix: []byte{
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
			13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
		},
		Stride: 3 * 4,
		Rect:   image.Rect(0, 0, 3, 2),
	}

	tasks, err := CreateTileTasks(img, []string{"worker-1", "worker-2"})
	if err != nil {
		t.Fatalf("CreateTileTasks failed: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}

	var first, second TileInput
	_ = json.Unmarshal(tasks[0].Input, &first)
	_ = json.Unmarshal(tasks[1].Input, &second)

	if first.Offset != [2]uint32{0, 0} || first.Size != [2]uint32{2, 2} {
		t.Fatalf("unexpected first tile metadata: %+v", first)
	}
	gotFirst, _ := base64.StdEncoding.DecodeString(first.InputPixelsBase64)
	wantFirst := []byte{1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19, 20}
	if !reflect.DeepEqual(gotFirst, wantFirst) {
		t.Fatalf("first tile pixels = %v, want %v", gotFirst, wantFirst)
	}

	if second.Offset != [2]uint32{2, 0} || second.Size != [2]uint32{1, 2} {
		t.Fatalf("unexpected second tile metadata: %+v", second)
	}
	gotSecond, _ := base64.StdEncoding.DecodeString(second.InputPixelsBase64)
	wantSecond := []byte{9, 10, 11, 12, 21, 22, 23, 24}
	if !reflect.DeepEqual(gotSecond, wantSecond) {
		t.Fatalf("second tile pixels = %v, want %v", gotSecond, wantSecond)
	}
}

func TestWorkersWithoutTileAreNotAssignedEmptyImages(t *testing.T) {
	img := &image.NRGBA{
		Pix:    []byte{1, 2, 3, 4},
		Stride: 4,
		Rect:   image.Rect(0, 0, 1, 1),
	}
	tasks, err := CreateTileTasks(img, []string{"worker-0", "worker-1"})
	if err != nil {
		t.Fatalf("CreateTileTasks failed: %v", err)
	}
	if len(tasks) != 1 || tasks[0].WorkerID != "worker-0" {
		t.Fatalf("unexpected tasks: %+v", tasks)
	}
}

func TestPrepareJobDecodesAndStripsSourceImage(t *testing.T) {
	img := &image.NRGBA{
		Pix:    []byte{1, 2, 3, 4, 5, 6, 7, 8},
		Stride: 8,
		Rect:   image.Rect(0, 0, 2, 1),
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png.Encode failed: %v", err)
	}

	art := contracts.Artifact{
		EntryPoint: "main",
		Files: []contracts.File{
			{
				Name:    "filter.wgsl",
				Content: base64.StdEncoding.EncodeToString([]byte("fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) { write_pixel(out_idx, input_pixel); }")),
				Mime:    strPtr("text/wgsl"),
			},
			{
				Name:    "source.png",
				Content: base64.StdEncoding.EncodeToString(buf.Bytes()),
				Mime:    strPtr("image/png"),
			},
		},
		Kind: contracts.ArtifactKindWasm,
	}

	prepared, tasks, err := PrepareJob(art, []string{"worker-1", "worker-2"})
	if err != nil {
		t.Fatalf("PrepareJob failed: %v", err)
	}
	if prepared.Kind != contracts.ArtifactKindShaderCompute {
		t.Fatalf("expected shader_compute, got %s", prepared.Kind)
	}
	if len(prepared.Files) != 1 || prepared.Files[0].Name != "filter.wgsl" {
		t.Fatalf("expected source image stripped, got %+v", prepared.Files)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tile tasks, got %d", len(tasks))
	}
	for i, task := range tasks {
		var in TileInput
		if err := json.Unmarshal(task.Input, &in); err != nil {
			t.Fatalf("task %d invalid input: %v", i, err)
		}
		if in.GlobalResolution != [2]uint32{2, 1} || in.InputPixelsBase64 == "" {
			t.Fatalf("unexpected task %d tile input: %+v", i, in)
		}
	}
}
