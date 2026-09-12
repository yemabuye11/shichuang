/**
 * GitHub Pages 存储（P0 默认：零门槛，无需绑卡、无需自定义域名）。
 *
 * 前置条件（Supabase Secrets）：
 *   GITHUB_PAGES_TOKEN   fine-grained PAT（`Contents: read and write`）
 *   GITHUB_PAGES_REPO    owner/repo
 *   GITHUB_PAGES_BRANCH  main（默认）
 *
 * 代价：发布有 10–60s 延迟（因此 `PutResult.readyNow = false`，
 * 前端会在 `pending` 状态轮询，期间用本地副本 0 延迟预览）。
 */

import { AppError } from '../errors.ts';
import { byteLength, docHtmlPath, docJsonPath, objectPath, sha256Hex, type ArtifactStore, type PutResult } from './types.ts';

interface GhConfig {
  token: string;
  repo: string;
  branch: string;
}

function cfg(): GhConfig {
  const token = Deno.env.get('GITHUB_PAGES_TOKEN') ?? '';
  const repo = Deno.env.get('GITHUB_PAGES_REPO') ?? '';
  const branch = Deno.env.get('GITHUB_PAGES_BRANCH') || 'main';
  if (!token || !repo) {
    throw new AppError('STORE_FAILED', 'GitHub Pages 未配置：缺少 GITHUB_PAGES_TOKEN / GITHUB_PAGES_REPO');
  }
  return { token, repo, branch };
}

/** 把 UTF-8 字符串编码为 base64。 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class GitHubPagesStore implements ArtifactStore {
  readonly name = 'github_pages' as const;

  private api(path: string): string {
    return `https://api.github.com/repos/${cfg().repo}/contents/${path}`;
  }

  private publicUrl(path: string): string {
    const [owner, repo] = cfg().repo.split('/');
    return `https://${owner}.github.io/${repo}/${path}`;
  }

  private async ghFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg().token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  async putAppHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = objectPath(appId, version);
    const { branch } = cfg();

    // 若文件已存在需带 sha 才能覆盖（P0 版本恒为 1，正常不会覆盖）
    let existingSha: string | undefined;
    const head = await this.ghFetch(`${this.api(path)}?ref=${branch}`, { method: 'GET' });
    if (head.ok) {
      const meta = (await head.json()) as { sha?: string };
      existingSha = meta.sha;
    }

    const res = await this.ghFetch(this.api(path), {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore: publish app ${appId} v${version}`,
        content: toBase64(html),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });

    if (!res.ok) {
      throw new AppError('STORE_FAILED', `GitHub Pages 写入失败（${res.status}）`);
    }

    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(html),
      sha256: await sha256Hex(html),
      readyNow: false, // GH Pages 需要 10–60s 才能生效
    };
  }

  async getAppHtml(appId: string, version: number): Promise<string | null> {
    const res = await this.ghFetch(`${this.api(objectPath(appId, version))}?ref=${cfg().branch}`, {
      method: 'GET',
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as { content?: string; encoding?: string };
    if (!meta.content) return null;
    try {
      const binary = atob(meta.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  async warmup(url: string): Promise<void> {
    try {
      await fetch(url, { method: 'HEAD' });
    } catch {
      /* GH Pages 未就绪时 HEAD 会失败，忽略即可（前端轮询兜底） */
    }
  }

  async deleteAppHtml(appId: string, version: number): Promise<void> {
    const path = objectPath(appId, version);
    const { branch } = cfg();
    const head = await this.ghFetch(`${this.api(path)}?ref=${branch}`, { method: 'GET' });
    if (!head.ok) return;
    const meta = (await head.json()) as { sha?: string };
    if (!meta.sha) return;
    await this.ghFetch(this.api(path), {
      method: 'DELETE',
      body: JSON.stringify({ message: `chore: remove app ${appId} v${version}`, sha: meta.sha, branch }),
    });
  }

  async putDocHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = docHtmlPath(appId, version);
    const { branch } = cfg();
    let existingSha: string | undefined;
    const head = await this.ghFetch(`${this.api(path)}?ref=${branch}`, { method: 'GET' });
    if (head.ok) {
      const meta = (await head.json()) as { sha?: string };
      existingSha = meta.sha;
    }
    const res = await this.ghFetch(this.api(path), {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore: publish doc ${appId} v${version}`,
        content: toBase64(html),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    if (!res.ok) {
      throw new AppError('STORE_FAILED', `GitHub Pages 文档写入失败（${res.status}）`);
    }
    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(html),
      sha256: await sha256Hex(html),
      readyNow: false,
    };
  }

  async getDocHtml(appId: string, version: number): Promise<string | null> {
    const res = await this.ghFetch(`${this.api(docHtmlPath(appId, version))}?ref=${cfg().branch}`, {
      method: 'GET',
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as { content?: string; encoding?: string };
    if (!meta.content) return null;
    try {
      const binary = atob(meta.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  async putDocJson(appId: string, version: number, json: string): Promise<PutResult> {
    const path = docJsonPath(appId, version);
    const { branch } = cfg();
    let existingSha: string | undefined;
    const head = await this.ghFetch(`${this.api(path)}?ref=${branch}`, { method: 'GET' });
    if (head.ok) {
      const meta = (await head.json()) as { sha?: string };
      existingSha = meta.sha;
    }
    const res = await this.ghFetch(this.api(path), {
      method: 'PUT',
      body: JSON.stringify({
        message: `chore: publish doc json ${appId} v${version}`,
        content: toBase64(json),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    if (!res.ok) {
      throw new AppError('STORE_FAILED', `GitHub Pages 文档 JSON 写入失败（${res.status}）`);
    }
    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(json),
      sha256: await sha256Hex(json),
      readyNow: false,
    };
  }

  async getDocJson(appId: string, version: number): Promise<string | null> {
    const res = await this.ghFetch(`${this.api(docJsonPath(appId, version))}?ref=${cfg().branch}`, {
      method: 'GET',
    });
    if (!res.ok) return null;
    const meta = (await res.json()) as { content?: string; encoding?: string };
    if (!meta.content) return null;
    try {
      const binary = atob(meta.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }

  async deleteDoc(appId: string, version: number): Promise<void> {
    const { branch } = cfg();
    for (const path of [docHtmlPath(appId, version), docJsonPath(appId, version)]) {
      const head = await this.ghFetch(`${this.api(path)}?ref=${branch}`, { method: 'GET' });
      if (!head.ok) continue;
      const meta = (await head.json()) as { sha?: string };
      if (!meta.sha) continue;
      await this.ghFetch(this.api(path), {
        method: 'DELETE',
        body: JSON.stringify({ message: `chore: remove doc ${appId} v${version}`, sha: meta.sha, branch }),
      });
    }
  }
}

export const githubPagesStore = new GitHubPagesStore();
