package common

import (
	"regexp"
	"strings"
)

var marketAccessModelSuffix = regexp.MustCompile(`^(.+)@s[1-9][0-9]*c[1-9][0-9]*$`)

// MarketBaseModel groups generated supplier aliases without merging model variants.
func MarketBaseModel(name string) string {
	if match := marketAccessModelSuffix.FindStringSubmatch(name); match != nil {
		name = match[1]
	}
	if strings.EqualFold(name, "minimax-m3") {
		return "MiniMax-M3"
	}
	return name
}
