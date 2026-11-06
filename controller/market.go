package controller

import (
	"errors"
	"net/url"
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const maxChannelsPerModelRoute = 20

type marketChannel struct {
	PriceRatio          float64                  `json:"price_ratio"`
	OutputPrice         float64                  `json:"output_price"`
	Pricing             *model.Pricing           `json:"pricing,omitempty"`
	BillingMode         string                   `json:"billing_mode,omitempty"`
	BillingExpr         string                   `json:"billing_expr,omitempty"`
	OriginalBillingExpr string                   `json:"original_billing_expr,omitempty"`
	ChannelId           int                      `json:"channel_id"`
	WebsiteName         string                   `json:"website_name,omitempty"`
	ChannelName         string                   `json:"channel_name,omitempty"`
	ListingId           int                      `json:"listing_id"`
	Ratio               float64                  `json:"ratio"`
	Description         string                   `json:"description"`
	Joined              bool                     `json:"joined"`
	Position            int                      `json:"position"`
	ListedAt            int64                    `json:"listed_at"`
	Abnormal            bool                     `json:"abnormal"`
	Stats               *model.MarketStatSummary `json:"stats"`
	DefaultSuccess      bool                     `json:"default_success"`
	Score               *service.MarketScore     `json:"score"`
	MonitoringAvailable bool                     `json:"monitoring_available"`
}

type marketItem struct {
	model.Pricing
	MinRatio float64         `json:"min_ratio"`
	Channels []marketChannel `json:"channels"`
}

// GetMarketModels lists every model with at least one sellable channel. Channels are
// only identified by id for ordinary users. Administrators also receive website and channel names.
// When token_id is given, each channel reports whether the key joined it.
func GetMarketModels(c *gin.Context) {
	joinedListings := map[int]int{}
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
		for _, route := range model.LiveTokenRoutes(token.GetRoutes()) {
			for i := range route.Channels {
				if listing := route.Listing(i); listing != nil {
					joinedListings[listing.Id] = i + 1
				}
			}
		}
	}

	pricingByModel := map[string]model.Pricing{}
	for _, p := range model.GetPricing() {
		pricingByModel[p.ModelName] = p
	}
	// Older listings may predate inherited descriptions. Read the saved upstream
	// snapshot as a display-only fallback; manual listing descriptions win.
	inheritedDescription := map[int]string{}
	var sources []model.UpstreamSource
	if err := model.DB.Where("channel_id > 0 AND latest_json <> ''").Find(&sources).Error; err == nil {
		for _, source := range sources {
			var quotes []model.UpstreamQuote
			if common.UnmarshalJsonStr(source.LatestJSON, &quotes) != nil {
				continue
			}
			for _, quote := range quotes {
				description := quote.GroupDescription
				if description == "" {
					description = quote.Description
				}
				if description != "" {
					inheritedDescription[source.ChannelId] = description
					break
				}
			}
		}
	}

	grouped := map[string][]marketChannel{}
	showChannelNames := c.GetInt("id") > 0 && c.GetInt("role") >= common.RoleAdminUser
	websiteNames := map[int]string{}
	if showChannelNames {
		var identitySources []model.UpstreamSource
		if err := model.DB.Select("channel_id", "account_id", "base_url").Where("channel_id > 0").Find(&identitySources).Error; err == nil {
			accountIDs := make([]int, 0)
			seenAccounts := map[int]struct{}{}
			for _, source := range identitySources {
				if source.AccountId > 0 {
					if _, seen := seenAccounts[source.AccountId]; !seen {
						accountIDs = append(accountIDs, source.AccountId)
						seenAccounts[source.AccountId] = struct{}{}
					}
				}
			}
			accounts := map[int]model.UpstreamAccount{}
			if len(accountIDs) > 0 {
				var rows []model.UpstreamAccount
				if model.DB.Select("id", "name").Where("id IN ?", accountIDs).Find(&rows).Error == nil {
					for _, account := range rows {
						accounts[account.Id] = account
					}
				}
			}
			for _, source := range identitySources {
				name := ""
				if account, ok := accounts[source.AccountId]; ok {
					name = account.Name
				}
				if name == "" {
					if parsed, err := url.Parse(source.BaseURL); err == nil {
						name = parsed.Hostname()
					}
				}
				if name != "" {
					websiteNames[source.ChannelId] = name
				}
			}
		}
	}
	for _, l := range model.GetAllMarketListingsCached() {
		channel, ok := service.SellableListing(l)
		if !ok {
			continue
		}
		pricing := l.OriginalPricing(pricingByModel[l.ModelName])
		stats := model.GetMarketStatSummary(l.ChannelId, l.ModelName)
		outputPrice, discount := service.MarketListingPriceReference(l, pricing)
		cacheRatio := pricing.CacheRatio
		if cacheRatio == nil {
			cacheRatio = service.CacheRatioFromBillingExpr(l.OriginalBillingExpr)
			if cacheRatio == nil {
				cacheRatio = service.CacheRatioFromBillingExpr(pricing.BillingExpr)
			}
		}
		score := service.ScoreMarketListing(discount, cacheRatio, stats)
		originalPricing := pricing
		if l.BillingMode == "fixed_request" {
			price, err := model.ParseUpstreamAmount(l.BillingExpr)
			if err != nil {
				continue
			}
			originalPricing.ModelPrice, _ = price.Float64()
		}
		description := l.Description
		if description == "" {
			description = inheritedDescription[l.ChannelId]
		}
		mc := marketChannel{OutputPrice: outputPrice, Pricing: &originalPricing, BillingMode: l.BillingMode, BillingExpr: l.BillingExpr, OriginalBillingExpr: l.OriginalBillingExpr,
			ChannelId:           l.ChannelId,
			ListingId:           l.Id,
			Ratio:               l.Ratio,
			PriceRatio:          discount,
			Description:         description,
			ListedAt:            l.ListedAt,
			Stats:               stats,
			DefaultSuccess:      l.DefaultSuccess,
			Score:               &score,
			Abnormal:            stats != nil && stats.Abnormal,
			MonitoringAvailable: service.MarketListingMonitoringAvailable(l, pricing),
		}
		if showChannelNames {
			mc.WebsiteName = websiteNames[l.ChannelId]
			if mc.WebsiteName == "" {
				if parsed, err := url.Parse(channel.GetBaseURL()); err == nil {
					mc.WebsiteName = parsed.Hostname()
				}
			}
			mc.ChannelName = channel.Name
		}
		mc.Position = joinedListings[l.Id]
		mc.Joined = mc.Position > 0
		name := common.MarketBaseModel(l.ModelName)
		grouped[name] = append(grouped[name], mc)
	}

	items := make([]marketItem, 0, len(grouped))
	for name, channels := range grouped {
		sort.Slice(channels, func(i, j int) bool {
			if channels[i].OutputPrice != channels[j].OutputPrice {
				return channels[i].OutputPrice < channels[j].OutputPrice
			}
			if channels[i].ChannelId == channels[j].ChannelId {
				return channels[i].ListingId < channels[j].ListingId
			}
			return channels[i].ChannelId < channels[j].ChannelId
		})
		reference := model.MarketListing{ModelName: name, BillingMode: channels[0].BillingMode, OriginalBillingExpr: channels[0].OriginalBillingExpr}
		original := reference.OriginalPricing(pricingByModel[name])
		if channels[0].Pricing != nil {
			original = *channels[0].Pricing
		}
		original.ModelName = name
		items = append(items, marketItem{Pricing: original, MinRatio: channels[0].Ratio, Channels: channels})
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
	ListingId   int     `json:"listing_id,omitempty"`
	Ratio       float64 `json:"ratio"`
	Description string  `json:"description"`
	Available   bool    `json:"available"`
}

type routeView struct {
	Model    string             `json:"model"`
	Channels []routeChannelView `json:"channels"`
}

func buildRouteViews(routes []model.TokenRoute) []routeView {
	routes = model.LiveTokenRoutes(routes)
	views := make([]routeView, 0, len(routes))
	for _, r := range routes {
		v := routeView{Model: r.Model, Channels: make([]routeChannelView, 0, len(r.Channels))}
		for index, id := range r.Channels {
			listing := r.Listing(index)
			// A deleted listing can remain in an older token route JSON. It is
			// not a selectable fallback anymore, so do not expose its stale ID
			// in the route editor. Keep legacy channel-only entries visible.
			if listing == nil && r.ListingID(index) > 0 {
				continue
			}
			cv := routeChannelView{ChannelId: id}
			cv.ListingId = r.ListingID(index)
			if listing != nil {
				cv.ListingId = listing.Id
				cv.Ratio = listing.Ratio
				cv.Description = listing.Description
				_, cv.Available = service.SellableListing(listing)
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
	ListingId int    `json:"listing_id"`
}

func AddTokenRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" || req.ChannelId <= 0 {
		common.ApiErrorMsg(c, "model and channel_id are required")
		return
	}
	listing := model.GetMarketListing(req.ChannelId, req.Model)
	if req.ListingId > 0 {
		listing = model.GetMarketListingByID(req.ListingId)
	}
	if listing == nil || listing.ChannelId != req.ChannelId || common.MarketBaseModel(listing.ModelName) != common.MarketBaseModel(req.Model) {
		common.ApiErrorMsg(c, "this channel is not available in the market")
		return
	}
	if _, ok := service.SellableListing(listing); !ok {
		common.ApiErrorMsg(c, "this channel is not available in the market")
		return
	}
	req.Model = common.MarketBaseModel(req.Model)
	req.ListingId = listing.Id
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			for index := range routes[i].Channels {
				existing := routes[i].Listing(index)
				if existing != nil && existing.Id == req.ListingId {
					return routes, nil
				}
			}
			if len(routes[i].Channels) >= maxChannelsPerModelRoute {
				return nil, errors.New("too many channels for this model")
			}
			routes[i].AppendChannel(req.ChannelId, req.ListingId)
			return routes, nil
		}
		return append(routes, model.TokenRoute{Model: req.Model, Channels: []int{req.ChannelId}, ListingIDs: []int{req.ListingId}}), nil
	}, listing.Id)
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
	req.Model = common.MarketBaseModel(req.Model)
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			kept := model.TokenRoute{Model: routes[i].Model, Channels: []int{}}
			for index, existing := range routes[i].Channels {
				listing := routes[i].Listing(index)
				remove := existing == req.ChannelId && (req.ListingId == 0 || (listing != nil && listing.Id == req.ListingId) || routes[i].ListingID(index) == req.ListingId)
				if !remove {
					kept.AppendChannel(existing, routes[i].ListingID(index))
				}
			}
			routes[i] = kept
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
	req.Model = common.MarketBaseModel(req.Model)
	for _, l := range model.GetAllMarketListingsCached() {
		if common.MarketBaseModel(l.ModelName) != req.Model {
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
	req.Model = common.MarketBaseModel(req.Model)
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
	Model      string `json:"model"`
	Channels   []int  `json:"channels"`
	ListingIDs []int  `json:"listing_ids"`
}

func ReorderTokenRoute(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req tokenRouteOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Model == "" || len(req.Channels) == 0 {
		common.ApiErrorMsg(c, "model and channels are required")
		return
	}
	req.Model = common.MarketBaseModel(req.Model)
	token, err := model.MutateTokenRoutes(id, c.GetInt("id"), func(routes []model.TokenRoute) ([]model.TokenRoute, error) {
		for i := range routes {
			if routes[i].Model != req.Model {
				continue
			}
			if len(req.ListingIDs) > 0 {
				if len(req.ListingIDs) != len(routes[i].Channels) || len(req.Channels) != len(req.ListingIDs) {
					return nil, errors.New("channels do not match the current route, refresh and retry")
				}
				current := map[int]int{}
				for index, id := range routes[i].Channels {
					listing := routes[i].Listing(index)
					if listing == nil {
						return nil, errors.New("unavailable listing in route")
					}
					current[listing.Id] = id
				}
				seen := map[int]bool{}
				for index, id := range req.ListingIDs {
					channelID, exists := current[id]
					if !exists || channelID != req.Channels[index] || seen[id] {
						return nil, errors.New("channels do not match the current route, refresh and retry")
					}
					seen[id] = true
				}
				routes[i].Channels = req.Channels
				routes[i].ListingIDs = req.ListingIDs
				return routes, nil
			}
			if len(routes[i].ListingIDs) > 0 {
				listingIDs := make([]int, 0, len(req.Channels))
				for _, channelID := range req.Channels {
					found := false
					for index, currentID := range routes[i].Channels {
						if currentID == channelID {
							if found {
								return nil, errors.New("listing_ids are required to reorder supplier routes")
							}
							listingIDs = append(listingIDs, routes[i].ListingID(index))
							found = true
						}
					}
				}
				if len(listingIDs) != len(routes[i].Channels) {
					return nil, errors.New("channels do not match the current route, refresh and retry")
				}
				routes[i].ListingIDs = listingIDs
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
	Ratio          *float64 `json:"ratio"`
	Enabled        *bool    `json:"enabled"`
	Description    *string  `json:"description"`
	SortOrder      *int     `json:"sort_order"`
	DefaultSuccess *bool    `json:"default_success"`
	ProbeEndpoint  *string  `json:"probe_endpoint"`
}

func UpdateAdminMarketListing(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var req updateListingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ProbeEndpoint != nil {
		switch *req.ProbeEndpoint {
		case "", "openai", "openai-response", "anthropic", "gemini":
		default:
			common.ApiError(c, errors.New("unsupported probe endpoint"))
			return
		}
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
	if next.Enabled && (req.Enabled != nil || req.Ratio != nil) {
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
	if req.DefaultSuccess != nil {
		if err := model.DB.Model(&model.MarketListing{}).Where("id = ?", id).Update("default_success", *req.DefaultSuccess).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		model.InvalidateMarketListings()
		updated.DefaultSuccess = *req.DefaultSuccess
	}
	if req.ProbeEndpoint != nil {
		if err := model.DB.Model(&model.MarketListing{}).Where("id = ?", id).Update("probe_endpoint", *req.ProbeEndpoint).Error; err != nil {
			common.ApiError(c, err)
			return
		}
		model.InvalidateMarketListings()
		updated.ProbeEndpoint = *req.ProbeEndpoint
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
