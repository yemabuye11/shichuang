/**
 * MOCK 模式用的示例教学应用 HTML。
 *
 * 目标（客户要求）：在没有大模型 API Key 的情况下，`npm run dev` 也能完整跑通
 * 「输入 → 流式生成 → 预览 → 扣积分」全链路。因此这些示例必须是**真实可运行**的
 * 单文件应用，而不是占位文本。
 *
 * 设计上严格遵守系统提示词的全部硬约束：
 * - 单文件、全内联、零外部资源引用；
 * - 有学习目标、即时反馈（判分 + 解析）、进度与成就、防挫败；
 * - 移动端友好（≥16px 正文、≥44px 触控区）；
 * - 不收集个人信息、不发外部请求。
 *
 * 提供 5 种形态，按应用类型路由，保证演示时「不同需求 → 不同样子」：
 * `quiz`（闯关答题）/ `flashcard`（翻转卡片）/ `picker`（随机点名）/
 * `worksheet`（可打印练习）/ `animation`（分步动画演示）。
 */

/** 示例应用的形态。 */
export type SampleAppKind = 'quiz' | 'flashcard' | 'picker' | 'worksheet' | 'animation';

export interface SampleAppOptions {
  /** 应用标题。 */
  title: string;
  /** 一句话学习目标。 */
  goal: string;
  /** 学科（用于文案微调）。 */
  subject: string;
  /** 年级。 */
  grade: string;
  /** 形态；缺省 `quiz`。 */
  kind?: SampleAppKind;
}

