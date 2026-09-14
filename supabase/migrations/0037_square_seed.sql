-- =============================================================================
-- 0037_square_seed.sql
-- 应用广场示例应用种子（幂等，可重复执行）。
--
-- 背景：客户（教务老师野马）打开「应用广场」是空的，希望先挂一批示例应用，
--       让广场看起来有内容、可浏览、可点开。
--
-- 真实数据链路（已读代码确认，非猜测）：
--   1) 广场列表走 RPC `public.list_square`（见 0009），筛选条件只有
--        `a.status = 'published'`（外加可选的 type/subject/grade/q 过滤）。
--      所以只要 status='published' 就一定会显示在广场上。
--   2) `apps` 表**没有**存放 HTML 正文的字段（见 0003）：HTML 正文正常流程
--      写入 `apps-html` 存储桶，由 `html_url` 指向其对外 URL。
--      前端打开应用时（`AppRunPage` → `artifactService.resolvePlaySource`）直接把
--      `apps.html_url` 当作 iframe 的 src。
--   3) `SafeAppIframe` 的 sandbox = allow-scripts allow-forms allow-popups（无
--      allow-same-origin），因此内联 JS 在 `data:` URI 中可正常运行。
--   4) RLS：`apps_select_public` 允许 anon 读取 `status='published'` 的行，
--      故未登录也能浏览与打开（P0-A3）。
--
-- 本迁移设计：
--   * 把每条应用的 HTML 以 base64 `data:` URI 直接写进 `html_url`，使种子**自包含**、
--     不依赖存储桶 / Edge Function，在客户的 Supabase 项目上粘贴即可一次跑通、点开即用。
--   * `credits_cost` 一律来自 `app_type_profiles.credit_cost`（动态子查询），不写死价格。
--   * `author_id` 取现有用户（最早注册的，即野马自己）；若 `profiles` 为空则整段跳过、
--     仅 raise notice，不报错（保证在他库任何时候跑都不炸）。
--   * 每条用 `where not exists (title=...)` 保护，重复执行不会重复插入。
--   * 封面用程序生成的渐变（AutoCover 取 cover_seed），不准备任何图片。
-- =============================================================================

do $$
declare
  v_owner uuid;
