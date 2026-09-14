// 公开课资源索引（仅作索引，不转载原文；导语为 AI 整理，非官方原文）
// 字段说明：
//   type: 'video' | 'doc' | 'courseware'
//   tag:  '省级获奖' | '市级获奖' | '示范课' | '常规优质' | 'AI示范'
//   urlUnverified: true 表示该深层链接由检索得到、建议上线前人工点开二次确认

export interface OpenCourseResource {
  title: string;
  subject: '数学' | '语文' | '英语' | '物理' | '化学';
  grade: string;
  type: 'video' | 'doc' | 'courseware';
  url: string;
  source: string;
  tag: '省级获奖' | '市级获奖' | '示范课' | '常规优质' | 'AI示范';
  note: string; // 一句导语，标注"AI整理"
  urlUnverified?: boolean;
}

export const openCourseResources: OpenCourseResource[] = [
  { title: '《解一元二次方程》【省赛获奖课】人教数学九上', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.bilibili.com/video/BV1gxxPzGEu8/', source: 'B站-新课标中学公开课', tag: '省级获奖', note: 'AI整理：省赛获奖的完整课堂实录，含课件教案，适合青年教师模仿优质课的引入与板书设计。', urlUnverified: true },
  { title: '九上《21.1 一元二次方程》【邓老师】【国家级】优质课', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.bilibili.com/video/BV1JbvFe2EfJ/', source: 'B站-优质课分享', tag: '示范课', note: 'AI整理：国家级标杆课例，概念课结构清晰，适合作为"一元二次方程起始课"的备课参考。', urlUnverified: true },
  { title: '数学·一元二次方程全章（雷文虹老师课程包）', subject: '数学', grade: '九年级', type: 'courseware', url: 'https://basic.smartedu.cn/lecturer?lecturerId=cb07b73e-78ca-44ba-98e0-d9508537dbc6&resourceType=national_lesson', source: '国家中小学智慧教育平台', tag: '常规优质', note: 'AI整理：平台名师课程包，覆盖21.1~21.3全章，适合学生自主学习与教师备课引用。', urlUnverified: true },
  { title: '人教版九上《二次函数》全章系统课', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.bilibili.com/video/BV1EPdSYSEmR/', source: 'B站-数学系统课UP主', tag: '常规优质', note: 'AI整理：按教材课时切分的系列微课，适合基础薄弱班级课前预习或课后补学。', urlUnverified: true },
  { title: '《二次函数》第十四届数学青年教师素养大赛/说播课', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.sp910.com/shipin/shuxue/9nj/', source: '教视网（公开课专辑）', tag: '省级获奖', note: 'AI整理：收录多节二次函数赛课/说播课，适合研究"章起始课"与数形结合的教学设计。', urlUnverified: true },
  { title: '《相似三角形》判定与应用教学视频专辑', subject: '数学', grade: '九年级', type: 'video', url: 'https://m.sp910.com/biaoqian/xiangsisanjiaoxing.html', source: '教视网（公开课专辑）', tag: '示范课', note: 'AI整理：汇集判定定理、周长面积比、利用相似测高等课例，适合按课题集中观摩。', urlUnverified: true },
  { title: '中考数学《与圆有关的计算问题·圆的切线》复习课', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.bilibili.com/video/BV1NB4y1Y71w/', source: 'B站-同上一堂课', tag: '常规优质', note: 'AI整理：以垂径定理、相似、切线证明为主线的中考复习专题，适合二轮专题备课。', urlUnverified: true },
  { title: '《圆》北京版/浙教版九年级上册优质课专辑', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.renjiaoshe.com/jiaocai/604_shipin.html', source: '教师之家（优质课视频）', tag: '常规优质', note: 'AI整理：覆盖圆的有关概念、对称性、圆周角、直线和圆的位置关系等，多版本可对照。', urlUnverified: true },
  { title: '《锐角三角函数》教学视频专辑', subject: '数学', grade: '九年级', type: 'video', url: 'https://m.sp910.com/biaoqian/sanjiaohanshu.html', source: '教视网（公开课专辑）', tag: '省级获奖', note: 'AI整理：含多节省/市级一等奖课例，适合突破"三角函数实际应用题"的教学难点。', urlUnverified: true },
  { title: '《概率初步》人教版九年级上册优质课专辑', subject: '数学', grade: '九年级', type: 'video', url: 'https://www.sp910.com/biaoqian/gailvchubu.html', source: '教视网（公开课专辑）', tag: '常规优质', note: 'AI整理：覆盖用频率估计概率、列举法求概率等，适合概念教学与中考概率题备课。', urlUnverified: true },
  { title: '《海燕》（高尔基）九年级语文下册·统编版精品课', subject: '语文', grade: '九年级', type: 'courseware', url: 'https://www.zxx.edu.cn/syncClassroom', source: '国家中小学智慧教育平台', tag: '常规优质', note: 'AI整理：平台部级精品课，含朗读与象征手法解析，适合散文诗意象教学参考。' },
  { title: '《沁园春·雪》的意象与情感', subject: '语文', grade: '九年级', type: 'video', url: 'https://www.zxx.edu.cn/syncClassroom', source: '国家中小学智慧教育平台', tag: '常规优质', note: 'AI整理：聚焦意象选择与情感表达，适合现代诗歌单元整体教学的切入示范。' },
  { title: '《乡愁》中情感的表达', subject: '语文', grade: '九年级', type: 'video', url: 'https://www.zxx.edu.cn/syncClassroom', source: '国家中小学智慧教育平台', tag: '常规优质', note: 'AI整理：以情感表达为主线，适合乡愁类诗歌朗读与赏析课的设计借鉴。' },
  { title: 'Unit 7 Teenagers should be allowed to choose their own clothes（一等奖）', subject: '英语', grade: '九年级', type: 'video', url: 'https://www.sp910.com/shipin/yingyu/9nj/', source: '教视网（优质课专辑）', tag: '省级获奖', note: 'AI整理：重庆市初中英语优质课竞赛一等奖，听说+阅读整合设计，适合被动语态话题备课。', urlUnverified: true },
  { title: 'Unit 6 When was it invented?（一等奖课例）', subject: '英语', grade: '九年级', type: 'video', url: 'https://www.sp910.com/shipin/yingyu/9nj/', source: '教视网（优质课专辑）', tag: '省级获奖', note: 'AI整理：一般过去时被动语态阅读课，适合科技创新类阅读文本的教学设计参考。', urlUnverified: true },
  { title: 'Unit 3 Could you please tell me where the restrooms are?（含课件+教案）', subject: '英语', grade: '九年级', type: 'courseware', url: 'https://www.tingkez.com/yingyu/jnyyy/', source: '听课站（含课件教案）', tag: '常规优质', note: 'AI整理：宾语从句与礼貌请求听说课，附带PPT与教案，适合直接取用备课素材。', urlUnverified: true },
  { title: '《变阻器》人教版九年级物理优质课专辑', subject: '物理', grade: '九年级', type: 'video', url: 'https://m.sp910.com/biaoqian/bianzuqi.html', source: '教视网（公开课专辑）', tag: '省级获奖', note: 'AI整理：含全国青年教师赛课与省级获奖课例，适合电学实验探究课的设计借鉴。', urlUnverified: true },
  { title: '《欧姆定律》人教版九年级物理教学视频专辑', subject: '物理', grade: '九年级', type: 'video', url: 'https://www.sp910.com/biaoqian/oumudinglv.html', source: '教视网（公开课专辑）', tag: '常规优质', note: 'AI整理：覆盖欧姆定律及其串并联应用，适合规律探究与专题复习课备课。', urlUnverified: true },
  { title: '《比热容》《电阻的测量》等九年级物理优课', subject: '物理', grade: '九年级', type: 'video', url: 'https://www.sp910.com/shipin/wuli/9nj/', source: '教视网（公开课专辑）', tag: '省级获奖', note: 'AI整理：热学、电学多节获奖实录，适合内能、电学实验板块的示范课参考。', urlUnverified: true },
  { title: '《水的组成》人教版九年级化学优课专辑', subject: '化学', grade: '九年级', type: 'video', url: 'https://www.sp910.com/biaoqian/shuidezucheng.html', source: '教视网（公开课专辑）', tag: '省级获奖', note: 'AI整理：含赛课、说播课与名师观摩课，适合"水的电解"实验探究课设计参考。', urlUnverified: true },
  { title: '《酸和碱》人教版九年级化学优质课专辑', subject: '化学', grade: '九年级', type: 'video', url: 'https://m.sp910.com/biaoqian/suanhejian.html', source: '教视网（公开课专辑）', tag: '示范课', note: 'AI整理：覆盖中和反应、常见酸和碱，适合酸碱盐单元的复习与实验课备课。', urlUnverified: true },
  { title: '《质量守恒定律》人教版九年级化学上册优质课', subject: '化学', grade: '九年级', type: 'video', url: 'https://www.renjiaoshe.com/jiaocai/117_shipin.html', source: '教师之家（优质课视频）', tag: '常规优质', note: 'AI整理：课堂实录+评比视频，适合以实验突破"守恒"观念的探究式教学。', urlUnverified: true },
  { title: '《溶液酸碱度的表示法——pH》智慧平台融合课例', subject: '化学', grade: '九年级', type: 'doc', url: 'http://www.gx-bestedu.com/haizhong/2024-07/26/article_2024072610315324594.html', source: '海南省国兴中学/区域教研案例', tag: 'AI示范', note: 'AI整理：基于国家平台终端的线上线下混合式教学案例，适合数字化赋能实验课借鉴。', urlUnverified: true },
];
