package imageproc

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/draw"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"path/filepath"
	"strings"

	_ "golang.org/x/image/webp"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/shader"
)

type TileInput struct {
	Offset            [2]uint32 `json:"offset"`
	Size              [2]uint32 `json:"size"`
	GlobalResolution  [2]uint32 `json:"global_resolution"`
	InputPixelsBase64 string    `json:"input_pixels_base64"`
}

// PrepareJob decodes the uploaded image into RGBA tiles, assigns one tile per worker,
// strips the source image from the shared artifact, and sets ArtifactKindShaderCompute.
func PrepareJob(artifact contracts.Artifact, workerIDs []string) (contracts.Artifact, []shader.TaskSpec, error) {
	if len(workerIDs) == 0 {
		return contracts.Artifact{}, nil, apperr.BadRequest("at least one worker is required")
	}

	shaderCount := 0
	var imageFiles []contracts.File
	keptFiles := make([]contracts.File, 0, len(artifact.Files))
	for _, f := range artifact.Files {
		if strings.HasSuffix(strings.ToLower(f.Name), ".wgsl") {
			shaderCount++
		}
		if isSupportedImage(f) {
			imageFiles = append(imageFiles, f)
		} else {
			keptFiles = append(keptFiles, f)
		}
	}

	if shaderCount != 1 {
		return contracts.Artifact{}, nil, apperr.BadRequest("image-processing artifact must contain exactly one WGSL file")
	}
	if len(imageFiles) == 0 {
		return contracts.Artifact{}, nil, apperr.BadRequest("image-processing artifact must contain a PNG, JPEG, or WebP image")
	}
	if len(imageFiles) > 1 {
		return contracts.Artifact{}, nil, apperr.BadRequest("image-processing artifact must contain exactly one input image")
	}

	encodedImage, err := base64.StdEncoding.DecodeString(imageFiles[0].Content)
	if err != nil {
		return contracts.Artifact{}, nil, apperr.BadRequest(fmt.Sprintf("invalid base64 image data: %v", err))
	}

	decoded, format, err := image.Decode(bytes.NewReader(encodedImage))
	if err != nil {
		return contracts.Artifact{}, nil, apperr.BadRequest(fmt.Sprintf("unable to decode input image: %v", err))
	}
	switch format {
	case "png", "jpeg", "webp":
	default:
		return contracts.Artifact{}, nil, apperr.BadRequest("input image must be PNG, JPEG, or WebP")
	}

	rgba := toNRGBA(decoded)
	bounds := rgba.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return contracts.Artifact{}, nil, apperr.BadRequest("input image dimensions must be positive")
	}

	tasks, err := CreateTileTasks(rgba, workerIDs)
	if err != nil {
		return contracts.Artifact{}, nil, err
	}

	artifact.Kind = contracts.ArtifactKindShaderCompute
	artifact.Files = keptFiles
	return artifact, tasks, nil
}

// CreateTileTasks splits rgba vertically into column strips across workerIDs.
func CreateTileTasks(img *image.NRGBA, workerIDs []string) ([]shader.TaskSpec, error) {
	bounds := img.Bounds()
	wInt, hInt := bounds.Dx(), bounds.Dy()
	if wInt <= 0 || hInt <= 0 || len(workerIDs) == 0 {
		return nil, apperr.BadRequest("invalid image dimensions or workers")
	}
	if uint64(wInt) > math.MaxUint32 || uint64(hInt) > math.MaxUint32 || uint64(len(workerIDs)) > math.MaxUint32 {
		return nil, apperr.BadRequest("image dimensions or worker count overflow")
	}

	width := uint32(wInt)
	height := uint32(hInt)
	tileWidth := shader.DivCeilU32(width, uint32(len(workerIDs)))

	tasks := make([]shader.TaskSpec, 0, len(workerIDs))
	for i, workerID := range workerIDs {
		offsetX := uint64(i) * uint64(tileWidth)
		if offsetX >= uint64(width) {
			continue
		}
		ox := uint32(offsetX)
		tw := min(tileWidth, width-ox)
		rowBytes := int(tw) * 4
		tilePixels := make([]byte, rowBytes*hInt)

		for row := 0; row < hInt; row++ {
			srcOff := img.PixOffset(bounds.Min.X+int(ox), bounds.Min.Y+row)
			dstOff := row * rowBytes
			copy(tilePixels[dstOff:dstOff+rowBytes], img.Pix[srcOff:srcOff+rowBytes])
		}

		inputBytes, err := json.Marshal(TileInput{
			Offset:            [2]uint32{ox, 0},
			Size:              [2]uint32{tw, height},
			GlobalResolution:  [2]uint32{width, height},
			InputPixelsBase64: base64.StdEncoding.EncodeToString(tilePixels),
		})
		if err != nil {
			return nil, apperr.Internal("encode image tile input", err)
		}
		tasks = append(tasks, shader.TaskSpec{
			WorkerID: workerID,
			Input:    inputBytes,
		})
	}
	return tasks, nil
}

// toNRGBA converts any decoded image into un-premultiplied 8-bit RGBA bytes matching Rust's to_rgba8().
func toNRGBA(src image.Image) *image.NRGBA {
	if nrgba, ok := src.(*image.NRGBA); ok {
		return nrgba
	}
	bounds := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Src)
	return dst
}

func isSupportedImage(f contracts.File) bool {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(f.Name), "."))
	switch ext {
	case "png", "jpg", "jpeg", "webp":
		return true
	}
	return f.Mime != nil && strings.HasPrefix(*f.Mime, "image/")
}
