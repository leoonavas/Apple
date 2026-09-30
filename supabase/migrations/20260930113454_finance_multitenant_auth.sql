create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.categories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.wallets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('checking','savings','investment')),
  opening_balance_cents bigint not null default 0 check (opening_balance_cents >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create unique index wallets_one_default_per_user_idx on public.wallets(user_id) where is_default;
create index wallets_user_kind_idx on public.wallets(user_id, kind);

create table public.messages (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now(),
  chart_json jsonb
);
create index messages_user_created_idx on public.messages(user_id, created_at desc, id desc);

create table public.attachments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null references public.messages(id) on delete cascade,
  original_name text not null,
  mime_type text not null,
  size bigint not null check (size > 0),
  sha256 text not null,
  storage_path text not null,
  extracted_text text,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);
create index attachments_user_message_idx on public.attachments(user_id, message_id, created_at);

create table public.wallet_transfers (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_wallet_id text not null references public.wallets(id) on delete restrict,
  to_wallet_id text not null references public.wallets(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  description text not null,
  occurred_on date not null,
  created_at timestamptz not null default now(),
  check (from_wallet_id <> to_wallet_id)
);
create index wallet_transfers_user_from_idx on public.wallet_transfers(user_id, from_wallet_id);
create index wallet_transfers_user_to_idx on public.wallet_transfers(user_id, to_wallet_id);

create table public.wallet_adjustments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id text not null references public.wallets(id) on delete cascade,
  direction text not null check (direction in ('credit','debit')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null,
  occurred_on date not null,
  created_at timestamptz not null default now()
);
create index wallet_adjustments_user_wallet_idx on public.wallet_adjustments(user_id, wallet_id);

create table public.recurrence_rules (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  direction text not null check (direction in ('income','expense')),
  amount_cents bigint not null check (amount_cents > 0),
  merchant text,
  description text not null,
  frequency text not null check (frequency in ('weekly','monthly','yearly')),
  start_on date not null,
  end_on date,
  category_ids_json jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_on is null or end_on >= start_on)
);
create index recurrence_rules_user_active_idx on public.recurrence_rules(user_id, active, start_on);

create table public.transactions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('income','expense')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null,
  merchant text,
  occurred_on date not null,
  wallet_id text references public.wallets(id) on delete set null,
  source_message_id text references public.messages(id) on delete set null,
  recurrence_id text references public.recurrence_rules(id) on delete set null,
  recurrence_due_on date,
  created_at timestamptz not null default now(),
  unique (user_id, recurrence_id, recurrence_due_on)
);
create index transactions_user_occurred_idx on public.transactions(user_id, occurred_on desc, created_at desc);
create index transactions_user_source_idx on public.transactions(user_id, source_message_id);

create table public.transaction_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text not null references public.transactions(id) on delete cascade,
  category_id text not null references public.categories(id) on delete cascade,
  primary key (transaction_id, category_id)
);
create index transaction_categories_user_category_idx on public.transaction_categories(user_id, category_id, transaction_id);

create table public.merchant_rules (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category_ids_json jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key)
);

create table public.processing_jobs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_message_id text not null references public.messages(id) on delete cascade,
  status text not null check (status in ('queued','processing','done','failed')) default 'queued',
  error text,
  attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, user_message_id)
);
create index processing_jobs_claim_idx on public.processing_jobs(status, created_at) where status in ('queued','processing');

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'categories','wallets','messages','attachments','wallet_transfers','wallet_adjustments',
    'recurrence_rules','transactions','transaction_categories','merchant_rules','processing_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_owner_all', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function private.bootstrap_finance_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare category_name text;
begin
  foreach category_name in array array[
    'Alimentação','Moradia','Transporte','Saúde','Educação','Lazer',
    'Compras Online','Vestuário','Assinaturas','Salário','Contas','Outros'
  ] loop
    insert into public.categories(id,user_id,name) values (gen_random_uuid()::text,new.id,category_name);
  end loop;
  insert into public.wallets(id,user_id,name,kind,is_default)
  values (gen_random_uuid()::text,new.id,'Conta corrente','checking',true);
  return new;
