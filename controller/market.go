package controller

import (
	"errors"
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const maxChannelsPerModelRoute = 20

type marketChannel struct {
	ChannelId   int                      `json:"channel_id"`
	ListingId   int                      `json:"listing_id"`
	Ratio       float64                  `json:"ratio"`
	Description string                   `json:"description"`
	Joined      bool                     `json:"joined"`
	Position    int                      `json:"position"`
	Abnormal    bool                     `json:"abnormal"`
	Stats       *model.MarketStatSummary `json:"stats"`
	Score       *service.MarketScore     `json:"score"`
}

type marketItem struct {
	model.Pricing
	MinRatio float64         `json:"min_ratio"`
	Channels []marketChannel `json:"channels"`
}

// GetMarketModels lists every model with at least one sellable channel. Channels are
// only identified by id. When token_id is given, each channel reports whether the key joined it.
func GetMarketModels(c *gin.Context) {
	joined := map[string][]int{}
	if tokenId, _ := strconv.Atoi(c.Query("token_id")); tokenId > 0 {
		userId := c.GetInt("id")
		if userId == 0 {
			common.ApiErrorMsg(c, "login required")
			return
		}
		token, err := model.GetTokenByIds(tokenId, userId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		joined = token.GetRouteMap()
	}

	pricingByModel := map[string]model.Pricing{}
	for _, p := range model.GetPricing() {
		pricingByModel[p.ModelName] = p
	}

	grouped := map[string][]marketChannel{}
	for _, l := range model.GetAllMarketListingsCached() {
		if _, ok := service.SellableListing(l); !ok {
			continue
		}
		if _, ok := pricingByModel[l.ModelName]; !ok {
			continue
		}
		pricing := pricingByModel[l.ModelName]
		stats := model.GetMarketStatSummary(l.ChannelId, l.ModelName)
		score := service.ScoreMarketListing(l.Ratio, pricing.CacheRatio, stats)
		mc := marketChannel{
			ChannelId:   l.ChannelId,
			ListingId:   l.Id,
			Ratio:       l.Ratio,
			Description: l.Description,
			Stats:       stats,
			Score:       &score,
			Abnormal:    stats != nil && stats.Abnormal,
		}
		for i, id := range joined[l.ModelName] {
			if id == l.ChannelId {
				mc.Joined = true
				mc.Position = i + 1
				break
			}
		}
		grouped[l.ModelName] = append(grouped[l.ModelName], mc)
	}

	items := make([]marketItem, 0, len(grouped))
	for name, channels := range grouped {
		sort.Slice(channels, func(i, j int) bool {
			if channels[i].Ratio != channels[j].Ratio {
				return channels[i].Ratio < channels[j].Ratio
			}
			return channels[i].ChannelId < channels[j].ChannelId
		})
		items = append(items, marketItem{Pricing: pricingByModel[name], MinRatio: channels[0].Ratio, Channels: channels})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ModelName < items[j].ModelName })

	// Only vendors that have a model on sale are returned, so unused vendor names never leak.
	usedVendors := make(map[int]struct{}, len(items))
	for _, item := range items {
		usedVendors[item.VendorID] = struct{}{}
	}
	vendors := make([]model.PricingVendor, 0, len(usedVendors))
	for _, v := range model.GetVendors() {
		if _, ok := usedVendors[v.ID]; ok {
			vendors = append(vendors, v)
		}
	}

	c.JSON(200, gin.H{
		"success":            true,
		"data":               items,
		"vendors":            vendors,
		"supported_endpoint": model.GetSupportedEndpointMap(),
	})
}

type routeChannelView struct {
	ChannelId   int     `json:"channel_id"`
	Ratio       float64 `json:"ratio"`
	Description string  `json:"description"`
	Available   bool    `json:"available"`
}

type routeView struct {
	Model    string             `json:"model"`
	Channels []routeChannelView `json:"channels"`
}

func buildRouteViews(routes []model.TokenRoute) []routeView {
	views := make([]routeView, 0, len(routes))
	for _, r := range routes {
		v := routeView{Model: r.Model, Channels: make([]routeChannelView, 0, len(r.Channels))}
		for _, id := range r.Channels {
			cv := routeChannelView{ChannelId: id}
			if l := model.GetMarketListing(id, r.Model); l != nil {
				cv.Ratio = l.Ratio
				cv.Description = l.Description
				_, cv.Available = service.SellableListing(l)
			}
			v.Channels = append(v.Channels, cv)
		}
		views = append(views, v)
	}
	sort.Slice(views, func(i, j int) bool { return views[i].Model < views[j].Model })
	return views
}

func GetTokenRoutes(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	token, err := model.GetTokenByIds(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"auto_route": token.AutoRoute,
		"routes":     buildRouteViews(token.GetRoutes()),
	})
}

type tokenRouteRequest struct {
	Model     string `json:"model"`
	ChannelId int    `json:"channel_id"`
}

func AddTokenRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" || req.ChannelId <= 0 {
		common.ApiErrorMsg(c, "model and channel_id are required")
		return
	}
	if _, ok := service.SellableListing(model.GetMarketListing(req.ChannelId, req.Model)); !ok {
		common.ApiErrorMsg(c, "this channel is not available in the market")
		return
	}
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			for _, existing := range routes[i].Channels {
				if existing == req.ChannelId {
					return routes, nil
				}
			}
			if len(routes[i].Channels) >= maxChannelsPerModelRoute {
				return nil, errors.New("too many channels for this model")
			}
			routes[i].Channels = append(routes[i].Channels, req.ChannelId)
			return routes, nil
		}
		return append(routes, model.TokenRoute{Model: req.Model, Channels: []int{req.ChannelId}}), nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

func RemoveTokenRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" || req.ChannelId <= 0 {
		common.ApiErrorMsg(c, "model and channel_id are required")
		return
	}
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			kept := make([]int, 0, len(routes[i].Channels))
			for _, existing := range routes[i].Channels {
				if existing != req.ChannelId {
					kept = append(kept, existing)
				}
			}
			routes[i].Channels = kept
		}
		return routes, nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

type tokenRouteModelRequest struct {
	Model string `json:"model"`
}

// AddTokenRouteModel puts a model into the key's routes without any channel; the user picks channels later.
func AddTokenRouteModel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteModelRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" {
		common.ApiErrorMsg(c, "model is required")
		return
	}
	onSale := false
	for _, l := range model.GetAllMarketListingsCached() {
		if l.ModelName != req.Model {
			continue
		}
		if _, ok := service.SellableListing(l); ok {
			onSale = true
			break
		}
	}
	if !onSale {
		common.ApiErrorMsg(c, "this model is not available in the market")
		return
	}
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for _, r := range routes {
			if r.Model == req.Model {
				return routes, nil
			}
		}
		return append(routes, model.TokenRoute{Model: req.Model, Channels: []int{}}), nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

// RemoveTokenRouteModel drops a model and all of its channels from the key's routes.
func RemoveTokenRouteModel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteModelRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" {
		common.ApiErrorMsg(c, "model is required")
		return
	}
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		kept := make([]model.TokenRoute, 0, len(routes))
		for _, r := range routes {
			if r.Model != req.Model {
				kept = append(kept, r)
			}
		}
		return kept, nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

type tokenRouteOrderRequest struct {
	Model    string `json:"model"`
	Channels []int  `json:"channels"`
}

func ReorderTokenRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" || len(req.Channels) == 0 {
		common.ApiErrorMsg(c, "model and channels are required")
		return
	}
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			current := make(map[int]struct{}, len(routes[i].Channels))
			for _, existing := range routes[i].Channels {
				current[existing] = struct{}{}
			}
			if len(req.Channels) != len(current) {
				return nil, errors.New("channels do not match the current route, refresh and retry")
			}
			seen := make(map[int]struct{}, len(req.Channels))
			for _, ch := range req.Channels {
				if _, ok := current[ch]; !ok {
					return nil, errors.New("channels do not match the current route, refresh and retry")
				}
				if _, dup := seen[ch]; dup {
					return nil, errors.New("duplicated channel in order")
				}
				seen[ch] = struct{}{}
			}
			routes[i].Channels = req.Channels
			return routes, nil
		}
		return nil, errors.New("this model is not in the key routes")
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

type adminListingView struct {
	*model.MarketListing
	ChannelName   string                   `json:"channel_name"`
	ChannelStatus int                      `json:"channel_status"`
	ChannelHas    bool                     `json:"channel_has_model"`
	HasPrice      bool                     `json:"has_base_price"`
	Sellable      bool                     `json:"sellable"`
	Probe         *model.MarketProbeResult `json:"probe"`
	Stats         *model.MarketStatSummary `json:"stats"`
}

