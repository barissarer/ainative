-- Account leader requests and in-app notifications.
create table if not exists leader_requests (
  id text primary key,
  client_id text not null references clients(id),
  qualification_id text not null references qualifications(id),  -- version the leader is asked to react to
  requested_by text not null,
  assignee_id text not null,
  assignee_name text not null,
  assignee_role text not null,
  status text not null default 'pending' check (status in ('pending','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists notifications (
  id text primary key,
  user_id text not null,
  kind text not null,
  payload jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
