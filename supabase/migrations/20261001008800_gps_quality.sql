-- 008800: Chất lượng GPS của bài chạy ghi bằng app + kiểm thử thực địa.
-- • public.activity_gps_quality: MỘT dòng tóm tắt nhỏ (≤ 8 KB) cho mỗi bài DIRECT_GPS — số điểm nhận / bị loại theo lý do,
--   sai số trung bình, số lần + tổng giây mất tín hiệu, số lần ẩn app / tắt màn hình, tạm dừng, đứng nghỉ lâu, phần đứng yên
--   cuối bài bị cắt, nhật ký sự kiện, thiết bị (web / ios / android) và phần kiểm thử (kịch bản, quãng đường chuẩn, ghi chú).
--   KHÔNG lưu từng điểm bị loại (dữ liệu gấp 3–5 lần). Bảng riêng, không ai đọc trực tiếp: chủ bài + admin xem qua RPC.
-- • activity_attach_gps_quality(started_at, q): app gửi sau khi lưu bài (cả bài gửi lại từ hàng chờ) — tìm bài theo giờ bắt đầu.
-- • activity_gps_quality(activity): chủ bài / admin xem.
-- • admin_gps_qa_list(days): admin — các bài kiểm thử thực địa + thống kê chất lượng mọi bài ghi bằng app.
-- Không đổi submit_and_process_activity. Chạy được trong SQL Editor: không DO $$, không SELECT INTO, không LIMIT, không RETURNING INTO. Chạy lại an toàn.

create table if not exists public.activity_gps_quality (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  is_qa boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists activity_gps_quality_qa_idx on public.activity_gps_quality (created_at desc) where is_qa;
create index if not exists activity_gps_quality_created_idx on public.activity_gps_quality (created_at desc);
alter table public.activity_gps_quality enable row level security;
revoke all on public.activity_gps_quality from public, anon, authenticated;

create or replace function public.activity_attach_gps_quality(p_started_at timestamptz, p_quality jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := private.require_uid();
  v_act uuid := (select (array_agg(a.id order by a.created_at desc))[1] from public.activities a
                  where a.user_id = v_uid and a.source = 'DIRECT_GPS' and a.started_at = p_started_at);
begin
  if p_quality is null or jsonb_typeof(p_quality) <> 'object' then raise exception 'INVALID_INPUT'; end if;
  if octet_length(p_quality::text) > 8192 then raise exception 'PAYLOAD_TOO_LARGE'; end if;
  if v_act is null then return false; end if;
  insert into public.activity_gps_quality (activity_id, user_id, data, is_qa)
  values (v_act, v_uid, p_quality, jsonb_typeof(p_quality->'qa') = 'object')
  on conflict (activity_id) do nothing;
  return true;
end $$;

create or replace function public.activity_gps_quality(p_activity_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  q public.activity_gps_quality := (select x from public.activity_gps_quality x where x.activity_id = p_activity_id);
begin
  if q.activity_id is null then return null; end if;
  if q.user_id is distinct from v_uid and not public.is_system_admin() then raise exception 'FORBIDDEN'; end if;
  return q.data;
end $$;

create or replace function public.admin_gps_qa_list(p_days integer default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := private.require_admin();
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 60), 1), 365));
begin
  return jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'activity_id', r.activity_id, 'user_id', r.user_id, 'name', private.display_name(r.user_id),
               'started_at', a.started_at, 'distance_m', a.distance_m, 'moving_s', a.moving_time_s, 'elapsed_s', a.elapsed_time_s,
               'validation_status', a.validation_status, 'data', r.data) order by r.created_at desc)
        from (select x.*, row_number() over (order by x.created_at desc) as rn
                from public.activity_gps_quality x where x.is_qa and x.created_at >= v_from) r
        join public.activities a on a.id = r.activity_id
       where r.rn <= 300), '[]'::jsonb),
    'all', (select jsonb_build_object(
              'runs', count(*)::int,
              'fixes', coalesce(sum((x.data->>'fixes')::numeric), 0),
              'accepted', coalesce(sum((x.data->>'accepted')::numeric), 0),
              'with_gaps', count(*) filter (where coalesce((x.data->>'gaps')::int, 0) > 0)::int,
              'gap_s', coalesce(sum((x.data->>'gap_s')::numeric), 0),
              'trimmed', count(*) filter (where coalesce((x.data->>'trimmed_s')::int, 0) > 0)::int,
              'auto_stopped', count(*) filter (where coalesce((x.data->>'auto_stopped')::int, 0) > 0)::int,
              'acc_avg', round(avg((x.data->>'acc_avg')::numeric), 1),
              'by_platform', coalesce((select jsonb_object_agg(pl, n) from (
                  select coalesce(y.data->>'platform', 'web') as pl, count(*)::int as n
                    from public.activity_gps_quality y where y.created_at >= v_from group by 1) z), '{}'::jsonb))
              from public.activity_gps_quality x where x.created_at >= v_from),
    'days', least(greatest(coalesce(p_days, 60), 1), 365));
end $$;

revoke all on function public.activity_attach_gps_quality(timestamptz, jsonb), public.activity_gps_quality(uuid),
  public.admin_gps_qa_list(integer) from public, anon;
grant execute on function public.activity_attach_gps_quality(timestamptz, jsonb), public.activity_gps_quality(uuid),
  public.admin_gps_qa_list(integer) to authenticated;

notify pgrst, 'reload schema';
