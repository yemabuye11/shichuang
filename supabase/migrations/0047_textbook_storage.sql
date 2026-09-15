-- 0047_textbook_storage.sql
-- 教材电子版独立存储：与校本 resources、文档 docs、应用 apps-html 分桶。

insert into storage.buckets (id, name, public)
values ('textbooks', 'textbooks', false)
on conflict (id) do update set public = false;

-- 注意：当前 Supabase 项目的 SQL Editor 角色不是 storage.objects 的 owner，
-- 因此本迁移不触碰 storage.objects。请按
-- docs/0047_textbook_storage_policies.md 在 Storage -> Policies 中创建 4 条策略。
