// Package icon draws the app icon: a white eighth note on a blue rounded square
// with a yellow underline, at any size. scripts/icon writes resources/icon.png from it.
package icon

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
)

var (
	blue   = color.NRGBA{0x18, 0x3d, 0xd6, 0xff}
	white  = color.NRGBA{0xff, 0xff, 0xff, 0xff}
	yellow = color.NRGBA{0xff, 0xd2, 0x1f, 0xff}
)

// PNG returns the icon as a PNG of size×size pixels.
func PNG(size int) []byte {
	img := Draw(size)
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

// Draw renders the icon with 4×4 supersampling.
func Draw(size int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	const ss = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					u := (float64(x) + (float64(sx)+0.5)/ss) / float64(size)
					v := (float64(y) + (float64(sy)+0.5)/ss) / float64(size)
					c, ok := sample(u, v)
					if !ok {
						continue
					}
					r += float64(c.R)
					g += float64(c.G)
					b += float64(c.B)
					a += 255
				}
			}
			n := float64(ss * ss)
			if a == 0 {
				continue
			}
			cov := a / 255
			img.SetNRGBA(x, y, color.NRGBA{uint8(r / cov), uint8(g / cov), uint8(b / cov), uint8(a / n)})
		}
	}
	return img
}

// sample returns the colour at (u, v) in [0,1]², or false outside the shape.
func sample(u, v float64) (color.NRGBA, bool) {
	if !roundRect(u, v, 0.04, 0.04, 0.96, 0.96, 0.2) {
		return color.NRGBA{}, false
	}
	// note: head (tilted ellipse), stem, flag
	hx, hy := u-0.40, v-0.66
	ca, sa := math.Cos(-0.45), math.Sin(-0.45)
	ex, ey := hx*ca-hy*sa, hx*sa+hy*ca
	if (ex*ex)/(0.135*0.135)+(ey*ey)/(0.095*0.095) <= 1 {
		return white, true
	}
	if u >= 0.485 && u <= 0.545 && v >= 0.22 && v <= 0.64 {
		return white, true
	}
	// flag: band from the top of the stem curving down to the right
	if u >= 0.515 && u <= 0.74 {
		t := (u - 0.515) / 0.225
		top := 0.22 + 0.16*t*t + 0.05*t
		if v >= top && v <= top+0.1-0.04*t {
			return white, true
		}
	}
	if u >= 0.22 && u <= 0.78 && v >= 0.82 && v <= 0.865 {
		return yellow, true
	}
	return blue, true
}

func roundRect(u, v, x0, y0, x1, y1, r float64) bool {
	if u < x0 || u > x1 || v < y0 || v > y1 {
		return false
	}
	cx := math.Max(x0+r, math.Min(u, x1-r))
	cy := math.Max(y0+r, math.Min(v, y1-r))
	dx, dy := u-cx, v-cy
	return dx*dx+dy*dy <= r*r
}
