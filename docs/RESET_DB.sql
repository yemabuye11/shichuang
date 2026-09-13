-- ============================================================
-- 重置 public 模式（仅清空用户表/函数/枚举/扩展）
-- 不动系统的 auth / storage / realtime 等 schema。
-- 用途：首次部署时合并 SQL 因报错中断，导致 0001-0011 已写入、
--       再跑合并文件撞 "function already exists / 42P13" 的半截状态。
-- 本项目是刚建的，里面没有任何真实数据，放心执行。
-- 执行后立刻跑 docs/ALL_MIGRATIONS_0001-0029.sql（只跑这一次）。
-- ============================================================

drop schema if exists public cascade;
create schema public;

grant all on schema public to postgres;
grant all on schema public to public;

-- 恢复 Supabase 默认角色权限（anon / authenticated / service_role）
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all functions in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
