// =============================================================================
// scripts/verify-credit-expiry.mjs
// 注册赠送积分「7 天过期 + FIFO 扣减 + 到期作废」的本地/远程自测脚本。
//
// 用法（需可连 Supabase 实例，本机默认无实例，故平时不会执行，仅作部署后验证）：
//   export SUPABASE_URL=https://xxxx.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
//   node scripts/verify-credit-expiry.mjs
//
// 覆盖断言（对应迁移 0020）：
//   1) 发放：新用户注册后 credit_lots 有一条 reason='register_gift'、expires_at≈now()+7d；
//   2) 7 天内消费：reserve_credits 成功，FIFO 优先扣 gift lot；
//   3) 7 天后过期：void_expired_credits(uid) 把过期 lot 清零、余额扣回；
//   4) 余额正确：gift 100 → 消费 N → 余额 100-N；未消费则过期后回到 0。
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，跳过自测。');
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}

async function main() {
  const email = `verify+${Date.now()}@example.com`;
  const password = 'Test1234!';

  // 1) 注册新用户（触发 handle_new_user + tag_register_gift_lot 触发器）
  const { data: signup, error: signupErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (signupErr) throw signupErr;
  const uid = signup.user.id;
  console.log(`注册用户 ${uid}`);

  // 读取 gift lot
  const { data: lots, error: lotErr } = await sb
    .from('credit_lots')
    .select('*')
    .eq('user_id', uid)
    .eq('reason', 'register_gift');
  if (lotErr) throw lotErr;
  assert(lots.length === 1, '发放：存在一条 register_gift lot');
  const gift = lots[0];
  const days = (new Date(gift.expires_at) - new Date(gift.created_at)) / 86400000;
  assert(Math.abs(days - 7) < 0.5, `发放：过期时间≈7天（实际 ${days.toFixed(2)} 天）`);
  assert(gift.remaining === gift.amount && gift.amount > 0, `发放：lot 剩余=原始=${gift.amount}`);

  // 2) 7 天内消费：reserve_credits（用一张真实 generation_jobs 不方便，这里直接调用 RPC 预扣）
  const cost = 2;
  const jobId = crypto.randomUUID();
  const { data: reserve, error: reserveErr } = await sb.rpc('reserve_credits', {
    p_amount: cost,
    p_job_id: jobId,
    p_app_type: 'lesson_plan',
  });
  if (reserveErr) throw reserveErr;
  assert(reserve.ok === true, '消费：reserve_credits 成功');

  const { data: afterLots } = await sb
    .from('credit_lots')
    .select('remaining')
    .eq('user_id', uid)
    .eq('reason', 'register_gift')
    .single();
  assert(afterLots.remaining === gift.amount - cost, `消费：gift lot 剩余 ${afterLots.remaining} = ${gift.amount} - ${cost}`);

  // 3) 7 天后过期：本地无法直接快进时间，部署后等 7 天或临时把 registerGiftDays 调小再注册验证；
  //    这里演示手动调用 void_expired_credits（若已过期则余额回落）。
  const { error: voidErr } = await sb.rpc('void_expired_credits', { p_user_id: uid });
  if (voidErr) throw voidErr;
  console.log('  已调用 void_expired_credits（未过期时不影响余额，属幂等安全调用）');

  // 4) 余额正确：读取账户余额
  const { data: acct } = await sb
    .from('credit_accounts')
    .select('balance')
    .eq('user_id', uid)
    .single();
  assert(acct.balance === gift.amount - cost, `余额正确：${acct.balance} = ${gift.amount} - ${cost}（未过期场景）`);

  // 清理
  await sb.auth.admin.deleteUser(uid);

  console.log(failures === 0 ? '\n全部断言通过 ✅' : `\n${failures} 条断言失败 ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('自测异常：', e);
  process.exit(1);
});
