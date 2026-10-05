package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// TokenRoute is one model with its ordered channel list inside a token.
type TokenRoute struct {
	Model    string `json:"model"`
	Channels []int  `json:"channels"`
}

const maxTokenRouteModels = 200

func (token *Token) GetRoutes() []TokenRoute {
	if token.Routes == "" {
		return nil
	}
	var routes []TokenRoute
	if err := common.UnmarshalJsonStr(token.Routes, &routes); err != nil {
		common.SysError(fmt.Sprintf("failed to parse routes for token %d: %v", token.Id, err))
		return nil
	}
	return routes
}

func (token *Token) GetRouteMap() map[string][]int {
	routes := token.GetRoutes()
	m := make(map[string][]int, len(routes))
	for _, r := range routes {
		m[r.Model] = r.Channels
	}
	return m
}

// normalizeRoutes drops nameless and duplicated models. A model without channels is kept: the user
// added it on purpose and picks its channels later; requests for it fail with "no available channel".
func normalizeRoutes(routes []TokenRoute) []TokenRoute {
	out := make([]TokenRoute, 0, len(routes))
	seen := make(map[string]struct{}, len(routes))
	for _, r := range routes {
		if _, dup := seen[r.Model]; r.Model == "" || dup {
			continue
		}
		seen[r.Model] = struct{}{}
		if r.Channels == nil {
			r.Channels = []int{}
		}
		out = append(out, r)
	}
	return out
}

func (token *Token) setRoutes(routes []TokenRoute) error {
	routes = normalizeRoutes(routes)
	if len(routes) == 0 {
		token.Routes = ""
		return nil
	}
	data, err := common.Marshal(routes)
	if err != nil {
		return err
	}
	token.Routes = string(data)
	return nil
}

// MutateTokenRoutes loads the token row under a write lock, applies fn to its
// routes and saves them, so concurrent single-item edits do not overwrite each other.
func MutateTokenRoutes(tokenId int, userId int, fn func(routes []TokenRoute) ([]TokenRoute, error)) (*Token, error) {
	var result *Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Take the write lock first: on SQLite a read-then-write transaction fails
		// with SQLITE_BUSY as soon as another writer commits in between.
		lockResult := tx.Model(&Token{}).Where("id = ? and user_id = ?", tokenId, userId).Update("name", gorm.Expr("name"))
		if lockResult.Error != nil {
			return lockResult.Error
		}
		if lockResult.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		var token Token
		if err := lockForUpdate(tx).First(&token, "id = ? and user_id = ?", tokenId, userId).Error; err != nil {
			return err
		}
		next, err := fn(token.GetRoutes())
		if err != nil {
			return err
		}
		next = normalizeRoutes(next)
		if len(next) > maxTokenRouteModels {
			return errors.New("too many models in this key")
		}
		if err := token.setRoutes(next); err != nil {
			return err
		}
		if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
			common.SysLog("failed to invalidate token cache before route update: " + cacheErr.Error())
		}
		if err := tx.Model(&token).Select("routes").Updates(&token).Error; err != nil {
			return err
		}
		result = &token
		return nil
	})
	return result, err
}

func SetTokenAutoRoute(tokenId int, userId int, autoRoute bool) (*Token, error) {
	token, err := GetTokenByIds(tokenId, userId)
	if err != nil {
		return nil, err
	}
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog("failed to invalidate token cache before auto route update: " + cacheErr.Error())
	}
	token.AutoRoute = autoRoute
	if err := DB.Model(token).Select("auto_route").Updates(token).Error; err != nil {
		return nil, err
	}
	return token, nil
}
