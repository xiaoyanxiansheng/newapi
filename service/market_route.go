package service

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

var (
	ErrRouteNone        = errors.New("this key has no routes yet, add channels in the model market first")
	ErrRouteModelAbsent = errors.New("this model is not in the routes of this key")
	ErrRouteUnavailable = errors.New("no available channel for this model in the routes of this key")
)

type RouteCandidate struct {
	Channel *model.Channel
	Listing *model.MarketListing
}

func modelHasBillingConfig(modelName string) bool {
	if _, ok := ratio_setting.GetModelPrice(modelName, false); ok {
		return true
	}
	if _, ok, _ := ratio_setting.GetModelRatio(modelName); ok {
		return true
	}
	if billing_setting.GetBillingMode(modelName) != billing_setting.BillingModeTieredExpr {
		return false
	}
	expr, ok := billing_setting.GetBillingExpr(modelName)
	return ok && strings.TrimSpace(expr) != ""
}

// SellableListing returns the channel behind a listing when it can serve
// traffic: listed, priced, channel enabled and still serving the model.
func SellableListing(l *model.MarketListing) (*model.Channel, bool) {
	if l == nil || !l.Enabled || l.Ratio <= 0 {
		return nil, false
	}
	ch, err := model.CacheGetChannel(l.ChannelId)
	if err != nil || ch == nil || ch.Status != common.ChannelStatusEnabled {
		return nil, false
	}
	found := false
	for _, m := range ch.GetModels() {
		if m == l.ModelName {
			found = true
			break
		}
	}
	if !found || !modelHasBillingConfig(l.ModelName) {
		return nil, false
	}
	return ch, true
}

// IsRouteMode reports whether the request was authenticated with a token and
// therefore must be routed by the token's own route list.
func IsRouteMode(c *gin.Context) bool {
	_, ok := common.GetContextKey(c, constant.ContextKeyTokenRoutes)
	return ok
}

func tokenRoutesFromContext(c *gin.Context) map[string][]int {
	v, ok := common.GetContextKey(c, constant.ContextKeyTokenRoutes)
	if !ok {
		return nil
	}
	m, _ := v.(map[string][]int)
	return m
}

func tokenAutoRoute(c *gin.Context) bool {
	return common.GetContextKeyBool(c, constant.ContextKeyTokenAutoRoute)
}

// RouteCandidates lists the sellable channels for a model in the order the
// user arranged them. With auto route off only the first entry is considered,
// so an unavailable primary channel fails instead of falling back.
func RouteCandidates(c *gin.Context, modelName string) ([]RouteCandidate, error) {
	routes := tokenRoutesFromContext(c)
	if len(routes) == 0 {
		return nil, ErrRouteNone
	}
	ids, ok := routes[modelName]
	if !ok {
		return nil, ErrRouteModelAbsent
	}
	if len(ids) == 0 {
		return nil, ErrRouteUnavailable
	}
	if !tokenAutoRoute(c) {
		ids = ids[:1]
	}
	out := make([]RouteCandidate, 0, len(ids))
	for _, id := range ids {
		listing := model.GetMarketListing(id, modelName)
		if ch, ok := SellableListing(listing); ok {
			out = append(out, RouteCandidate{Channel: ch, Listing: listing})
		}
	}
	if len(out) == 0 {
		return nil, ErrRouteUnavailable
	}
	return out, nil
}

// PrepareRoute computes the retry limit and the worst-case ratio used for
// pre-consume, and stores the first candidate ratio for billing.
func PrepareRoute(c *gin.Context, modelName string) ([]RouteCandidate, error) {
	cands, err := RouteCandidates(c, modelName)
	if err != nil {
		return nil, err
	}
	maxRatio := 0.0
	for _, cand := range cands {
		if cand.Listing.Ratio > maxRatio {
			maxRatio = cand.Listing.Ratio
		}
	}
	common.SetContextKey(c, constant.ContextKeyRouteMaxRetry, len(cands)-1)
	common.SetContextKey(c, constant.ContextKeyRoutePreConsumeRatio, maxRatio)
	common.SetContextKey(c, constant.ContextKeyRouteRatio, cands[0].Listing.Ratio)
	return cands, nil
}

// SelectRouteChannel returns the first candidate not yet tried by this request.
func SelectRouteChannel(c *gin.Context, modelName string) (*model.Channel, error) {
	cands, err := RouteCandidates(c, modelName)
	if err != nil {
		return nil, err
	}
	used := make(map[string]struct{})
	for _, id := range c.GetStringSlice("use_channel") {
		used[id] = struct{}{}
	}
	for _, cand := range cands {
		if _, tried := used[strconv.Itoa(cand.Channel.Id)]; tried {
			continue
		}
		common.SetContextKey(c, constant.ContextKeyRouteRatio, cand.Listing.Ratio)
		return cand.Channel, nil
	}
	return nil, fmt.Errorf("all channels in the routes of this key have been tried")
}

// GetRetryLimit is the highest retry index allowed for this request.
func GetRetryLimit(c *gin.Context) int {
	if IsRouteMode(c) {
		if v, ok := common.GetContextKey(c, constant.ContextKeyRouteMaxRetry); ok {
			if n, ok := v.(int); ok {
				return n
			}
		}
		return 0
	}
	return common.RetryTimes
}

// UseRoutePreConsumeRatio switches the billing ratio to the worst case among
// the candidate channels until the returned function is called.
func UseRoutePreConsumeRatio(c *gin.Context) func() {
	pre, ok := common.GetContextKey(c, constant.ContextKeyRoutePreConsumeRatio)
	if !ok {
		return func() {}
	}
	cur, hadCur := common.GetContextKey(c, constant.ContextKeyRouteRatio)
	common.SetContextKey(c, constant.ContextKeyRouteRatio, pre)
	return func() {
		if hadCur {
			common.SetContextKey(c, constant.ContextKeyRouteRatio, cur)
		}
	}
}

// GetRouteRatio returns the ratio of the channel currently selected for billing.
func GetRouteRatio(c *gin.Context) (float64, bool) {
	v, ok := common.GetContextKey(c, constant.ContextKeyRouteRatio)
	if !ok {
		return 0, false
	}
	r, ok := v.(float64)
	return r, ok && r > 0
}

// GetRouteModels lists the models of the token that currently have at least one sellable channel.
func GetRouteModels(c *gin.Context) []string {
	routes := tokenRoutesFromContext(c)
	names := make([]string, 0, len(routes))
	for name, ids := range routes {
		for _, id := range ids {
			if _, ok := SellableListing(model.GetMarketListing(id, name)); ok {
				names = append(names, name)
				break
			}
		}
	}
	sort.Strings(names)
	return names
}

func ModelHasBillingConfig(modelName string) bool {
	return modelHasBillingConfig(modelName)
}
