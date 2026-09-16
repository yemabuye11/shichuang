/**
 * Mock 适配器（**降级兜底，不调用任何真实模型**）。
 *
 * 触发条件：所有供应商的 API Key 都没配置
 * （客户尚未办下 Key、或 Key 临时失效时的最后一道保险）。
 *
 * 行为：按与真实模型一致的 SSE 帧格式，分块吐出一份**完整可运行**的
 * 示例教学应用 HTML，并在控制台打印醒目提示。这样即使没有 Key，
 * 「输入 → 流式生成 → 预览 → 扣积分」全链路依然可跑通。
 */

import type {
  AdapterContext,
  BuiltRequest,
  LlmAdapter,
  LlmRequest,
  ParsedChunk,
  Pricing,
  TokenUsage,
} from './types.ts';

let warned = false;

/** 打印一次醒目提示。 */
function warnOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '════════════════════════════════════════════════════════════\n' +
      '  [MOCK 模式] 未检测到任何大模型 API Key\n' +
      '  生成结果将是本地示例应用，不会调用真实模型、不产生任何费用\n' +
      '  配置方法：supabase secrets set DEEPSEEK_API_KEY=sk-xxxxx\n' +
      '════════════════════════════════════════════════════════════',
  );
}

/** 构造示例教学应用 HTML（真实可运行：闯关答题 + 即时反馈 + 进度 + 总结页）。 */
function buildSampleHtml(goal: string): string {
  const safeGoal = goal.replace(/[<>&"]/g, '').slice(0, 40) || '练一练课内知识';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>课堂闯关小练习</title>
<style>
  :root { --brand:#2F6BFF; --ok:#12A150; --err:#E5484D; --bg:#F7F8FA; --ink:#1B1F27; --sub:#6B7280; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    font-size:16px; line-height:1.7; }
  .wrap { max-width:720px; margin:0 auto; }
  .card { background:#fff; border-radius:16px; padding:20px; box-shadow:0 2px 12px rgba(27,31,39,.06); }
  h1 { font-size:22px; margin:0 0 6px; }
  .goal { color:var(--sub); font-size:15px; margin:0 0 12px; }
  .bar { height:10px; background:#E5E7EB; border-radius:999px; overflow:hidden; margin:14px 0 18px; }
  .bar > i { display:block; height:100%; width:0; background:linear-gradient(90deg,#2F6BFF,#7A5CFF); transition:width .35s; }
  .q { font-size:19px; font-weight:600; margin:0 0 16px; }
  .opts { display:grid; gap:10px; }
  .opt { min-height:52px; border:2px solid #E5E7EB; background:#fff; border-radius:12px; padding:12px 16px;
    font-size:16px; text-align:left; cursor:pointer; }
  .opt.right { border-color:var(--ok); background:rgba(18,161,80,.08); }
  .opt.wrong { border-color:var(--err); background:rgba(229,72,77,.08); }
  .fb { margin-top:16px; border-radius:12px; padding:14px 16px; font-size:15px; display:none; }
  .fb.show { display:block; }
  .fb.ok { background:rgba(18,161,80,.1); color:#0B6B36; }
  .fb.no { background:rgba(229,72,77,.1); color:#A32024; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:18px; }
  button.main { min-height:48px; padding:0 24px; border:0; border-radius:12px; background:var(--brand);
    color:#fff; font-size:16px; font-weight:600; cursor:pointer; }
  .stat { font-size:14px; color:var(--sub); }
  .tip { margin-top:18px; font-size:13px; color:var(--sub); text-align:center; }
  @media print { button { display:none; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>课堂闯关小练习</h1>
    <p class="goal">学习目标：${safeGoal}</p>
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
    <div id="done" style="display:none;text-align:center">
      <p style="margin:0;color:var(--sub)">本次得分</p>
      <p style="font-size:40px;font-weight:700;color:var(--brand);margin:0" id="score">0</p>
      <p id="comment"></p>
      <button class="main" id="again">再来一次</button>
    </div>
  </div>
  <p class="tip">本内容由 AI 生成，请教师审核后使用 · 作答记录只保存在本机</p>
</div>
<script>
  'use strict';
  var QS = [
    { q:'「床前明月光」的下一句是：', o:['疑是地上霜','低头思故乡','举头望明月','霜叶红于二月花'], a:0, e:'出自李白《静夜思》：床前明月光，疑是地上霜。' },
    { q:'「谁知盘中餐，粒粒皆辛苦」的作者是：', o:['李白','李绅','杜甫','白居易'], a:1, e:'出自李绅《悯农》，告诉我们要珍惜粮食。' },
    { q:'「两个黄鹂鸣翠柳」描写的是哪个季节？', o:['春天','夏天','秋天','冬天'], a:0, e:'黄鹂鸣叫、翠柳发芽都是春天的景象。' },
    { q:'「欲穷千里目，更上一层楼」出自：', o:['《登鹳雀楼》','《望庐山瀑布》','《春晓》','《江雪》'], a:0, e:'出自王之涣《登鹳雀楼》。' },
    { q:'「停车坐爱枫林晚」中「坐」的意思是：', o:['坐下','因为','座位','正好'], a:1, e:'古诗里「坐」常作「因为」讲。' }
  ];
  var idx = 0, score = 0, wrong = 0, locked = false;
  function $(id){ return document.getElementById(id); }
  function render(){
    locked = false;
    var q = QS[idx];
    $('qtext').textContent = '第 ' + (idx+1) + ' / ' + QS.length + ' 题：' + q.q;
    $('progress').style.width = (idx / QS.length * 100) + '%';
    var box = $('opts'); box.innerHTML = '';
    q.o.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'opt'; b.type = 'button'; b.textContent = opt;
      b.addEventListener('click', function(){ pick(i, b); });
      box.appendChild(b);
    });
    $('fb').className = 'fb'; $('fb').textContent = '';
    $('next').style.display = 'none';
    $('stat').textContent = '当前得分 ' + score + ' 分';
  }
  function pick(i, btn){
    if (locked) return;
    locked = true;
    var q = QS[idx], ok = i === q.a, fb = $('fb');
    var nodes = $('opts').querySelectorAll('.opt');
    for (var k = 0; k < nodes.length; k++) nodes[k].disabled = true;
    nodes[q.a].className = 'opt right';
    if (!ok) { btn.className = 'opt wrong'; wrong++; } else { score += 20; }
    fb.className = 'fb show ' + (ok ? 'ok' : 'no');
    fb.textContent = (ok ? '答对啦！' : '差一点点，再看看解析～') + ' ' + q.e;
    $('stat').textContent = '当前得分 ' + score + ' 分';
    $('next').style.display = 'inline-block';
    $('next').textContent = idx === QS.length - 1 ? '看看结果' : '下一题';
  }
  function finish(){
    $('progress').style.width = '100%';
    $('play').style.display = 'none';
    $('done').style.display = 'block';
    $('score').textContent = score + ' 分';
    $('comment').textContent = wrong === 0
      ? '全对！这节课的内容你已经完全掌握了。'
      : (score >= 80 ? '很棒！再复习一下错题就更稳了。' : '别灰心，错题可以重做，你已经比刚才进步了。') + '（答错 ' + wrong + ' 题）';
  }
  $('next').addEventListener('click', function(){
    if (idx < QS.length - 1) { idx++; render(); } else { finish(); }
  });
  $('again').addEventListener('click', function(){
    idx = 0; score = 0; wrong = 0;
    $('done').style.display = 'none'; $('play').style.display = 'block'; render();
  });
  render();
</script>
</body>
</html>`;
}

/**
 * Mock 适配器。
 *
 * 不发出任何网络请求：`buildRequest` 返回一个本地标记请求，
 * 由 `generate` 主链路识别后走 `streamMock()` 分块输出。
 */
export class MockAdapter implements LlmAdapter {
  readonly provider = 'mock' as const;

  /** 本次要吐出的完整 HTML（由 generate 主链路设置）。 */
  pendingHtml = '';

  isAvailable(): boolean {
    return true;
  }

  buildRequest(req: LlmRequest, _ctx: AdapterContext): BuiltRequest {
    warnOnce();
    this.pendingHtml = buildSampleHtml(req.userPrompt);
    return {
      url: 'mock://local/generate',
      headers: { 'Content-Type': 'application/json' },
      body: { mock: true, length: this.pendingHtml.length },
    };
  }

  parseChunk(raw: string): ParsedChunk | null {
    // Mock 不解析远程 SSE，仅保留接口一致性
    try {
      const json = JSON.parse(raw) as { text?: string; finish?: boolean };
      if (json.finish) return { finish: true };
      return json.text ? { text: json.text } : null;
    } catch {
      return null;
    }
  }

  computeCost(_usage: TokenUsage, _pricing: Pricing, _at: Date): number {
    // 本地示例不产生任何成本
    return 0;
  }
}

export const mockAdapter = new MockAdapter();

/** 供主链路直接调用：分块产出 Mock 输出。 */
export function buildMockHtml(goal: string): string {
  warnOnce();
  return buildSampleHtml(goal);
}

/**
 * Mock 文档产物：构造一份合法可解析的 DocModel JSON（降级兜底，不调用真实模型）。
 *
 * @param docType 文档类型。
 * @param prompt 教师需求。
 * @returns 合法 DocModel 的 JSON 字符串。
 */
export function buildMockDoc(docType: string, prompt: string): string {
  warnOnce();
  const safeTopic = (prompt || '示例教学内容').slice(0, 40);
  const baseId = crypto.randomUUID();
  const blocks = [
    { id: 'b1', type: 'heading', level: 1, text: `${safeTopic}（教案示例）` },
    { id: 'b2', type: 'paragraph', text: '本示例由本地 Mock 生成，未调用真实模型、不产生任何费用。' },
    { id: 'b3', type: 'heading', level: 2, text: '一、教学目标' },
    { id: 'b4', type: 'list', ordered: false, items: ['知识与技能：理解本节核心概念', '过程与方法：通过实例归纳规律', '情感态度价值观：体会学科价值'] },
    { id: 'b5', type: 'heading', level: 2, text: '二、教学重难点' },
    { id: 'b6', type: 'list', ordered: false, items: ['重点：核心概念的应用', '难点：抽象规律的建立'] },
    { id: 'b7', type: 'callout', text: '提示：请教师结合实际学情调整例题与活动。' },
  ];
  const model: Record<string, unknown> = {
    id: baseId,
    kind: docType,
    meta: { title: `${safeTopic}（示例）`, subject: '未填写', grade: '未填写', textbook: '通用', difficulty: '中等' },
    blocks,
    version: 1,
    createdAt: new Date().toISOString(),
    verifyHints: ['示例内容，请教师核对并替换为真实教材内容'],
  };
  if (docType === 'ppt') {
    const points = [[-2, 5], [-1, 0], [0, -3], [1, -4], [2, -3], [3, 0], [4, 5]];
    const titles = [
      '封面',
      '学习目标',
      '情境导入',
      '概念与表示',
      '图像特征探究',
      '例题一：求关键点',
      '例题二：判断变化',
      '课堂活动：读图交流',
      '易错点辨析',
      '分层练习',
      '本节小结',
      '课后作业',
    ];
    const charts = new Set([2, 4, 5, 6, 7, 9]);
    model.slides = titles.map((title, index) => {
      const body = [
        {
          id: `s${index}-p`,
          type: 'paragraph',
          text:
            index === 0
              ? `${safeTopic}：一节课的核心概念、例题和练习。`
              : `本页围绕“${title}”展开，先观察具体信息，再用一句完整的话说出你的判断依据，最后把结论写进笔记。`,
        },
        {
          id: `s${index}-l`,
          type: 'list',
          ordered: false,
          items:
            index === 0
              ? ['适用年级：中学', '建议课时：45分钟']
              : ['教师提问：你从数据或图形中发现了什么？', '学生表达：给出结论并说明理由。'],
        },
      ];
      if (charts.has(index)) {
        body.push({
          id: `s${index}-c`,
          type: 'chart',
          chart: {
            kind: index === 7 ? 'bar' : 'function',
            expression: 'y = x^2 - 2x - 3',
            xLabel: 'x',
            yLabel: 'y',
            points,
            categories: ['A', 'B', 'C', 'D'],
            values: [3, 6, 4, 8],
          },
          caption: '图示关键数据关系，帮助学生从变化趋势、顶点和交点三个角度核对结论。',
        });
      }
      if (index === 8) {
        body.push({
          id: `s${index}-t`,
          type: 'table',
          header: ['判断对象', '常见错误', '核对方法'],
          rows: [['顶点', '把横纵坐标写反', '先看横坐标再看纵坐标'], ['交点', '漏写坐标轴', '代入原式验算']],
        });
      }
      return {
        index,
        title,
        body,
        notes: `讲到“${title}”时先停顿并邀请学生观察，再追问“你的依据是什么”。根据学生回答补充一步演算，最后用一句话收束本页结论。`,
        layout: index === 0 ? 'title' : index === 10 ? 'section' : index === 3 || index === 8 ? 'two_col' : 'content',
      };
    });
  }
  if (docType === 'courseware_3d') {
    model.scene = {
      type: 'geometry',
      params: { shape: 'cube', size: 1 },
      explodable: true,
      annotations: ['正方体六个面', '顶点与棱长'],
      title: '几何体演示',
    };
  }
  return JSON.stringify(model, null, 2);
}
