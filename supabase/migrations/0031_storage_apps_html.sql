-- =============================================================================
-- 0031_storage_apps_html.sql
-- 补齐「影子副本」桶。
--
-- 背景（线上生成偶发失败的根因之一）：
--   Edge Function 的 SupabaseStorageStore 把应用/文档 HTML 写入名为 `apps-html`
--   的桶（见 supabase/functions/_shared/store/supabaseStorage.ts:12），
--   但 0018 只创建了 `docs` 桶，导致 `apps-html` 缺失时生成的兜底写入会报
--   STORE_FAILED。此迁移补齐该桶，保证生成链路完整。
--
-- 策略：公开读（影子副本本就用于回源兜底，与网页一致）；
--   写由 Edge Function 内的 service_role（adminClient）完成，不依赖 RLS。
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('apps-html', 'apps-html', true)
on conflict (id) do update set public = true;
