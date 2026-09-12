/**
 * Supabase Storage 存储（**影子副本**，仅用于 `serve-app` 回源兜底）。
 *
 * ⚠️ 出网会计入 Supabase 的 10GB 红线，因此只作兜底，
 * 正常分发一律走 CDN（`r2` / `github_pages`）。
 */

import { adminClient } from '../supabaseAdmin.ts';
import { AppError } from '../errors.ts';
import { byteLength, docHtmlPath, docJsonPath, shadowPath, sha256Hex, type ArtifactStore, type PutResult } from './types.ts';

const BUCKET = 'apps-html';

export class SupabaseStorageStore implements ArtifactStore {
  readonly name = 'supabase_storage' as const;

  async putAppHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = shadowPath(appId, version);
    const sb = adminClient();
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, new Blob([html], { type: 'text/html; charset=utf-8' }), {
        contentType: 'text/html; charset=utf-8',
        cacheControl: '300',
        upsert: true,
      });
    if (error) throw new AppError('STORE_FAILED', `影子副本写入失败：${error.message}`);

    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return {
      url: data.publicUrl,
      sizeBytes: byteLength(html),
      sha256: await sha256Hex(html),
      readyNow: true,
    };
  }

  async getAppHtml(appId: string, version: number): Promise<string | null> {
    const sb = adminClient();
    const { data, error } = await sb.storage.from(BUCKET).download(shadowPath(appId, version));
    if (error || !data) return null;
    return await data.text();
  }

  async warmup(_url: string): Promise<void> {
    // 影子副本不对外分发，无需预热
  }

  async deleteAppHtml(appId: string, version: number): Promise<void> {
    const sb = adminClient();
    await sb.storage.from(BUCKET).remove([shadowPath(appId, version)]);
  }

  async putDocHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = docHtmlPath(appId, version);
    const sb = adminClient();
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, new Blob([html], { type: 'text/html; charset=utf-8' }), {
        contentType: 'text/html; charset=utf-8',
        cacheControl: '300',
        upsert: true,
      });
    if (error) throw new AppError('STORE_FAILED', `文档写入失败：${error.message}`);
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, sizeBytes: byteLength(html), sha256: await sha256Hex(html), readyNow: true };
  }

  async getDocHtml(appId: string, version: number): Promise<string | null> {
    const sb = adminClient();
    const { data, error } = await sb.storage.from(BUCKET).download(docHtmlPath(appId, version));
    if (error || !data) return null;
    return await data.text();
  }

  async putDocJson(appId: string, version: number, json: string): Promise<PutResult> {
    const path = docJsonPath(appId, version);
    const sb = adminClient();
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(path, new Blob([json], { type: 'application/json; charset=utf-8' }), {
        contentType: 'application/json; charset=utf-8',
        cacheControl: '300',
        upsert: true,
      });
    if (error) throw new AppError('STORE_FAILED', `文档 JSON 写入失败：${error.message}`);
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, sizeBytes: byteLength(json), sha256: await sha256Hex(json), readyNow: true };
  }

  async getDocJson(appId: string, version: number): Promise<string | null> {
    const sb = adminClient();
    const { data, error } = await sb.storage.from(BUCKET).download(docJsonPath(appId, version));
    if (error || !data) return null;
    return await data.text();
  }

  async deleteDoc(appId: string, version: number): Promise<void> {
    const sb = adminClient();
    await sb.storage.from(BUCKET).remove([docHtmlPath(appId, version), docJsonPath(appId, version)]);
  }
}

export const supabaseStorageStore = new SupabaseStorageStore();