func GetAdminMarketListings(c *gin.Context) {
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	rows, err := model.QueryMarketListings(channelId, c.Query("keyword"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelIds := make([]int, 0)
	seen := map[int]struct{}{}
	for _, l := range rows {
		if _, ok := seen[l.ChannelId]; !ok {
			seen[l.ChannelId] = struct{}{}
			channelIds = append(channelIds, l.ChannelId)
		}
	}
	channels := map[int]*model.Channel{}
	if len(channelIds) > 0 {
		list, err := model.GetChannelsByIds(channelIds)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, ch := range list {
			channels[ch.Id] = ch
		}
	}
	views := make([]adminListingView, 0, len(rows))
	for _, l := range rows {
		v := adminListingView{MarketListing: l, HasPrice: service.ModelHasBillingConfig(l.ModelName)}
		if ch := channels[l.ChannelId]; ch != nil {
			v.ChannelName = ch.Name
			v.ChannelStatus = ch.Status
			for _, m := range ch.GetModels() {
				if m == l.ModelName {
					v.ChannelHas = true
					break
				}
			}
		}
		_, v.Sellable = service.SellableListing(l)
		if probe, ok := model.GetMarketProbeResult(l.ChannelId, l.ModelName); ok {
			v.Probe = &probe
		}
		v.Stats = model.GetMarketStatSummary(l.ChannelId, l.ModelName)
		views = append(views, v)
	}
	common.ApiSuccess(c, views)
}

// validateListingEnable guards the fail-closed rule: only priced listings of a channel that
// really serves the model, with a configured base price, may be switched on.
func validateListingEnable(l *model.MarketListing) error {
	if l.Ratio <= 0 {
		return errors.New("set a ratio greater than 0 before enabling")
	}
	if !service.ModelHasBillingConfig(l.ModelName) {
		return errors.New("model " + l.ModelName + " has no base price configured")
	}
	ch, err := model.GetChannelById(l.ChannelId, false)
	if err != nil {
		return errors.New("channel not found")
	}
	for _, m := range ch.GetModels() {
		if m == l.ModelName {
			return nil
		}
	}
	return errors.New("channel " + strconv.Itoa(l.ChannelId) + " does not serve model " + l.ModelName)
}

func CreateAdminMarketListing(c *gin.Context) {
	var l model.MarketListing
	if err := c.ShouldBindJSON(&l); err != nil {
		common.ApiError(c, err)
		return
	}
	l.Id = 0
	if l.Enabled {
		if err := validateListingEnable(&l); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if err := l.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, l)
}

type updateListingRequest struct {
	Ratio       *float64 `json:"ratio"`
	Enabled     *bool    `json:"enabled"`
	Description *string  `json:"description"`
	SortOrder   *int     `json:"sort_order"`
}

func UpdateAdminMarketListing(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req updateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	var current model.MarketListing
	if err := model.DB.First(&current, "id = ?", id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	next := current
	if req.Ratio != nil {
		next.Ratio = *req.Ratio
	}
	if req.Enabled != nil {
		next.Enabled = *req.Enabled
	}
	if next.Enabled {
		if err := validateListingEnable(&next); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	updated, err := model.UpdateMarketListing(id, req.Ratio, req.Enabled, req.Description, req.SortOrder)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, updated)
}

type batchListingRequest struct {
	Ids     []int    `json:"ids"`
	Ratio   *float64 `json:"ratio"`
	Enabled *bool    `json:"enabled"`
}

func BatchUpdateAdminMarketListings(c *gin.Context) {
	var req batchListingRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Ids) == 0 || (req.Ratio == nil && req.Enabled == nil) {
		common.ApiErrorMsg(c, "ids and ratio or enabled are required")
		return
	}
	updated := 0
	failed := make([]gin.H, 0)
	for _, id := range req.Ids {
		var current model.MarketListing
		if err := model.DB.First(&current, "id = ?", id).Error; err != nil {
			failed = append(failed, gin.H{"id": id, "message": err.Error()})
			continue
		}
		next := current
		if req.Ratio != nil {
			next.Ratio = *req.Ratio
		}
		if req.Enabled != nil {
			next.Enabled = *req.Enabled
		}
		if next.Enabled {
			if err := validateListingEnable(&next); err != nil {
				failed = append(failed, gin.H{"id": id, "model_name": current.ModelName, "message": err.Error()})
				continue
			}
		}
		if _, err := model.UpdateMarketListing(id, req.Ratio, req.Enabled, nil, nil); err != nil {
			failed = append(failed, gin.H{"id": id, "message": err.Error()})
			continue
		}
		updated++
	}
	common.ApiSuccess(c, gin.H{"updated": updated, "failed": failed})
}

type deleteListingsRequest struct {
	Ids []int `json:"ids"`
}

func DeleteAdminMarketListings(c *gin.Context) {
	var req deleteListingsRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Ids) == 0 {
		common.ApiErrorMsg(c, "ids are required")
		return
	}
	if err := model.DeleteMarketListings(req.Ids); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

type generateListingsRequest struct {
	ChannelId int `json:"channel_id"`
}

func GenerateAdminMarketListings(c *gin.Context) {
	var req generateListingsRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ChannelId <= 0 {
		common.ApiErrorMsg(c, "channel_id is required")
		return
	}
	ch, err := model.GetChannelById(req.ChannelId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	created, err := model.GenerateMarketListings(ch.Id, ch.GetModels())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"created": created})
}

type tokenAutoRouteRequest struct {
	AutoRoute bool `json:"auto_route"`
}

func SetTokenAutoRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenAutoRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.SetTokenAutoRoute(id, c.GetInt("id"), req.AutoRoute)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_route": token.AutoRoute, "routes": buildRouteViews(token.GetRoutes())})
}

// ProbeAdminMarketListing runs one probe immediately so the admin can check a listing right after editing it.
func ProbeAdminMarketListing(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var l model.MarketListing
	if err := model.DB.First(&l, "id = ?", id).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, probeMarketListing(c.Request.Context(), &l))
}
