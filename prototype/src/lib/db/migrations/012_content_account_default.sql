ALTER TABLE content_accounts
  ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1));

UPDATE content_accounts AS target
SET is_default = 1
WHERE target.status = 'active'
  AND target.id = (
    SELECT candidate.id
    FROM content_accounts candidate
    LEFT JOIN (
      SELECT content_account_id, COUNT(*) AS usage_count
      FROM user_current_context
      WHERE content_account_id IS NOT NULL
      GROUP BY content_account_id
    ) usage ON usage.content_account_id = candidate.id
    WHERE candidate.tenant_id = target.tenant_id
      AND candidate.ip_profile_id = target.ip_profile_id
      AND candidate.status = 'active'
    ORDER BY COALESCE(usage.usage_count, 0) DESC, candidate.created_at, candidate.id
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_accounts_one_default_per_ip
  ON content_accounts(tenant_id, ip_profile_id)
  WHERE is_default = 1;