end;
$$;
revoke all on function private.bootstrap_finance_user() from public, anon, authenticated;
create trigger on_auth_user_created_finance
  after insert on auth.users
  for each row execute function private.bootstrap_finance_user();

create or replace function public.create_wallet_transfer(
  p_user_id uuid, p_from_wallet_id text, p_to_wallet_id text, p_create_name text,
  p_create_kind text, p_amount_cents bigint, p_description text
)
returns table (id text, to_wallet_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
        source_balance bigint;
        destination_id text := p_to_wallet_id;
begin
  if auth.uid() is not null then
    owner_id := auth.uid();
    if owner_id <> p_user_id then raise exception 'Não autorizado'; end if;
  elsif auth.role() = 'service_role' then
    owner_id := p_user_id;
  else
    raise exception 'Não autorizado';
  end if;
  if p_amount_cents <= 0 then raise exception 'Valor inválido'; end if;
  select w.opening_balance_cents
    + coalesce((select sum(case when t.direction='income' then t.amount_cents else -t.amount_cents end) from public.transactions t where t.user_id=owner_id and t.wallet_id=w.id),0)
    + coalesce((select sum(wt.amount_cents) from public.wallet_transfers wt where wt.user_id=owner_id and wt.to_wallet_id=w.id),0)
    - coalesce((select sum(wt.amount_cents) from public.wallet_transfers wt where wt.user_id=owner_id and wt.from_wallet_id=w.id),0)
    + coalesce((select sum(case when wa.direction='credit' then wa.amount_cents else -wa.amount_cents end) from public.wallet_adjustments wa where wa.user_id=owner_id and wa.wallet_id=w.id),0)
    into source_balance
    from public.wallets w where w.user_id=owner_id and w.id=p_from_wallet_id for update;
  if source_balance is null then raise exception 'Carteira de origem não encontrada'; end if;
  if source_balance < p_amount_cents then raise exception 'Saldo insuficiente'; end if;
  if destination_id is null and p_create_name is not null then
    if p_create_kind not in ('checking','savings','investment') then raise exception 'Tipo de carteira inválido'; end if;
    destination_id := gen_random_uuid()::text;
    insert into public.wallets(id,user_id,name,kind) values(destination_id,owner_id,p_create_name,p_create_kind);
  end if;
  if destination_id is null or destination_id=p_from_wallet_id then raise exception 'Carteira de destino inválida'; end if;
  if not exists(select 1 from public.wallets where user_id=owner_id and id=destination_id) then raise exception 'Carteira de destino não encontrada'; end if;
  id := gen_random_uuid()::text;
  insert into public.wallet_transfers(id,user_id,from_wallet_id,to_wallet_id,amount_cents,description,occurred_on)
    values(id,owner_id,p_from_wallet_id,destination_id,p_amount_cents,coalesce(nullif(trim(p_description),''),'Transferência entre carteiras'),current_date);
  to_wallet_id := destination_id;
  return next;
end;
$$;
revoke all on function public.create_wallet_transfer(uuid,text,text,text,text,bigint,text) from public, anon, authenticated, service_role;
grant execute on function public.create_wallet_transfer(uuid,text,text,text,text,bigint,text) to authenticated, service_role;

create or replace function public.materialize_recurrences(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
        due_date date;
        anchor_day integer;
        owner_id uuid;
begin
  if auth.uid() is not null then
    owner_id := auth.uid();
    if owner_id <> p_user_id then raise exception 'Não autorizado'; end if;
  elsif auth.role() = 'service_role' then
    owner_id := p_user_id;
  else
    raise exception 'Não autorizado';
  end if;
  for r in select * from public.recurrence_rules where user_id=owner_id and active and start_on<=current_date and (end_on is null or end_on>=current_date) loop
    select coalesce(max(recurrence_due_on),r.start_on - 1) into due_date from public.transactions where user_id=r.user_id and recurrence_id=r.id;
    anchor_day := extract(day from r.start_on);
    while due_date <= current_date loop
      if due_date < r.start_on then due_date := r.start_on;
      else
        due_date := case r.frequency
          when 'weekly' then due_date + interval '7 days'
          when 'yearly' then (date_trunc('month', due_date + interval '1 year') + (least(anchor_day, extract(day from (date_trunc('month', due_date + interval '1 year') + interval '1 month - 1 day'))::integer)-1) * interval '1 day')::date
          else (date_trunc('month', due_date + interval '1 month') + (least(anchor_day, extract(day from (date_trunc('month', due_date + interval '1 month') + interval '1 month - 1 day'))::integer)-1) * interval '1 day')::date
        end;
      end if;
      exit when due_date > current_date or (r.end_on is not null and due_date > r.end_on);
      insert into public.transactions(id,user_id,direction,amount_cents,description,merchant,occurred_on,wallet_id,recurrence_id,recurrence_due_on)
      select gen_random_uuid()::text,r.user_id,r.direction,r.amount_cents,r.description,r.merchant,due_date,w.id,r.id,due_date
      from public.wallets w where w.user_id=r.user_id and w.is_default
      on conflict (user_id,recurrence_id,recurrence_due_on) do nothing;
      insert into public.transaction_categories(user_id,transaction_id,category_id)
      select r.user_id,t.id,cid.value
      from public.transactions t cross join lateral jsonb_array_elements_text(r.category_ids_json) cid(value)
      join public.categories c on c.id=cid.value and c.user_id=r.user_id
      where t.user_id=r.user_id and t.recurrence_id=r.id and t.recurrence_due_on=due_date
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;
revoke all on function public.materialize_recurrences(uuid) from public, anon, authenticated, service_role;
grant execute on function public.materialize_recurrences(uuid) to authenticated, service_role;

create or replace function public.create_finance_transaction(
  p_user_id uuid, p_id text, p_direction text, p_amount_cents bigint, p_description text,
  p_merchant text, p_occurred_on date, p_wallet_id text, p_source_message_id text, p_category_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  if auth.uid() is not null then
    owner_id := auth.uid();
    if owner_id <> p_user_id then raise exception 'Não autorizado'; end if;
  elsif auth.role() = 'service_role' then owner_id := p_user_id;
  else raise exception 'Não autorizado'; end if;
  if p_direction not in ('income','expense') or p_amount_cents <= 0 or p_amount_cents > 100000000000 then raise exception 'Valor inválido'; end if;
  if not exists(select 1 from public.wallets w where w.id=p_wallet_id and w.user_id=owner_id) then raise exception 'Carteira inválida'; end if;
  if p_source_message_id is not null and not exists(select 1 from public.messages m where m.id=p_source_message_id and m.user_id=owner_id) then raise exception 'Mensagem inválida'; end if;
  if exists(select 1 from unnest(coalesce(p_category_ids,array[]::text[])) as ids(category_id) where not exists(select 1 from public.categories c where c.id=ids.category_id and c.user_id=owner_id)) then raise exception 'Categoria inválida'; end if;
  insert into public.transactions(id,user_id,direction,amount_cents,description,merchant,occurred_on,wallet_id,source_message_id)
    values(p_id,owner_id,p_direction,p_amount_cents,p_description,p_merchant,p_occurred_on,p_wallet_id,p_source_message_id);
  insert into public.transaction_categories(user_id,transaction_id,category_id)
    select owner_id,p_id,ids.category_id from unnest(coalesce(p_category_ids,array[]::text[])) as ids(category_id);
end;
$$;
revoke all on function public.create_finance_transaction(uuid,text,text,bigint,text,text,date,text,text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.create_finance_transaction(uuid,text,text,bigint,text,text,date,text,text,text[]) to authenticated, service_role;

create or replace function public.update_finance_transaction(
  p_user_id uuid, p_id text, p_direction text, p_amount_cents bigint, p_description text,
  p_merchant text, p_occurred_on date, p_category_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  if auth.uid() is not null then
    owner_id := auth.uid();
    if owner_id <> p_user_id then raise exception 'Não autorizado'; end if;
  elsif auth.role() = 'service_role' then owner_id := p_user_id;
  else raise exception 'Não autorizado'; end if;
  if p_direction not in ('income','expense') or p_amount_cents <= 0 or p_amount_cents > 100000000000 then raise exception 'Valor inválido'; end if;
  if exists(select 1 from unnest(coalesce(p_category_ids,array[]::text[])) as ids(category_id) where not exists(select 1 from public.categories c where c.id=ids.category_id and c.user_id=owner_id)) then raise exception 'Categoria inválida'; end if;
  update public.transactions set direction=p_direction,amount_cents=p_amount_cents,description=p_description,merchant=p_merchant,occurred_on=p_occurred_on
    where user_id=owner_id and id=p_id;
  if not found then raise exception 'Movimentação não encontrada'; end if;
  delete from public.transaction_categories where user_id=owner_id and transaction_id=p_id;
  insert into public.transaction_categories(user_id,transaction_id,category_id)
    select owner_id,p_id,ids.category_id from unnest(coalesce(p_category_ids,array[]::text[])) as ids(category_id);
end;
$$;
revoke all on function public.update_finance_transaction(uuid,text,text,bigint,text,text,date,text[]) from public, anon, authenticated, service_role;
grant execute on function public.update_finance_transaction(uuid,text,text,bigint,text,text,date,text[]) to authenticated, service_role;

create or replace function public.update_recurrence_rule(
  p_user_id uuid, p_id text, p_name text, p_direction text, p_amount_cents bigint,
  p_merchant text, p_description text, p_frequency text, p_start_on date, p_end_on date, p_category_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare owner_id uuid;
begin
  if auth.uid() is not null then
    owner_id := auth.uid();
    if owner_id <> p_user_id then raise exception 'Não autorizado'; end if;
  elsif auth.role() = 'service_role' then owner_id := p_user_id;
  else raise exception 'Não autorizado'; end if;
  if p_direction not in ('income','expense') or p_frequency not in ('weekly','monthly','yearly') or p_amount_cents <= 0 or p_amount_cents > 100000000000 then raise exception 'Dados da recorrência inválidos'; end if;
  if p_end_on is not null and p_end_on < p_start_on then raise exception 'Data final inválida'; end if;
  if exists(select 1 from unnest(coalesce(p_category_ids,array[]::text[])) as ids(category_id) where not exists(select 1 from public.categories c where c.id=ids.category_id and c.user_id=owner_id)) then raise exception 'Categoria inválida'; end if;
  update public.recurrence_rules set name=p_name,direction=p_direction,amount_cents=p_amount_cents,merchant=p_merchant,
    description=p_description,frequency=p_frequency,start_on=p_start_on,end_on=p_end_on,category_ids_json=to_jsonb(coalesce(p_category_ids,array[]::text[]))
    where user_id=owner_id and id=p_id;
  if not found then raise exception 'Recorrência não encontrada'; end if;
  delete from public.transactions where user_id=owner_id and recurrence_id=p_id and recurrence_due_on>=current_date;
  perform public.materialize_recurrences(owner_id);
end;
$$;
revoke all on function public.update_recurrence_rule(uuid,text,text,text,bigint,text,text,text,date,date,text[]) from public, anon, authenticated, service_role;
grant execute on function public.update_recurrence_rule(uuid,text,text,text,bigint,text,text,text,date,date,text[]) to authenticated, service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('finance-attachments','finance-attachments',false,20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "finance attachments are private to owner" on storage.objects
for select to authenticated using (
  bucket_id='finance-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);
create policy "finance attachment owner can upload" on storage.objects
for insert to authenticated with check (
  bucket_id='finance-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);
create policy "finance attachment owner can delete" on storage.objects
for delete to authenticated using (
  bucket_id='finance-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);

create or replace function public.claim_processing_job()
returns table (id text, user_id uuid, user_message_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Não autorizado'; end if;
  update public.processing_jobs j
    set status='failed', error='Limite de tentativas de processamento excedido', locked_until=null, updated_at=now()
    where j.status='processing' and j.locked_until < now() and j.attempts >= 5;
  return query
    with candidate as (
      select j.id from public.processing_jobs j
      where j.attempts < 5 and (j.status='queued' or (j.status='processing' and j.locked_until < now()))
      order by j.created_at
      for update skip locked
      limit 1
    )
    update public.processing_jobs j
    set status='processing', attempts=j.attempts+1, locked_until=now()+interval '30 minutes', error=null, updated_at=now()
    from candidate c where j.id=c.id
    returning j.id,j.user_id,j.user_message_id;
end;
$$;
revoke all on function public.claim_processing_job() from public, anon, authenticated;
grant execute on function public.claim_processing_job() to service_role;

create or replace function private.validate_finance_relationships()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name='attachments' then
    if not exists(select 1 from public.messages m where m.id=new.message_id and m.user_id=new.user_id) then raise exception 'Mensagem inválida'; end if;
    if split_part(new.storage_path,'/',1) <> new.user_id::text then raise exception 'Caminho de anexo inválido'; end if;
  elsif tg_table_name='transactions' then
    if new.wallet_id is not null and not exists(select 1 from public.wallets w where w.id=new.wallet_id and w.user_id=new.user_id) then raise exception 'Carteira inválida'; end if;
    if new.source_message_id is not null and not exists(select 1 from public.messages m where m.id=new.source_message_id and m.user_id=new.user_id) then raise exception 'Mensagem inválida'; end if;
    if new.recurrence_id is not null and not exists(select 1 from public.recurrence_rules r where r.id=new.recurrence_id and r.user_id=new.user_id) then raise exception 'Recorrência inválida'; end if;
  elsif tg_table_name='transaction_categories' then
    if not exists(select 1 from public.transactions t where t.id=new.transaction_id and t.user_id=new.user_id) then raise exception 'Movimentação inválida'; end if;
    if not exists(select 1 from public.categories c where c.id=new.category_id and c.user_id=new.user_id) then raise exception 'Categoria inválida'; end if;
  elsif tg_table_name='wallet_transfers' then
    if not exists(select 1 from public.wallets w where w.id=new.from_wallet_id and w.user_id=new.user_id) or not exists(select 1 from public.wallets w where w.id=new.to_wallet_id and w.user_id=new.user_id) then raise exception 'Carteira inválida'; end if;
  elsif tg_table_name='wallet_adjustments' then
    if not exists(select 1 from public.wallets w where w.id=new.wallet_id and w.user_id=new.user_id) then raise exception 'Carteira inválida'; end if;
  elsif tg_table_name in ('recurrence_rules','merchant_rules') then
    if exists(select 1 from jsonb_array_elements_text(new.category_ids_json) as ids(category_id) where not exists(select 1 from public.categories c where c.id=ids.category_id and c.user_id=new.user_id)) then raise exception 'Categoria inválida'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_finance_relationships() from public, anon, authenticated;
create trigger attachments_owner_relation before insert or update on public.attachments for each row execute function private.validate_finance_relationships();
create trigger transactions_owner_relation before insert or update on public.transactions for each row execute function private.validate_finance_relationships();
create trigger transaction_categories_owner_relation before insert or update on public.transaction_categories for each row execute function private.validate_finance_relationships();
create trigger wallet_transfers_owner_relation before insert or update on public.wallet_transfers for each row execute function private.validate_finance_relationships();
create trigger wallet_adjustments_owner_relation before insert or update on public.wallet_adjustments for each row execute function private.validate_finance_relationships();
create trigger recurrence_rules_owner_categories before insert or update on public.recurrence_rules for each row execute function private.validate_finance_relationships();
create trigger merchant_rules_owner_categories before insert or update on public.merchant_rules for each row execute function private.validate_finance_relationships();
