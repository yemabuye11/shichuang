# 0047 教材桶 Storage 策略

当前项目的 SQL Editor 角色不能修改 Supabase 管理的 `storage.objects` 系统表，会报：

`42501: must be owner of table objects`

因此先运行 `supabase/migrations/0047_textbook_storage.sql`（该文件现在只创建私有桶），再在 Supabase 控制台操作：

1. 打开 **Storage → Policies**，选择 `textbooks` 桶。
2. 选择 **New policy / Create policy from scratch**，目标角色均选 `authenticated`。
3. 创建下面 4 条策略。`SELECT` 和 `DELETE` 填 **USING expression**；`INSERT` 填 **WITH CHECK expression**；`UPDATE` 两个表达式都填。

表达式统一为（按 `tb/{当前用户 UUID}/{uuid}-{文件名}` 路径校验归属，不依赖数据库函数）：

```sql
bucket_id = 'textbooks'
and split_part(name, '/', 1) = 'tb'
and split_part(name, '/', 2) = (select auth.uid()::text)
```

策略名称与操作：

| 策略名称 | 操作 |
|---|---|
| `textbooks_select_owner` | SELECT |
| `textbooks_insert_owner` | INSERT |
| `textbooks_update_owner` | UPDATE |
| `textbooks_delete_owner` | DELETE |

不要勾选公开访问，也不要把 `anon` 加入目标角色。对象路径必须保持 `tb/{当前用户 UUID}/{uuid}-{文件名}`，否则归属校验会拒绝上传。

验证：

```sql
select id, public
from storage.buckets
where id = 'textbooks';

select policyname, cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'textbooks_%'
order by policyname;
```

应看到 `textbooks / false` 和 4 条策略。
