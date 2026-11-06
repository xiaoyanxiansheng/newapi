package model

import (
	"errors"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var upstreamCNYAmount = regexp.MustCompile(`^[0-9]{1,16}([.][0-9]{1,8})?$`)

// Amounts are upstream observations, not costs derived from tokens or balances.
func ValidateUpstreamCNY(value string, allowNegative bool) error {
	if value == "" {
		return nil
	}
	amount := value
	if allowNegative {
		amount = strings.TrimPrefix(amount, "-")
	}
	if !upstreamCNYAmount.MatchString(amount) {
		return errors.New("invalid upstream RMB amount")
	}
	return nil
}

// Reading a wallet never renews or replaces the Key snapshot.
func SaveUpstreamBalanceRead(account UpstreamAccount, remoteID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var current UpstreamAccount
		if err := lockForUpdate(tx).First(&current, account.Id).Error; err != nil {
			return err
		}
		if current.Revision != account.Revision {
			return errors.New("account changed; reload before saving")
		}
		if current.RemoteUserId > 0 && current.RemoteUserId != remoteID {
			return errors.New("browser authorization belongs to a different upstream account")
		}
		updates := map[string]any{"balance_issue": account.BalanceIssue, "revision": current.Revision + 1}
		if account.BalanceCNY != "" {
			updates["balance_cny"] = account.BalanceCNY
			updates["balance_read_time"] = common.GetTimestamp()
			updates["balance_issue"] = ""
		}
		result := tx.Model(&current).Where("revision = ?", account.Revision).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("account changed; reload before saving")
		}
		return nil
	})
}
