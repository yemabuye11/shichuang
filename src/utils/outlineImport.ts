/**
 * 导入大纲文件。
 *
 * 支持纯文本、Markdown、PPTX 和 DOCX。Office 文件只在浏览器中读取文字，
 * 不上传原文件；解析结果会截断到生成链路可稳定承载的字符数。
 */

export type OutlineSourceKind = 'text' | 'pptx' | 'docx';

export interface ImportedOutline {
  /** 文件名；粘贴文本时为空。 */
  readonly name: string;
  /** 归一化后的大纲正文。 */
  readonly content: string;
  /** 内容来源。 */
  readonly sourceKind: OutlineSourceKind;
  /** 原始解析字符数（截断前）。 */
  readonly originalChars: number;
  /** 是否因为上限被截断。 */
  readonly truncated: boolean;
  /** Office 文件解析出的页数。 */
  readonly pageCount?: number;
}

const MAX_OFFICE_FILE_BYTES = 120 * 1024 * 1024;
export const MAX_OUTLINE_CHARS = 30_000;

const GRADE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/幼儿园|学前/, '幼儿园'],
  [/(?:一|1)年级/, '一年级'],
  [/(?:二|2)年级/, '二年级'],
  [/(?:三|3)年级/, '三年级'],
  [/(?:四|4)年级/, '四年级'],
  [/(?:五|5)年级/, '五年级'],
  [/(?:六|6)年级/, '六年级'],
  [/(?:七|7)年级|初一/, '七年级'],
  [/(?:八|8)年级|初二/, '八年级'],
  [/(?:九|9)年级|初三/, '九年级'],
  [/高一/, '高一'],
  [/高二/, '高二'],
  [/高三/, '高三'],
];

const SUBJECT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/道德与法治|道法/, '道德与法治'],
  [/信息科技|信息技术/, '信息科技'],
  [/语文/, '语文'],
  [/数学/, '数学'],
  [/英语/, '英语'],
  [/科学/, '科学'],
  [/物理/, '物理'],
  [/化学/, '化学'],
  [/生物/, '生物'],
  [/历史/, '历史'],
  [/地理/, '地理'],
  [/音乐/, '音乐'],
  [/美术/, '美术'],
  [/体育/, '体育'],
];

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    })
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : '';
    });
}

function cleanOutlineLine(value: string): string {
  return decodeXmlText(value)
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function capOutline(content: string): Pick<ImportedOutline, 'content' | 'originalChars' | 'truncated'> {
  const originalChars = content.length;
  return {
    content: content.slice(0, MAX_OUTLINE_CHARS),
    originalChars,
    truncated: originalChars > MAX_OUTLINE_CHARS,
  };
}

/** 归一化粘贴的大纲，保留段落但清理多余空行和空白字符。 */
export function normalizeOutlineText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从文件名和大纲正文推断学科、年级。
 *
 * 导入现成课件时，教师通常不想再手填一遍元信息。推断结果只在对应字段为空时
 * 回填，避免覆盖教师已经明确选择的教材信息。
 */
export function inferOutlineTeachingContext(
  primaryText: string,
  secondaryText = '',
): { subject?: string; grade?: string } {
  const text = `${primaryText}\n${secondaryText}`.replace(/\s+/g, '');
  const grade = GRADE_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
  const subject = SUBJECT_PATTERNS.find(([pattern]) => pattern.test(text))?.[1];
  return { subject, grade };
}

function readXmlText(xml: string, tag: 'a:t' | 'w:t'): string[] {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(expression)]
    .map((match) => cleanOutlineLine(match[1] ?? ''))
    .filter(Boolean);
}

function choosePptSlideTitle(texts: readonly string[], titleTexts: readonly string[]): string {
  const candidates = [...titleTexts, ...texts]
    .map((text) => text.trim())
    .filter((text) => text.length >= 3 && text.length <= 32 && /[\u4e00-\u9fff]/.test(text));
  const preferred = candidates.find((text) =>
    /任务|活动|学习|目标|小结|练习|导入|朗读|生字|字词|课文|我会|方法|课堂|猜猜/.test(text)
  );
  return (preferred || candidates[0] || texts[0] || titleTexts[0] || '未命名页面').slice(0, 32);
}

async function parsePptx(file: File): Promise<ImportedOutline> {
  const JSZip = (await import('jszip')).default;
  const archive = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const ai = Number.parseInt(a.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      const bi = Number.parseInt(b.match(/slide(\d+)\.xml/i)?.[1] ?? '0', 10);
      return ai - bi;
    });

  const lines: string[] = [];
  for (let index = 0; index < slideNames.length; index += 1) {
    const xml = await archive.files[slideNames[index]].async('string');
    const texts = readXmlText(xml, 'a:t');
    if (texts.length === 0) continue;
    const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
    const titleShape = shapes.find((shape) => /<p:ph\b[^>]*type="(?:title|ctrTitle)"/i.test(shape));
    const titleTexts = titleShape ? readXmlText(titleShape, 'a:t') : [];
    const title = choosePptSlideTitle(texts, titleTexts);
    const remainingTexts = [...texts];
    for (const titleText of [...titleTexts, title]) {
      const foundIndex = remainingTexts.indexOf(titleText);
      if (foundIndex >= 0) remainingTexts.splice(foundIndex, 1);
    }
    const rest = titleTexts.length > 0 ? remainingTexts : texts.slice(1);
    lines.push(`第 ${index + 1} 页｜${title}`);
    if (rest.length > 0) lines.push(`- ${rest.join('；')}`);
  }

  const capped = capOutline(normalizeOutlineText(lines.join('\n')));
  return {
    name: file.name,
    sourceKind: 'pptx',
    pageCount: slideNames.length,
    ...capped,
  };
}

async function parseDocx(file: File): Promise<ImportedOutline> {
  const JSZip = (await import('jszip')).default;
  const archive = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: false });
  const documentFile = archive.file('word/document.xml');
  if (!documentFile) throw new Error('DOCX 中没有找到正文内容');
  const xml = await documentFile.async('string');
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const texts = readXmlText(paragraph, 'w:t');
    if (texts.length === 0) continue;
    const headingLevel = Number(paragraph.match(/<w:pStyle\b[^>]*w:val="Heading([1-6])"/i)?.[1] ?? 0);
    const prefix = headingLevel > 0 ? `${'#'.repeat(headingLevel)} ` : '';
    lines.push(`${prefix}${texts.join('')}`);
  }

  const capped = capOutline(normalizeOutlineText(lines.join('\n')));
  return {
    name: file.name,
    sourceKind: 'docx',
    ...capped,
  };
}

async function parseText(file: File): Promise<ImportedOutline> {
  const capped = capOutline(normalizeOutlineText(await file.text()));
  return {
    name: file.name,
    sourceKind: 'text',
    ...capped,
  };
}

/** 读取 PPTX / DOCX / TXT / Markdown 文件为大纲文本。 */
export async function importOutlineFile(file: File): Promise<ImportedOutline> {
  if (file.size > MAX_OFFICE_FILE_BYTES) {
    throw new Error('文件超过 120MB，请先导出纯文本大纲再导入');
  }
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pptx') return parsePptx(file);
  if (extension === 'docx') return parseDocx(file);
  if (extension === 'txt' || extension === 'md' || extension === 'markdown' || file.type.startsWith('text/')) {
    return parseText(file);
  }
  throw new Error('暂只支持 PPTX、DOCX、TXT 和 Markdown 文件');
}
