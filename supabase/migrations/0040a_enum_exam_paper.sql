-- =============================================================================
-- 0040a_enum_exam_paper.sql
-- T11「组卷」前置迁移：仅向 app_type_enum 追加 'exam_paper' 枚举值。
--
-- ⚠️ 为什么单独一个文件？
--   PostgreSQL 规定：alter type ... add value 与「使用这个新枚举值的语句」必须分属
--   不同事务——同一事务内新值尚未提交就被引用会报
--   `55P04: unsafe use of new value "exam_paper" of enum type app_type_enum`。
--   Supabase SQL Editor 把整段脚本当单事务执行，所以必须先把枚举值单独提交，
--   再在另一个脚本（0040_exam_paper.sql）里使用它。
--
-- 运行顺序（务必按此三步，可反复重跑）：
--   ① 先跑本文件 0040a  → 提交枚举值 'exam_paper'
--   ② 再跑 0040_exam_paper.sql → 写入 app_type_profiles 定价行 + 建表 + RLS + RPC
--   ③ （若尚未跑过）0038a → 0038 → 0039 已先行（每日一练数据层）
--
-- 幂等：add value if not exists 包在 do $$ exception when others then null $$ 里，
--      枚举已存在时静默跳过，反复粘贴运行不报错。
-- =============================================================================

do $$
begin
  alter type public.app_type_enum add value if not exists 'exam_paper';
exception
  when others then null;
end $$;
