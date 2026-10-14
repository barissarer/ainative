-- "Save to campaign" flag. Idempotent so migrations can safely re-run on every start.
alter table clients add column if not exists in_campaign boolean not null default false;
alter table clients add column if not exists campaign_saved_by text;
alter table clients add column if not exists campaign_saved_at timestamptz;
