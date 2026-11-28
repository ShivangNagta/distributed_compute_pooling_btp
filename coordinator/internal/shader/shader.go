package shader

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

type TaskSpec struct {
	WorkerID string
	Input    json.RawMessage
}

type TileInput struct {
	Offset           [2]uint32 `json:"offset"`
	Size             [2]uint32 `json:"size"`
	GlobalResolution [2]uint32 `json:"global_resolution"`
}

type TileResult struct {
	PixelsBase64 string `json:"pixels_base64"`
}

func DivCeilU32(a, b uint32) uint32 {
	if a == 0 {
		return 0
	}
	return uint32((uint64(a) + uint64(b) - 1) / uint64(b))
}

// PrepareJob validates WGSL job inputs/metadata and splits the output grid into column tiles across workers.
func PrepareJob(artifact contracts.Artifact, workerIDs []string, metadata map[string]any) (contracts.Artifact, []TaskSpec, error) {
	width, err := parsePositiveU32(metadata["width"], "wgsl metadata.width must be a positive integer")
	if err != nil {
		return contracts.Artifact{}, nil, err
	}
	height, err := parsePositiveU32(metadata["height"], "wgsl metadata.height must be a positive integer")
	if err != nil {
		return contracts.Artifact{}, nil, err
	}
	if width == 0 || height == 0 {
		return contracts.Artifact{}, nil, apperr.BadRequest("width and height must be positive")
	}
	if len(workerIDs) == 0 {
		return contracts.Artifact{}, nil, apperr.BadRequest("at least one worker is required")
	}

	hasShader := false
	for _, f := range artifact.Files {
		if strings.HasSuffix(f.Name, ".wgsl") {
			hasShader = true
			break
		}
	}
	if !hasShader {
		return contracts.Artifact{}, nil, apperr.BadRequest("shader artifact must contain a WGSL file")
	}

	tileWidth := DivCeilU32(width, uint32(len(workerIDs)))
	tasks := make([]TaskSpec, 0, len(workerIDs))
	for i, workerID := range workerIDs {
		offsetX := uint64(i) * uint64(tileWidth)
		if offsetX >= uint64(width) {
			continue
		}
		ox := uint32(offsetX)
		tw := min(tileWidth, width-ox)
		inputBytes, err := json.Marshal(TileInput{
			Offset:           [2]uint32{ox, 0},
			Size:             [2]uint32{tw, height},
			GlobalResolution: [2]uint32{width, height},
		})
		if err != nil {
			return contracts.Artifact{}, nil, apperr.Internal("encode shader tile input", err)
		}
		tasks = append(tasks, TaskSpec{
			WorkerID: workerID,
			Input:    inputBytes,
		})
	}

	artifact.Kind = contracts.ArtifactKindShaderCompute
	return artifact, tasks, nil
}

func parsePositiveU32(val any, errMsg string) (uint32, error) {
	f, ok := val.(float64)
	if !ok || f < 0 || math.Trunc(f) != f || f > math.MaxUint32 {
		return 0, apperr.BadRequest(errMsg)
	}
	return uint32(f), nil
}

// AggregateTiles validates that all shader task tiles form a complete RGBA image without overflow or dimension mismatches.
func AggregateTiles(tasks []contracts.Task) error {
	if len(tasks) == 0 {
		return apperr.Internal("shader job has no tasks", nil)
	}

	var firstInput TileInput
	if err := json.Unmarshal(tasks[0].Input, &firstInput); err != nil {
		return apperr.BadRequest(fmt.Sprintf("invalid shader tile input: %v", err))
	}
	width, height := firstInput.GlobalResolution[0], firstInput.GlobalResolution[1]
	byteCount, ok := checkedRGBA(width, height)
	if !ok {
		return apperr.BadRequest("shader image dimensions overflow")
	}
	pixels := make([]byte, byteCount)

	for _, task := range tasks {
		var input TileInput
		if err := json.Unmarshal(task.Input, &input); err != nil {
			return apperr.BadRequest(fmt.Sprintf("invalid shader tile input: %v", err))
		}
		if input.GlobalResolution != [2]uint32{width, height} {
			return apperr.BadRequest("shader tiles have inconsistent global resolutions")
		}
		if task.Result == nil {
			return apperr.Internal(fmt.Sprintf("task %s has no result", task.ID), nil)
		}
		var result TileResult
		if err := json.Unmarshal(*task.Result, &result); err != nil {
			return apperr.Internal(fmt.Sprintf("invalid shader result: %v", err), nil)
		}
		raw, err := base64.StdEncoding.DecodeString(result.PixelsBase64)
		if err != nil {
			return apperr.Internal(fmt.Sprintf("invalid shader pixel data: %v", err), nil)
		}

		tileWidth, tileHeight := input.Size[0], input.Size[1]
		expected, ok := checkedRGBA(tileWidth, tileHeight)
		if !ok {
			return apperr.BadRequest("shader tile dimensions overflow")
		}
		if uint64(len(raw)) != expected {
			return apperr.Internal(fmt.Sprintf("task %s returned %d bytes; expected %d", task.ID, len(raw), expected), nil)
		}

		offsetX, offsetY := input.Offset[0], input.Offset[1]
		if tileWidth > width || offsetX > width-tileWidth || tileHeight > height || offsetY > height-tileHeight {
			return apperr.BadRequest(fmt.Sprintf("task %s tile is outside the shader image", task.ID))
		}

		rowBytes := int(tileWidth) * 4
		for row := uint32(0); row < tileHeight; row++ {
			src := int(row) * rowBytes
			dst := (int(offsetY+row)*int(width) + int(offsetX)) * 4
			copy(pixels[dst:dst+rowBytes], raw[src:src+rowBytes])
		}
	}
	return nil
}

func checkedRGBA(width, height uint32) (uint64, bool) {
	pixels := uint64(width) * uint64(height)
	if pixels > math.MaxUint64/4 {
		return 0, false
	}
	total := pixels * 4
	if total > math.MaxInt {
		return 0, false
	}
	return total, true
}