begin
  -- 取一个真实存在的 owner（最早注册的用户）；为空则安全跳过。
  select id into v_owner from public.profiles order by created_at limit 1;

  if v_owner is null then
    raise notice '[0037_square_seed] profiles 表为空，跳过示例应用插入（不报错）。';
    return;
  end if;

  -- ---------------------------------------------------------------------------
  -- 1) 教学动画：小学语文《静夜思》古诗意境动画
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【教学动画】静夜思·古诗意境动画',
    '小学语文古诗《静夜思》配套动画课件，点击逐句呈现，帮助学生想象诗句意境。',
    'teaching_animation'::public.app_type_enum,
    '语文', '小学', '人教版', '约 3 分钟', '易',
    '生成小学古诗《静夜思》教学动画', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-anim-01', null,
    'published', now() - interval '6 hours',
    128, 36, 4,
    c.cost, 0, 0, 0, null
  from (select convert_to($h1$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>静夜思·古诗意境</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:linear-gradient(160deg,#1b2a4a,#3a5a8c);color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
.moon{width:70px;height:70px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fffef0,#f5e9a8);box-shadow:0 0 40px #ffe9a8;margin-bottom:18px}
.poem{font-size:26px;line-height:2;text-align:center;font-weight:700;letter-spacing:2px}
.line{opacity:0;transition:opacity .8s}
.line.show{opacity:1}
button{margin-top:24px;padding:10px 22px;border:none;border-radius:24px;background:#ffd166;color:#333;font-size:16px;font-weight:700;cursor:pointer}
.tip{margin-top:14px;font-size:13px;opacity:.8;max-width:320px;text-align:center}
</style></head><body>
<div class="moon"></div>
<div class="poem">
<div class="line" id="l1">床前明月光</div>
<div class="line" id="l2">疑是地上霜</div>
<div class="line" id="l3">举头望明月</div>
<div class="line" id="l4">低头思故乡</div>
</div>
<button onclick="play()">▶ 播放意境</button>
<div class="tip">师创 · 小学语文古诗配套动画，点击逐句呈现，帮助学生想象诗句意境。</div>
<script>
var i=0,ids=['l1','l2','l3','l4'];
function play(){if(i<ids.length){document.getElementById(ids[i]).classList.add('show');i++}else{i=0;ids.forEach(function(k){document.getElementById(k).classList.remove('show')})}}
</script>
</body></html>$h1$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='teaching_animation'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【教学动画】静夜思·古诗意境动画');

  -- ---------------------------------------------------------------------------
  -- 2) 教育应用：初中数学·一元二次方程求根计算器
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【教育应用】一元二次方程求根计算器',
    '初中数学小工具：输入 a、b、c，自动求解 ax²+bx+c=0，并判读判别式。',
    'edu_tool'::public.app_type_enum,
    '数学', '初中', '人教版', '约 2 分钟', '中',
    '生成一元二次方程求根计算器', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-tool-02', null,
    'published', now() - interval '4 hours',
    96, 22, 2,
    c.cost, 0, 0, 0, null
  from (select convert_to($h2$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一元二次方程求根</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f7fb;color:#1f2d3d;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px;margin-bottom:6px}.sub{color:#6b7a8d;font-size:13px;margin-bottom:16px}
.row{display:flex;gap:6px;align-items:center;margin:6px 0}.row label{width:70px;font-size:15px}
input{width:70px;padding:8px;border:1px solid #c9d4e0;border-radius:8px;font-size:15px;text-align:center}
button{margin-top:14px;padding:10px 24px;border:none;border-radius:24px;background:#2f6df0;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.res{margin-top:16px;font-size:16px;line-height:1.8;background:#fff;padding:14px 18px;border-radius:12px;min-width:260px;box-shadow:0 4px 14px rgba(0,0,0,.06)}
.foot{margin-top:18px;color:#9aa7b5;font-size:12px}
</style></head><body>
<h2>一元二次方程求根计算器</h2><div class="sub">师创 · 初中数学，输入 a、b、c 自动求解 ax²+bx+c=0</div>
<div class="row"><label>a x²</label><input id="a" value="1"><span>+</span><label>b x</label><input id="b" value="-3"><span>+</span><label>c</label><input id="c" value="2"></div>
<button onclick="calc()">计算根</button>
<div class="res" id="r">请输入系数后点击「计算根」。</div>
<div class="foot">判别式 Δ = b² − 4ac</div>
<script>
function calc(){var a=+document.getElementById('a').value,b=+document.getElementById('b').value,c=+document.getElementById('c').value;var r=document.getElementById('r');if(a===0){r.innerHTML='a 不能为 0，这不是一元二次方程。';return}var d=b*b-4*a*c;if(d>0){var x1=(-b+Math.sqrt(d))/(2*a),x2=(-b-Math.sqrt(d))/(2*a);r.innerHTML='Δ = '+d+' &gt; 0，有两个不等实根：<br>x₁ = '+x1.toFixed(2)+'<br>x₂ = '+x2.toFixed(2)}else if(d===0){var x=-b/(2*a);r.innerHTML='Δ = 0，有两个相等实根：<br>x = '+x.toFixed(2)}else{r.innerHTML='Δ = '+d+' &lt; 0，无实数根（有一对共轭虚根）。'}}
</script>
</body></html>$h2$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='edu_tool'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【教育应用】一元二次方程求根计算器');

  -- ---------------------------------------------------------------------------
  -- 3) 教学游戏：初中英语·单词闯关
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【教学游戏】英语单词闯关',
    '初中英语单词游戏：看英文选中文，答对得分，错题自动高亮正确答案。',
    'teaching_game'::public.app_type_enum,
    '英语', '初中', '人教版', '约 3 分钟', '易',
    '生成初中英语单词闯关游戏', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-game-03', null,
    'published', now() - interval '3 hours',
    210, 58, 9,
    c.cost, 0, 0, 0, null
  from (select convert_to($h3$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>英语单词闯关</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:linear-gradient(160deg,#fff7e6,#ffe0c2);color:#5a3a1a;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#9a6b3a;margin:6px 0 14px}
.card{background:#fff;border-radius:16px;padding:22px;width:300px;box-shadow:0 8px 24px rgba(200,120,40,.15);text-align:center}
.eng{font-size:30px;font-weight:800;color:#e8590c}
.q{margin:14px 0;font-size:15px}.opts{display:grid;gap:8px}
button.o{padding:10px;border:2px solid #ffd8a8;background:#fff;border-radius:10px;font-size:15px;cursor:pointer}
button.o.ok{background:#d3f9d8;border-color:#69db7c}
button.o.no{background:#ffe3e3;border-color:#ff8787}
.score{margin-top:12px;font-size:14px;color:#9a6b3a}.foot{margin-top:14px;font-size:12px;color:#b0894a}
</style></head><body>
<h2>英语单词闯关</h2><div class="sub">师创 · 初中英语，看英文选中文，答对得分</div>
<div class="card"><div class="eng" id="w">apple</div><div class="q">它的意思是？</div><div class="opts" id="opts"></div><div class="score" id="s">得分：0 / 0</div></div>
<div class="foot">共 5 题，刷新可重玩</div>
<script>
var bank=[['apple','苹果'],['banana','香蕉'],['teacher','老师'],['school','学校'],['happy','开心']];
var wrongs=['橙子','葡萄','学生','医院','难过'];var i=0,sc=0,tot=0;
function rnd(n){return Math.floor(Math.random()*n)}
function next(){if(i>=bank.length){document.getElementById('w').textContent='完成!';document.getElementById('opts').innerHTML='';return}var cur=bank[i];document.getElementById('w').textContent=cur[0];var opt=[cur[1],wrongs[i]];if(rnd(2)===0)opt.reverse();var h='';opt.forEach(function(t){h+='<button class="o" onclick="ans(this,'+"'"+t+"'"+','+"'"+cur[1]+"'+')">'+t+'</button>'});document.getElementById('opts').innerHTML=h}
function ans(b,t,right){tot++;if(t===right){sc++;b.classList.add('ok')}else{b.classList.add('no');var bs=document.getElementById('opts').children;for(var k=0;k<bs.length;k++){if(bs[k].textContent===right)bs[k].classList.add('ok')}}document.getElementById('s').textContent='得分：'+sc+' / '+tot;i++;setTimeout(next,700)}
next();
</script>
</body></html>$h3$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='teaching_game'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【教学游戏】英语单词闯关');

  -- ---------------------------------------------------------------------------
  -- 4) 教学游戏（第 2 条）：小学语文·成语接龙大挑战
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【教学游戏】成语接龙大挑战',
    '小学语文互动游戏：按上一个成语的最后一个字接龙，答错也给出示例成语。',
    'teaching_game'::public.app_type_enum,
    '语文', '小学', '通用', '约 3 分钟', '中',
    '生成小学语文成语接龙游戏', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-game-04', null,
    'published', now() - interval '2 hours',
    75, 19, 1,
    c.cost, 0, 0, 0, null
  from (select convert_to($h4$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>成语接龙</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#eafaf0;color:#1b4332;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#40916c;margin:6px 0 14px}
.box{background:#fff;border-radius:16px;padding:20px;width:320px;box-shadow:0 8px 24px rgba(40,160,90,.15)}
.chain{font-size:18px;line-height:2;min-height:60px;word-break:break-all}
input{padding:10px;width:100%;border:1px solid #b7e4c7;border-radius:10px;font-size:16px;margin-top:8px}
button{margin-top:10px;width:100%;padding:10px;border:none;border-radius:24px;background:#2b8a3e;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.msg{margin-top:10px;font-size:14px;min-height:20px}.foot{margin-top:14px;font-size:12px;color:#74b896}
</style></head><body>
<h2>成语接龙大挑战</h2><div class="sub">师创 · 小学语文，按最后一个字接龙，答错也给出示例</div>
<div class="box"><div class="chain" id="c">一帆风顺</div><input id="in" placeholder="输入以「顺」开头的成语"><button onclick="go()">接龙</button><div class="msg" id="m"></div></div>
<div class="foot">例：顺水推舟 → 舟车劳顿</div>
<script>
var last='顺';var demo={'顺':['顺水推舟','顺理成章'],'舟':['舟车劳顿'],'章':['章台杨柳'],'风':['风和日丽'],'丽':['丽藻春葩']};
function go(){var v=document.getElementById('in').value.trim();var m=document.getElementById('m');if(v.length<4){m.textContent='请输入 4 字成语';return}if(v.charAt(0)!==last){m.textContent='要以「'+last+'」开头哦';return}last=v.charAt(v.length-1);document.getElementById('c').textContent+=' → '+v;document.getElementById('in').value='';if(demo[last]){m.textContent='不错！示例可接：'+demo[last].join('、')}else{m.textContent='接上啦！你可以继续出一个以「'+last+'」开头的成语'}}
</script>
</body></html>$h4$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='teaching_game'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【教学游戏】成语接龙大挑战');

  -- ---------------------------------------------------------------------------
  -- 5) 互动课件：初中物理·串并联电路互动
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【互动课件】串并联电路',
    '初中物理互动课件：切换串联/并联，直观看到总电阻与电流电压关系的变化。',
    'interactive_courseware'::public.app_type_enum,
    '物理', '初中', '人教版', '约 4 分钟', '中',
    '生成初中物理串并联电路互动课件', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-cw-05', null,
    'published', now() - interval '1 hours',
    154, 41, 5,
    c.cost, 0, 0, 0, null
  from (select convert_to($h5$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>串并联电路</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f0f4f8;color:#1f2d3d;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#5b6b7d;margin:6px 0 14px}
.box{background:#fff;border-radius:16px;padding:20px;width:320px;box-shadow:0 8px 24px rgba(30,60,90,.12)}
.btns{display:flex;gap:8px;margin-bottom:12px}
button{flex:1;padding:9px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;background:#dbe4ee;color:#334}
button.on{background:#2f6df0;color:#fff}
.r{font-size:14px;line-height:1.9;margin-top:8px}.foot{margin-top:14px;font-size:12px;color:#8493a5}
</style></head><body>
<h2>串并联电路互动</h2><div class="sub">师创 · 初中物理，切换连接方式看总电阻变化（R₁=4Ω，R₂=6Ω）</div>
<div class="box"><div class="btns"><button id="b1" class="on" onclick="set('s')">串联</button><button id="b2" onclick="set('p')">并联</button></div><div class="r" id="r"></div></div>
<div class="foot">串联 R=R₁+R₂；并联 1/R=1/R₁+1/R₂</div>
<script>
var mode='s';function set(m){mode=m;document.getElementById('b1').className=m==='s'?'on':'';document.getElementById('b2').className=m==='p'?'on':'';show()}
function show(){var r=document.getElementById('r');if(mode==='s'){var t=4+6;r.innerHTML='连接方式：<b>串联</b><br>总电阻 R = 4 + 6 = <b>'+t+' Ω</b><br>电流处处相等，总电压分压。'}else{var tp=1/(1/4+1/6);r.innerHTML='连接方式：<b>并联</b><br>1/R = 1/4 + 1/6<br>总电阻 R ≈ <b>'+tp.toFixed(2)+' Ω</b><br>各支路电压相等。'}}
show();
</script>
</body></html>$h5$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='interactive_courseware'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【互动课件】串并联电路');

  -- ---------------------------------------------------------------------------
  -- 6) 互动课件（第 2 条）：初中化学·元素周期表探秘
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【互动课件】元素周期表探秘',
    '初中化学互动课件：点击常见元素卡片，查看名称、符号与原子序数，帮助速记。',
    'interactive_courseware'::public.app_type_enum,
    '化学', '初中', '人教版', '约 3 分钟', '易',
    '生成初中化学元素周期表互动课件', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-cw-06', null,
    'published', now() - interval '5 hours',
    88, 27, 3,
    c.cost, 0, 0, 0, null
  from (select convert_to($h6$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>元素探秘</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#fdf2f8;color:#4a2545;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#a64d79;margin:6px 0 14px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:300px}
.e{padding:12px 0;text-align:center;border-radius:10px;background:#fff;border:2px solid #f3c6dd;cursor:pointer;font-weight:700}
.e:hover{border-color:#e64980}
.info{margin-top:14px;background:#fff;border-radius:12px;padding:14px;width:300px;font-size:14px;line-height:1.8;min-height:60px}.foot{margin-top:12px;font-size:12px;color:#c97aa6}
</style></head><body>
<h2>元素周期表探秘</h2><div class="sub">师创 · 初中化学，点元素看名称与符号</div>
<div class="grid" id="g"></div><div class="info" id="i">点击上方元素卡片查看详情</div>
<div class="foot">常见元素速记</div>
<script>
var els=[['H','氢','1'],['O','氧','8'],['C','碳','6'],['Fe','铁','26'],['Na','钠','11'],['Cl','氯','17'],['Cu','铜','29'],['He','氦','2']];
var h='';els.forEach(function(e,i){h+='<div class="e" onclick="show('+i+')">'+e[0]+'</div>'});document.getElementById('g').innerHTML=h;
function show(i){var e=els[i];document.getElementById('i').innerHTML='<b>'+e[0]+'</b> '+e[1]+'<br>原子序数：'+e[2]+'<br>师创小提示：'+(e[0]==='O'?'呼吸离不开它':e[0]==='Fe'?'钢铁的主要元素':'记住符号和名称就能应对考试')}
</script>
</body></html>$h6$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='interactive_courseware'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【互动课件】元素周期表探秘');

  -- ---------------------------------------------------------------------------
  -- 7) 数据回收：课堂反馈小测（随堂数据回收）
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【数据回收】课堂反馈小测',
    '随堂数据回收：学生作答后实时汇总，帮助老师快速掌握课堂情况。',
    'data_collection'::public.app_type_enum,
    '综合', '通用', '通用', '约 2 分钟', '易',
    '生成课堂反馈数据回收小测', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-dc-07', null,
    'published', now() - interval '7 hours',
    63, 15, 0,
    c.cost, 0, 0, 0, null
  from (select convert_to($h7$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>课堂反馈</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#eef3ff;color:#1f2d3d;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#5b6b7d;margin:6px 0 14px}
.box{background:#fff;border-radius:16px;padding:18px;width:320px;box-shadow:0 8px 24px rgba(30,60,120,.12)}
.q{font-size:15px;margin:12px 0 6px}.opts{display:flex;gap:8px}
button.o{flex:1;padding:9px;border:2px solid #c5d2ff;background:#fff;border-radius:10px;font-size:14px;cursor:pointer}
button.o.sel{background:#3b5bdb;color:#fff;border-color:#3b5bdb}
.bar{height:10px;background:#edf0f7;border-radius:6px;margin-top:6px;overflow:hidden}.fill{height:100%;background:#3b5bdb;width:0}
.foot{margin-top:14px;font-size:12px;color:#8493a5}
</style></head><body>
<h2>课堂反馈小测</h2><div class="sub">师创 · 随堂数据回收：学生作答后实时汇总</div>
<div class="box">
<div class="q">1. 这节课听懂了吗？</div><div class="opts"><button class="o" onclick="pick(this,0)">听懂了</button><button class="o" onclick="pick(this,1)">还行</button><button class="o" onclick="pick(this,2)">没懂</button></div><div class="bar"><div class="fill" id="f0"></div></div>
<div class="q">2. 内容节奏合适吗？</div><div class="opts"><button class="o" onclick="pick2(this,0)">太快</button><button class="o" onclick="pick2(this,1)">刚好</button><button class="o" onclick="pick2(this,2)">太慢</button></div><div class="bar"><div class="fill" id="f1"></div></div>
<div class="foot" id="t">已回收 0 份作答</div>
</div>
<div class="foot">数据仅在本页演示，刷新重置</div>
<script>
var n=0,sum=[0,0,0],sum2=[0,0,0];
function pick(b,k){b.classList.add('sel');sum[k]++;upd()}
function pick2(b,k){b.classList.add('sel');sum2[k]++;upd()}
function upd(){n++;document.getElementById('t').textContent='已回收 '+n+' 份作答（演示）';var mx=Math.max.apply(null,sum),mx2=Math.max.apply(null,sum2);document.getElementById('f0').style.width=(mx>0?100:0)+'%';document.getElementById('f1').style.width=(mx2>0?100:0)+'%'}
</script>
</body></html>$h7$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='data_collection'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【数据回收】课堂反馈小测');

  -- ---------------------------------------------------------------------------
  -- 8) AI命题：随机出题·选择填空自测
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【AI命题】随机出题自测',
    'AI命题演示：点「出新题」从内置题库随机生成选择题并即时判分，可无限刷新。',
    'ai_item_generation'::public.app_type_enum,
    '数学', '初中', '通用', '约 3 分钟', '易',
    '生成随机出题选择题自测', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-ai-08', null,
    'published', now() - interval '8 hours',
    132, 33, 6,
    c.cost, 0, 0, 0, null
  from (select convert_to($h8$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>随机出题</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#fff0f6;color:#4a2438;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#c2255c;margin:6px 0 14px}
.card{background:#fff;border-radius:16px;padding:20px;width:320px;box-shadow:0 8px 24px rgba(180,40,90,.15)}
.q{font-size:17px;line-height:1.7;margin-bottom:10px}.opts{display:grid;gap:8px}
button.o{padding:10px;border:2px solid #fcc2d7;background:#fff;border-radius:10px;font-size:15px;cursor:pointer;text-align:left}
button.o.ok{background:#d3f9d8;border-color:#69db7c}
button.o.no{background:#ffe3e3;border-color:#ff8787}
.bar{margin-top:12px;font-size:14px}.foot{margin-top:14px;font-size:12px;color:#d6709a}
</style></head><body>
<h2>AI 随机出题</h2><div class="sub">师创 · AI命题演示，点「出新题」随机生成选择题并判分</div>
<div class="card"><div class="q" id="q">点击下方按钮开始</div><div class="opts" id="o"></div><div class="bar" id="b">正确率：—</div></div>
<button style="margin-top:12px;padding:10px 22px;border:none;border-radius:24px;background:#c2255c;color:#fff;font-size:16px;font-weight:700;cursor:pointer" onclick="newQ()">出新题</button>
<div class="foot">题目由内置题库随机组合，可无限刷新</div>
<script>
var tot=0,rig=0;
function rnd(n){return Math.floor(Math.random()*n)}
function newQ(){var a=rnd(20)+1,b=rnd(20)+1,op=rnd(2),ans,txt;if(op===0){ans=a+b;txt=a+'+'+b+' = ?'}else{ans=a-b;txt=a+'−'+b+' = ?'}var opts=[ans];while(opts.length<4){var w=ans+rnd(11)-5;if(w!==ans&&opts.indexOf(w)<0)opts.push(w)}for(var i=opts.length-1;i>0;i--){var j=rnd(i+1);var t=opts[i];opts[i]=opts[j];opts[j]=t}
var h='';opts.forEach(function(v){h+='<button class="o" onclick="ans(this,'+v+','+ans+')">'+v+'</button>'});document.getElementById('q').textContent=txt;document.getElementById('o').innerHTML=h}
function ans(b,v,right){tot++;if(v===right){rig++;b.classList.add('ok')}else{b.classList.add('no')}document.getElementById('b').textContent='正确率：'+Math.round(rig/tot*100)+'% （'+rig+'/'+tot+'）'}
</script>
</body></html>$h8$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='ai_item_generation'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【AI命题】随机出题自测');

  -- ---------------------------------------------------------------------------
  -- 9) AI组题：智能组卷·混合题练习
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【AI组题】智能组卷练习',
    'AI组题演示：3 题混合卷（常识/化学/数学），交卷即出得分，适合随堂自测。',
    'ai_paper_composition'::public.app_type_enum,
    '综合', '高中', '通用', '约 5 分钟', '中',
    '生成智能组卷混合练习', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-ai-09', null,
    'published', now() - interval '9 hours',
    175, 49, 7,
    c.cost, 0, 0, 0, null
  from (select convert_to($h9$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>智能组卷</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f3f0ff;color:#2d264f;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#6741d9;margin:6px 0 14px}
.box{background:#fff;border-radius:16px;padding:18px;width:330px;box-shadow:0 8px 24px rgba(90,60,180,.15)}
.q{font-size:15px;margin:12px 0 6px}.opts{display:flex;gap:8px;flex-wrap:wrap}
button.o{padding:8px 14px;border:2px solid #d0c4f7;background:#fff;border-radius:10px;font-size:14px;cursor:pointer}
button.o.sel{background:#6741d9;color:#fff;border-color:#6741d9}
button.go{margin-top:12px;width:100%;padding:10px;border:none;border-radius:24px;background:#6741d9;color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.res{margin-top:10px;font-size:15px;font-weight:700}.foot{margin-top:12px;font-size:12px;color:#917bc4}
</style></head><body>
<h2>智能组卷练习</h2><div class="sub">师创 · AI组题演示，3 题混合卷，交卷看得分</div>
<div class="box">
<div class="q">1. 一年有几个月？（ ）</div><div class="opts"><button class="o" onclick="sel(0,this)">10</button><button class="o" onclick="sel(0,this)">12</button><button class="o" onclick="sel(0,this)">11</button></div>
<div class="q">2. 水的化学式是？（ ）</div><div class="opts"><button class="o" onclick="sel(1,this)">CO₂</button><button class="o" onclick="sel(1,this)">H₂O</button><button class="o" onclick="sel(1,this)">O₂</button></div>
<div class="q">3. 8 × 7 = ？（ ）</div><div class="opts"><button class="o" onclick="sel(2,this)">54</button><button class="o" onclick="sel(2,this)">56</button><button class="o" onclick="sel(2,this)">48</button></div>
<button class="go" onclick="grade()">交卷</button><div class="res" id="r"></div>
</div>
<div class="foot">答案：12 / H₂O / 56</div>
<script>
var pick=[null,null,null];
function sel(q,b){var bs=b.parentElement.children;for(var k=0;k<bs.length;k++)bs[k].classList.remove('sel');b.classList.add('sel');pick[q]=b.textContent}
function grade(){if(pick.indexOf(null)>=0){document.getElementById('r').textContent='请答完所有题再交卷';return}var sc=0;if(pick[0]==='12')sc++;if(pick[1]==='H₂O')sc++;if(pick[2]==='56')sc++;document.getElementById('r').textContent='得分：'+sc+' / 3'+(sc===3?' 🎉 全对！':'')}
</script>
</body></html>$h9$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='ai_paper_composition'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【AI组题】智能组卷练习');

  -- ---------------------------------------------------------------------------
  -- 10) AI教案·大单元：大单元教学设计助手
  -- ---------------------------------------------------------------------------
  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, model,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url,
    status, published_at,
    view_count, like_count, remix_count,
    credits_cost, tokens_in, tokens_out, generation_ms, parent_app_id
  )
  select
    v_owner,
    '【AI教案·大单元】大单元设计助手',
    'AI教案·大单元演示：用 5 步法勾选设计环节，实时生成大单元教学框架完成度。',
    'ai_lesson_plan'::public.app_type_enum,
    '综合', '高中', '通用', '约 4 分钟', '中',
    '生成大单元教学设计助手', 'builtin',
    'data:text/html;base64,' || encode(x.raw, 'base64'),
    'ready',
    octet_length(x.raw),
    encode(sha256(x.raw), 'hex'),
    1,
    'auto', 'sc-ai-10', null,
    'published', now() - interval '10 hours',
    119, 30, 4,
    c.cost, 0, 0, 0, null
  from (select convert_to($h10$<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大单元设计</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#e6fcf5;color:#0b3d2e;min-height:100vh;padding:20px;display:flex;flex-direction:column;align-items:center}
h2{font-size:20px}.sub{font-size:13px;color:#0c8599;margin:6px 0 14px}
.box{background:#fff;border-radius:16px;padding:18px;width:330px;box-shadow:0 8px 24px rgba(20,140,110,.15)}
.item{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #e6f4ef;font-size:15px}
.item input{width:18px;height:18px}
.bar{height:10px;background:#e6f4ef;border-radius:6px;margin-top:12px;overflow:hidden}.fill{height:100%;background:#0ca678;width:0;transition:width .3s}
.pct{margin-top:6px;font-size:14px;font-weight:700}.foot{margin-top:12px;font-size:12px;color:#3aa394}
</style></head><body>
<h2>大单元教学设计助手</h2><div class="sub">师创 · AI教案·大单元，勾选环节生成设计进度</div>
<div class="box" id="box">
<div class="item"><input type="checkbox" onchange="tick()"> 确定大主题与素养目标</div>
<div class="item"><input type="checkbox" onchange="tick()"> 拆解子任务与课时</div>
<div class="item"><input type="checkbox" onchange="tick()"> 设计情境与驱动问题</div>
<div class="item"><input type="checkbox" onchange="tick()"> 安排评价与作业</div>
<div class="item"><input type="checkbox" onchange="tick()"> 准备资源与课件</div>
<div class="bar"><div class="fill" id="fill"></div></div><div class="pct" id="pct">完成度：0%</div>
</div>
<div class="foot">5 步法，勾满即完成大单元框架</div>
<script>
function tick(){var all=document.querySelectorAll('.box input');var c=0;for(var k=0;k<all.length;k++)if(all[k].checked)c++;var p=Math.round(c/all.length*100);document.getElementById('fill').style.width=p+'%';document.getElementById('pct').textContent='完成度：'+p+'%'+(p===100?' 🎉 框架完成':'');}
</script>
</body></html>$h10$, 'UTF8') as raw) x
  cross join (select coalesce((select credit_cost from public.app_type_profiles where app_type='ai_lesson_plan'::public.app_type_enum), 1) as cost) c
  where not exists (select 1 from public.apps where title = '【AI教案·大单元】大单元设计助手');

  raise notice '[0037_square_seed] 示例应用种子插入完成（已存在则自动跳过）。';
end $$;
