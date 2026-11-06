package model

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func sqliteAccountConcurrencyDB(t *testing.T) *gorm.DB {
	t.Helper()
	t.Setenv("SQL_DSN", "local")
	previousPath := common.SQLitePath
	common.SQLitePath = filepath.Join(t.TempDir(), "accounts.db")
	t.Cleanup(func() { common.SQLitePath = previousPath })
	db, kind, err := chooseDB("SQL_DSN", false)
	require.NoError(t, err)
	require.Equal(t, common.DatabaseTypeSQLite, kind)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(2)
	t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&UpstreamAccount{}))
	return db
}

func TestSQLiteAccountTransactionRemainsWritableWhenAnotherConnectionAttemptsAnUpdate(t *testing.T) {
	db := sqliteAccountConcurrencyDB(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	account := UpstreamAccount{Name: "pqai", Website: "https://pqai.cc", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)

	tx := db.Begin()
	require.NoError(t, tx.Error)
	defer tx.Rollback()
	var current UpstreamAccount
	require.NoError(t, tx.First(&current, account.Id).Error)
	originalRevision := current.Revision

	// Hold a separate writer if the read transaction failed to reserve writing.
	// A zero timeout makes contention deterministic; no sleeps or racing goroutines.
	competitor, err := sqlDB.Conn(context.Background())
	require.NoError(t, err)
	defer competitor.Close()
	_, err = competitor.ExecContext(context.Background(), "PRAGMA busy_timeout=0")
	require.NoError(t, err)
	_, beginErr := competitor.ExecContext(context.Background(), "BEGIN IMMEDIATE")
	if beginErr == nil {
		defer competitor.ExecContext(context.Background(), "ROLLBACK")
		_, err = competitor.ExecContext(context.Background(), "UPDATE upstream_accounts SET name = ? WHERE id = ?", "competing edit", account.Id)
		require.NoError(t, err)
	}
	result := tx.Model(&current).Where("revision = ?", current.Revision).Updates(map[string]any{"name": "saved account", "revision": current.Revision + 1})
	require.NoError(t, result.Error, "saving an account must not fail while upgrading its read transaction to a writer")
	require.EqualValues(t, 1, result.RowsAffected)
	require.NoError(t, tx.Commit().Error)
	require.Error(t, beginErr, "another writer must wait before the account read, not invalidate its snapshot")

	// After the reservation is released a stale settings form must still lose
	// the revision comparison rather than overwrite the successful save.
	stale, err := competitor.ExecContext(context.Background(), "UPDATE upstream_accounts SET name = ? WHERE id = ? AND revision = ?", "stale edit", account.Id, originalRevision)
	require.NoError(t, err)
	affected, err := stale.RowsAffected()
	require.NoError(t, err)
	assert.Zero(t, affected)
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, "saved account", account.Name)
	assert.Equal(t, originalRevision+1, account.Revision)
}

func TestSQLiteAccountSaveCommitsWhileAnotherConnectionReadsThePreviousRevision(t *testing.T) {
	db := sqliteAccountConcurrencyDB(t)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	account := UpstreamAccount{Name: "original", Website: "https://pqai.cc", Markup: "1.1"}
	require.NoError(t, db.Create(&account).Error)
	reader, err := sqlDB.Conn(context.Background())
	require.NoError(t, err)
	defer reader.Close()
	_, err = reader.ExecContext(context.Background(), "BEGIN")
	require.NoError(t, err)
	defer reader.ExecContext(context.Background(), "ROLLBACK")
	var before string
	require.NoError(t, reader.QueryRowContext(context.Background(), "SELECT name FROM upstream_accounts WHERE id = ?", account.Id).Scan(&before))
	require.NoError(t, db.Exec("PRAGMA busy_timeout=0").Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return tx.Model(&UpstreamAccount{}).Where("id = ? AND revision = ?", account.Id, account.Revision).Updates(map[string]any{"name": "saved", "revision": account.Revision + 1}).Error
	}))
	var stillReading string
	require.NoError(t, reader.QueryRowContext(context.Background(), "SELECT name FROM upstream_accounts WHERE id = ?", account.Id).Scan(&stillReading))
	assert.Equal(t, before, stillReading, "the reader keeps a consistent snapshot without blocking account saving")
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.Equal(t, "saved", account.Name)
	assert.EqualValues(t, 1, account.Revision)
}
