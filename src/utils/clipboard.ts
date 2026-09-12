/**
 * 剪贴板工具。
 *
 * `navigator.clipboard` 在非 HTTPS / 旧 WebView 下不可用，这里提供
 * `execCommand('copy')` 降级，保证「复制链接」在教师的手机浏览器里也能用。
 */

/**
 * 复制一段文本到剪贴板。
 *
 * @param text 待复制的文本。
 * @returns 是否成功（失败时调用方应给出「请长按手动复制」的提示）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  const nav = globalThis.navigator as Navigator & { clipboard?: Clipboard };
  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text);
      return true;
    } catch {
      /* 继续走降级分支 */
    }
  }

  return copyViaExecCommand(text);
}

/** 通过临时 textarea + `execCommand('copy')` 复制（同步降级方案）。 */
function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);

  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