/** 题干数据结构（与生成出的应用内 JS 保持一致）。 */
interface Question {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

/** 内置题库：小学/初中通用古诗词与常识闯关。 */
const QUESTIONS: readonly Question[] = [
  {
    q: '「床前明月光」的下一句是：',
    options: ['疑是地上霜', '低头思故乡', '举头望明月', '霜叶红于二月花'],
    answer: 0,
    explain: '出自李白《静夜思》：床前明月光，疑是地上霜。举头望明月，低头思故乡。',
  },
  {
    q: '「谁知盘中餐，粒粒皆辛苦」的作者是：',
    options: ['李白', '李绅', '杜甫', '白居易'],
    answer: 1,
    explain: '出自唐代诗人李绅的《悯农》，这首诗告诉我们要珍惜粮食。',
  },
  {
    q: '「两个黄鹂鸣翠柳」描写的是哪个季节？',
    options: ['春天', '夏天', '秋天', '冬天'],
    answer: 0,
    explain: '黄鹂鸣叫、翠柳发芽都是春天的景象，出自杜甫《绝句》。',
  },
  {
    q: '「欲穷千里目，更上一层楼」出自：',
    options: ['《登鹳雀楼》', '《望庐山瀑布》', '《春晓》', '《江雪》'],
    answer: 0,
    explain: '出自王之涣《登鹳雀楼》，常用来鼓励人不断进取、看得更远。',
  },
  {
    q: '「停车坐爱枫林晚」中「坐」的意思是：',
    options: ['坐下', '因为', '座位', '正好'],
    answer: 1,
    explain: '古诗里的「坐」常作「因为」讲，全句意思是：停下车来，是因为喜爱这傍晚的枫林。',
  },
];

/** 单词卡数据。 */
const CARDS: readonly { w: string; m: string }[] = [
  { w: 'ancient', m: '古代的；古老的' },
  { w: 'brave', m: '勇敢的' },
  { w: 'collect', m: '收集，采集' },
  { w: 'discover', m: '发现' },
  { w: 'energy', m: '能量；活力' },
  { w: 'famous', m: '著名的' },
  { w: 'gentle', m: '温和的' },
  { w: 'honest', m: '诚实的' },
];

/** 动画演示的分步脚本。 */
const STEPS: readonly { t: string; d: string }[] = [
  { t: '第 1 步：提出问题', d: '直角三角形三条边之间，是不是藏着一个固定的关系？' },
  { t: '第 2 步：动手拼一拼', d: '用四个完全一样的直角三角形，拼成一个大正方形。' },
  { t: '第 3 步：观察面积', d: '大正方形面积 = 小正方形面积 + 4 个三角形面积。' },
  { t: '第 4 步：写出等式', d: 'c² = a² + b²，这就是勾股定理。' },
  { t: '第 5 步：用一用', d: '已知 a = 3，b = 4，那么 c = 5。' },
];

/** 可打印练习的分板块内容。 */
const SECTIONS: readonly { t: string; items: readonly { q: string; a: string }[] }[] = [
  {
    t: '一、基础积累',
    items: [
      { q: '默写《春晓》的前两句。', a: '春眠不觉晓，处处闻啼鸟。' },
      { q: '「精益求精」的近义词是：______', a: '锦上添花 / 一丝不苟（答出一个即可）' },
      { q: '给「氛」字注音并组词。', a: 'fēn；气氛、氛围' },
    ],
  },
  {
    t: '二、阅读理解',
    items: [
      { q: '文段中「他愣了一下」表现了人物怎样的心理？', a: '表现出意外、迟疑，为后文的转变作铺垫。' },
      { q: '概括本文的主要内容（不超过 30 字）。', a: '示例：记叙了主人公在一次失败后重新振作并取得成功的事。' },
    ],
  },
  {
    t: '三、写作表达',
    items: [
      { q: '以「那一次，我长大了」为题，列出三点提纲。', a: '① 事件的起因 ② 过程中的心理变化 ③ 收获与成长' },
    ],
  },
];

/** 全站公共样式（保证 5 种形态视觉一致、移动端友好）。 */
const BASE_CSS = `
  :root { --brand:#2F6BFF; --ok:#12A150; --err:#E5484D; --bg:#F7F8FA; --card:#FFFFFF; --ink:#1B1F27; --sub:#6B7280; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    font-size:16px; line-height:1.7; }
  .wrap { max-width:720px; margin:0 auto; }
  .card { background:var(--card); border-radius:16px; padding:20px; box-shadow:0 2px 12px rgba(27,31,39,.06); }
  h1 { font-size:22px; margin:0 0 6px; }
  .goal { color:var(--sub); font-size:15px; margin:0 0 12px; }
  .meta { display:inline-block; font-size:13px; color:var(--brand); background:rgba(47,107,255,.08);
    border-radius:999px; padding:4px 12px; margin-bottom:14px; }
  .bar { height:10px; background:#E5E7EB; border-radius:999px; overflow:hidden; margin:14px 0 18px; }
  .bar > i { display:block; height:100%; width:0; background:linear-gradient(90deg,#2F6BFF,#7A5CFF); transition:width .35s; }
  button.main { min-height:48px; padding:0 24px; border:0; border-radius:12px; background:var(--brand);
    color:#fff; font-size:16px; font-weight:600; cursor:pointer; }
  button.ghost { min-height:44px; padding:0 18px; border:2px solid #E5E7EB; border-radius:12px; background:#fff;
    color:var(--ink); font-size:15px; font-weight:600; cursor:pointer; }
  button.main:active { background:#1F52DB; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:18px; flex-wrap:wrap; }
  .stat { font-size:14px; color:var(--sub); }
  .tip { margin-top:18px; font-size:13px; color:var(--sub); text-align:center; }
  .hidden { display:none !important; }
  @media print { button { display:none; } body { background:#fff; } .card { box-shadow:none; } }
`;

/** 把公共外壳与某个形态的片段拼成完整 HTML。 */
function shell(
  opts: SampleAppOptions,
  css: string,
  body: string,
  js: string,
): string {
  const title = escapeHtml(opts.title || '课堂小应用');
  const goal = escapeHtml(opts.goal || '练一练课内知识，看看你能闯到第几关');
  const subject = escapeHtml(opts.subject || '语文');
  const grade = escapeHtml(opts.grade || '六年级');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}${css}</style>
</head>
<body>
<div class="wrap">
  <div class="card" id="stage">
    <span class="meta">${subject} · ${grade}</span>
    <h1>${title}</h1>
    <p class="goal">学习目标：${goal}</p>
    ${body}
  </div>
  <p class="tip">本内容由 AI 生成，请教师审核后使用 · 作答记录只保存在本机</p>
</div>
<script>
'use strict';
var $ = function (id) { return document.getElementById(id); };
${js}
</script>
</body>
</html>`;
}

/**
 * 生成示例教学应用的完整 HTML。
 *
 * @param opts 标题 / 学习目标 / 学科 / 年级 / 形态。
 * @returns 可直接运行的单文件 HTML 字符串。
 */
export function buildSampleAppHtml(opts: SampleAppOptions): string {
  switch (opts.kind ?? 'quiz') {
    case 'flashcard':
      return buildFlashcard(opts);
    case 'picker':
      return buildPicker(opts);
    case 'worksheet':
      return buildWorksheet(opts);
    case 'animation':
      return buildAnimation(opts);
    case 'quiz':
    default:
      return buildQuiz(opts);
  }
}

/**
 * 按应用类型推荐一种形态（用于演示数据播种）。
 *
 * @param appType 应用类型枚举值。
 */
export function kindForAppType(appType: string): SampleAppKind {
  switch (appType) {
    case 'teaching_animation':
      return 'animation';
    case 'ai_item_generation':
    case 'ai_paper_composition':
    case 'ai_lesson_plan':
      return 'worksheet';
    case 'edu_tool':
      return 'picker';
    case 'teaching_game':
      return 'quiz';
    case 'interactive_courseware':
    case 'data_collection':
    case 'auto':
    default:
      return 'flashcard';
  }
}

// ---------------------------------------------------------------------------
// 形态 1：闯关答题
// ---------------------------------------------------------------------------

function buildQuiz(opts: SampleAppOptions): string {
  const css = `
  .q { font-size:19px; font-weight:600; margin:0 0 16px; }
  .opts { display:grid; gap:10px; }
  .opt { min-height:52px; border:2px solid #E5E7EB; background:#fff; border-radius:12px; padding:12px 16px;
    font-size:16px; text-align:left; cursor:pointer; transition:.15s; }
  .opt:hover { border-color:#B9CDFF; }
  .opt.right { border-color:var(--ok); background:rgba(18,161,80,.08); }
  .opt.wrong { border-color:var(--err); background:rgba(229,72,77,.08); }
  .opt:disabled { cursor:default; }
  .fb { margin-top:16px; border-radius:12px; padding:14px 16px; font-size:15px; display:none; }
  .fb.show { display:block; }
  .fb.ok { background:rgba(18,161,80,.1); color:#0B6B36; }
  .fb.no { background:rgba(229,72,77,.1); color:#A32024; }
  .result { text-align:center; padding:10px 0; }
  .result .big { font-size:40px; font-weight:700; color:var(--brand); }
`;
  const body = `
    <div class="bar"><i id="progress"></i></div>
    <div id="play">
      <p class="q" id="qtext"></p>
      <div class="opts" id="opts"></div>
      <div class="fb" id="fb"></div>
      <div class="row">
        <span class="stat" id="stat"></span>
        <button class="main" id="next" style="display:none">下一题</button>
      </div>
    </div>
    <div class="result hidden" id="done">
      <p style="margin:0;color:var(--sub)">本次得分</p>
      <p class="big" id="score">0</p>
      <p id="comment"></p>
      <button class="main" id="again">再来一次</button>
    </div>
`;
  const js = `
var QUESTIONS = ${JSON.stringify(QUESTIONS)};
var idx = 0, score = 0, wrong = 0, locked = false;
function render() {
  locked = false;
  var q = QUESTIONS[idx];
  $('qtext').textContent = '第 ' + (idx + 1) + ' / ' + QUESTIONS.length + ' 题：' + q.q;
  $('progress').style.width = ((idx / QUESTIONS.length) * 100) + '%';
  var box = $('opts'); box.innerHTML = '';
  q.options.forEach(function (opt, i) {
    var b = document.createElement('button');
    b.className = 'opt'; b.type = 'button'; b.textContent = opt;
    b.addEventListener('click', function () { pick(i, b); });
    box.appendChild(b);
  });
  $('fb').className = 'fb'; $('fb').textContent = '';
  $('next').style.display = 'none';
  $('stat').textContent = '当前得分 ' + score + ' 分';
}
function pick(i, btn) {
  if (locked) { return; }
  locked = true;
  var q = QUESTIONS[idx], ok = i === q.answer, fb = $('fb');
  var nodes = $('opts').querySelectorAll('.opt');
  for (var k = 0; k < nodes.length; k++) { nodes[k].disabled = true; }
  nodes[q.answer].className = 'opt right';
  if (!ok) { btn.className = 'opt wrong'; wrong++; } else { score += 20; }
  fb.className = 'fb show ' + (ok ? 'ok' : 'no');
  fb.textContent = (ok ? '答对啦！' : '差一点点，再看看解析～') + ' ' + q.explain;
  $('stat').textContent = '当前得分 ' + score + ' 分';
  $('next').style.display = 'inline-block';
  $('next').textContent = idx === QUESTIONS.length - 1 ? '看看结果' : '下一题';
}
function finish() {
  $('progress').style.width = '100%';
  $('play').className = 'hidden';
  $('done').className = 'result';
  $('score').textContent = score + ' 分';
  var c = wrong === 0 ? '全对！这节课的内容你已经完全掌握了。'
    : (score >= 80 ? '很棒！再复习一下错题就更稳了。' : '别灰心，错题可以重做，你已经比刚才进步了。');
  $('comment').textContent = c + '（答错 ' + wrong + ' 题）';
}
$('next').addEventListener('click', function () {
  if (idx < QUESTIONS.length - 1) { idx++; render(); } else { finish(); }
});
$('again').addEventListener('click', function () {
  idx = 0; score = 0; wrong = 0;
  $('done').className = 'result hidden'; $('play').className = '';
  render();
});
render();
`;
  return shell(opts, css, body, js);
}

// ---------------------------------------------------------------------------
// 形态 2：翻转单词卡
// ---------------------------------------------------------------------------

function buildFlashcard(opts: SampleAppOptions): string {
  const css = `
  .fc { min-height:200px; border-radius:16px; background:linear-gradient(135deg,#2F6BFF,#7A5CFF); color:#fff;
    display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
    padding:24px; cursor:pointer; user-select:none; box-shadow:0 8px 24px rgba(47,107,255,.18); }
  .fc .w { font-size:34px; font-weight:700; }
  .fc .m { font-size:20px; margin-top:10px; opacity:.95; }
  .fc .hint { font-size:13px; margin-top:16px; opacity:.8; }
  .btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:18px; }
  .done-list { margin-top:16px; font-size:14px; color:var(--sub); word-break:break-all; }
`;
  const body = `
    <div class="bar"><i id="progress"></i></div>
    <div class="fc" id="card" role="button" tabindex="0" aria-label="翻转卡片">
      <div class="w" id="word">—</div>
      <div class="m" id="mean" style="display:none">—</div>
      <div class="hint" id="hint">点一下看释义</div>
    </div>
    <div class="btns">
      <button class="ghost" id="know">认识，下一个</button>
      <button class="ghost" id="unknow">不认识，再来</button>
    </div>
    <div class="row">
      <span class="stat" id="stat"></span>
      <button class="ghost" id="shuffle">打乱顺序</button>
    </div>
    <div class="done-list" id="doneList"></div>
`;
  const js = `
var CARDS = ${JSON.stringify(CARDS)};
var order = CARDS.map(function (_, i) { return i; });
var pos = 0, flipped = false, known = 0, reviewed = 0;
var doneIdx = [];
function shuffle() {
  for (var i = order.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = order[i]; order[i] = order[j]; order[j] = t;
  }
  pos = 0;
}
function paint() {
  flipped = false;
  var c = CARDS[order[pos]];
  $('word').textContent = c.w;
  $('mean').textContent = c.m;
  $('mean').style.display = 'none';
  $('hint').textContent = '点一下看释义';
  $('progress').style.width = ((pos / CARDS.length) * 100) + '%';
  $('stat').textContent = '第 ' + (pos + 1) + ' / ' + CARDS.length + ' 张 · 已掌握 ' + known + ' 张';
}
function flip() {
  flipped = !flipped;
  $('mean').style.display = flipped ? 'block' : 'none';
  $('hint').textContent = flipped ? '再点一下收起' : '点一下看释义';
}
function advance(ok) {
  reviewed++;
  if (ok) { known++; doneIdx.push(CARDS[order[pos]].w); }
  if (pos < CARDS.length - 1) { pos++; paint(); }
  else {
    $('progress').style.width = '100%';
    $('card').innerHTML = '<div class="w">完成啦</div><div class="m" style="display:block">' +
      '本次正确率 ' + Math.round((known / reviewed) * 100) + '%</div>';
    $('stat').textContent = '共复习 ' + reviewed + ' 张，掌握 ' + known + ' 张';
  }
  $('doneList').textContent = doneIdx.length ? '已掌握：' + doneIdx.join('、') : '';
}
$('card').addEventListener('click', flip);
$('card').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { flip(); } });
$('know').addEventListener('click', function () { advance(true); });
$('unknow').addEventListener('click', function () { advance(false); });
$('shuffle').addEventListener('click', function () { shuffle(); paint(); });
paint();
`;
  return shell(opts, css, body, js);
}

// ---------------------------------------------------------------------------
// 形态 3：随机点名器
// ---------------------------------------------------------------------------

function buildPicker(opts: SampleAppOptions): string {
  const css = `
  textarea { width:100%; min-height:110px; border:2px solid #E5E7EB; border-radius:12px; padding:12px 14px;
    font-size:16px; line-height:1.6; font-family:inherit; resize:vertical; }
  .pick { min-height:140px; border-radius:16px; background:linear-gradient(135deg,#2F6BFF,#7A5CFF); color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:40px; font-weight:800; margin:16px 0; }
  .pick.small { font-size:26px; line-height:1.5; padding:0 16px; text-align:center; }
  .btns { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .opts-row { display:flex; align-items:center; gap:8px; margin-top:14px; font-size:15px; }
  .opts-row input { width:20px; height:20px; }
  .log { margin-top:14px; font-size:14px; color:var(--sub); }
`;
  const body = `
    <textarea id="names" aria-label="名单">张明 李华 王芳 刘洋 陈静 赵磊 孙悦 周涛 吴敏 郑凯</textarea>
    <div class="opts-row">
      <input type="checkbox" id="unique" checked><label for="unique">不重复抽取</label>
    </div>
    <div class="pick" id="pick">准备就绪</div>
    <div class="btns">
      <button class="main" id="one">抽 1 人</button>
      <button class="ghost" id="three">抽 3 人</button>
    </div>
    <div class="row">
      <span class="stat" id="stat">共 0 人</span>
      <button class="ghost" id="reset">重置名单</button>
    </div>
    <div class="log" id="log"></div>
`;
  const js = `
var pool = [], used = [], log = [];
function readNames() {
  var raw = $('names').value || '';
  pool = raw.split(/[\\s,，、;；\\n]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  $('stat').textContent = '共 ' + pool.length + ' 人';
}
function draw(n) {
  readNames();
  if (pool.length === 0) { $('pick').textContent = '请先录入名单'; return; }
  var remain = pool.filter(function (x) { return used.indexOf(x) < 0; });
  if ($('unique').checked && remain.length === 0) { $('pick').textContent = '全部抽完啦'; return; }
  var src = $('unique').checked ? remain : pool;
  var picked = [];
  var copy = src.slice();
  for (var i = 0; i < n && copy.length > 0; i++) {
    var k = Math.floor(Math.random() * copy.length);
    picked.push(copy[k]);
    copy.splice(k, 1);
  }
  if ($('unique').checked) { picked.forEach(function (p) { if (used.indexOf(p) < 0) { used.push(p); } }); }
  $('pick').textContent = picked.join('、');
  $('pick').className = picked.length > 2 ? 'pick small' : 'pick';
  log.unshift(picked.join('、'));
  $('log').textContent = '已抽过：' + log.slice(0, 10).join(' | ');
}
$('one').addEventListener('click', function () { draw(1); });
$('three').addEventListener('click', function () { draw(3); });
$('reset').addEventListener('click', function () { used = []; log = []; $('pick').textContent = '准备就绪'; $('log').textContent = ''; readNames(); });
$('names').addEventListener('input', readNames);
readNames();
`;
  return shell(opts, css, body, js);
}

// ---------------------------------------------------------------------------
// 形态 4：可打印练习 / 教案
// ---------------------------------------------------------------------------

function buildWorksheet(opts: SampleAppOptions): string {
  const css = `
  h2 { font-size:18px; margin:22px 0 10px; }
  ol { margin:0; padding-left:22px; }
  li { margin-bottom:14px; }
  .ans { display:none; margin-top:6px; padding:10px 12px; border-radius:10px; font-size:14px;
    background:rgba(18,161,80,.08); color:#0B6B36; }
  .ans.show { display:block; }
  .paper { background:#fff; }
  @media print { .card { padding:0; } }
`;
  const sectionsHtml = SECTIONS.map(
    (s, si) =>
      `<h2>${escapeHtml(s.t)}</h2><ol>${s.items
        .map(
          (it, ii) =>
            `<li>${escapeHtml(it.q)}<div class="ans" id="a${si}-${ii}">参考答案：${escapeHtml(it.a)}</div></li>`,
        )
        .join('')}</ol>`,
  ).join('');

  const body = `
    <div class="paper">${sectionsHtml}</div>
    <div class="row">
      <span class="stat" id="stat">共 ${SECTIONS.reduce((n, s) => n + s.items.length, 0)} 题</span>
      <span>
        <button class="ghost" id="toggle">显示答案</button>
        <button class="main" id="print">打印 / 存为 PDF</button>
      </span>
    </div>
`;
  const js = `
var shown = false;
$('toggle').addEventListener('click', function () {
  shown = !shown;
  var nodes = document.querySelectorAll('.ans');
  for (var i = 0; i < nodes.length; i++) { nodes[i].className = shown ? 'ans show' : 'ans'; }
  $('toggle').textContent = shown ? '隐藏答案' : '显示答案';
});
$('print').addEventListener('click', function () { window.print(); });
`;
  return shell(opts, css, body, js);
}

// ---------------------------------------------------------------------------
// 形态 5：分步动画演示
// ---------------------------------------------------------------------------

function buildAnimation(opts: SampleAppOptions): string {
  const css = `
  .scene { min-height:180px; border-radius:16px; background:linear-gradient(135deg,#0EA5A5,#2F6BFF); color:#fff;
    display:flex; flex-direction:column; justify-content:center; padding:24px; }
  .scene .t { font-size:22px; font-weight:700; }
  .scene .d { font-size:17px; margin-top:10px; line-height:1.7; }
  .btns { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin-top:18px; }
  .dots { display:flex; gap:8px; margin-top:14px; }
  .dots i { width:10px; height:10px; border-radius:999px; background:#E5E7EB; }
  .dots i.on { background:var(--brand); }
`;
  const body = `
    <div class="bar"><i id="progress"></i></div>
    <div class="scene" id="scene">
      <div class="t" id="stitle">—</div>
      <div class="d" id="sdesc">—</div>
    </div>
    <div class="dots" id="dots"></div>
    <div class="btns">
      <button class="ghost" id="prev">上一步</button>
      <button class="main" id="play">自动播放</button>
      <button class="ghost" id="next">下一步</button>
    </div>
    <div class="row">
      <span class="stat" id="stat"></span>
      <button class="ghost" id="replay">重播</button>
    </div>
`;
  const js = `
var STEPS = ${JSON.stringify(STEPS)};
var i = 0, timer = null;
function paint() {
  var s = STEPS[i];
  $('stitle').textContent = s.t;
  $('sdesc').textContent = s.d;
  $('progress').style.width = ((i / STEPS.length) * 100) + '%';
  $('stat').textContent = '第 ' + (i + 1) + ' / ' + STEPS.length + ' 步';
  var dots = $('dots'); dots.innerHTML = '';
  for (var k = 0; k < STEPS.length; k++) {
    var e = document.createElement('i');
    if (k === i) { e.className = 'on'; }
    dots.appendChild(e);
  }
}
function step(d) {
  i = (i + d + STEPS.length) % STEPS.length;
  paint();
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  $('play').textContent = '自动播放';
}
$('next').addEventListener('click', function () { stop(); step(1); });
$('prev').addEventListener('click', function () { stop(); step(-1); });
$('replay').addEventListener('click', function () { stop(); i = 0; paint(); });
$('play').addEventListener('click', function () {
  if (timer) { stop(); return; }
  $('play').textContent = '暂停';
  timer = setInterval(function () {
    if (i >= STEPS.length - 1) { stop(); return; }
    step(1);
  }, 2600);
});
paint();
`;
  return shell(opts, css, body, js);
}

/**
 * 极简 HTML 转义（仅用于把用户输入拼进示例 HTML 的文本节点）。
 *
 * @param s 原始字符串。
 */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
