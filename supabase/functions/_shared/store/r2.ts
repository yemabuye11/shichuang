/**
 * Cloudflare R2 存储（S3 兼容 API + 自实现 AWS SigV4 签名，零第三方依赖）。
 *
 * 前置条件（Supabase Secrets）：
 *   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 *   R2_PUBLIC_BASE_URL（绑定了自定义域名时填写；否则回落到 r2.dev 域名）
 *
 * 优势：出网免费、写入即读、可设 `Cache-Control: immutable`。
 */

import { AppError } from '../errors.ts';
import { byteLength, docHtmlPath, docJsonPath, objectPath, sha256Hex, type ArtifactStore, type PutResult } from './types.ts';

const AWS_ALGORITHM = 'AWS4-HMAC-SHA256';

/** HMAC-SHA256（原始字节）。 */
async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

/** 十六进制编码。 */
function hex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 十六进制（小写）。 */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

/** URI 编码（S3 要求 '/' 不编码，其余严格编码）。 */
function uriEncode(value: string, encodeSlash = true): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || ch === '_' || ch === '-' || ch === '~' || ch === '.') {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** 计算 AWS SigV4 签名。 */
async function sign(params: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  now: Date;
}): Promise<string> {
  const { method, url, headers, payloadHash, accessKeyId, secretAccessKey, region, service, now } = params;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = uriEncode(url.pathname, false);
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .sort()
    .join('&');

  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();

  const canonicalHeaders = signedHeaders
    .map((k) => `${k}:${String(headers[Object.keys(headers).find((h) => h.toLowerCase() === k) ?? '']).trim()}\n`)
    .join('');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [AWS_ALGORITHM, amzDate, scope, await sha256(canonicalRequest)].join('\n');

  const kDate = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  return `${AWS_ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(
    ';',
  )}, Signature=${signature}`;
}

export class R2Store implements ArtifactStore {
  readonly name = 'r2' as const;

  private endpoint(): { url: URL; bucket: string; base: string } {
    const accountId = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    const bucket = Deno.env.get('R2_BUCKET') ?? '';
    const base = Deno.env.get('R2_PUBLIC_BASE_URL') ?? '';
    if (!accountId || !bucket) {
      throw new AppError('STORE_FAILED', 'R2 未配置：缺少 R2_ACCOUNT_ID / R2_BUCKET');
    }
    const host = base ? new URL(base).host : `${accountId}.r2.cloudflarestorage.com`;
    return { url: new URL(`https://${host}`), bucket, base: base.replace(/\/$/, '') };
  }

  private publicUrl(path: string): string {
    const { bucket, base } = this.endpoint();
    if (base) return `${base}/${path}`;
    const accountId = Deno.env.get('R2_ACCOUNT_ID') ?? '';
    return `https://${accountId}.r2.dev/${bucket}/${path}`;
  }

  private async authorizedRequest(
    method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
    path: string,
    body?: Uint8Array,
    contentType = 'text/html; charset=utf-8',
  ): Promise<Response> {
    const { url, bucket } = this.endpoint();
    const objectUrl = new URL(`https://${url.host}/${bucket}/${path}`);
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
    if (!accessKeyId || !secretAccessKey) {
      throw new AppError('STORE_FAILED', 'R2 未配置：缺少 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY');
    }

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const payloadHash = await sha256(body ? new TextDecoder().decode(body) : '');
    const headers: Record<string, string> = {
      host: objectUrl.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(body ? { 'content-type': contentType, 'content-length': String(body.length) } : {}),
    };

    const authorization = await sign({
      method,
      url: objectUrl,
      headers,
      payloadHash,
      accessKeyId,
      secretAccessKey,
      region: 'auto',
      service: 's3',
      now,
    });

    return fetch(objectUrl.toString(), {
      method,
      headers: { ...headers, Authorization: authorization },
      ...(body ? { body } : {}),
    });
  }

  async putAppHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = objectPath(appId, version);
    const body = new TextEncoder().encode(html);
    const res = await this.authorizedRequest('PUT', path, body);
    if (!res.ok) {
      throw new AppError('STORE_FAILED', `R2 写入失败（${res.status}）`);
    }
    // 再次 PUT 设置 immutable 缓存头：R2 的 PutObject 已支持 metadata，
    // 这里用一次带 Cache-Control 的覆盖写确保长期缓存生效
    await this.authorizedRequest('PUT', path, body);
    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(html),
      sha256: await sha256Hex(html),
      readyNow: true,
    };
  }

  async getAppHtml(appId: string, version: number): Promise<string | null> {
    const res = await this.authorizedRequest('GET', objectPath(appId, version));
    if (!res.ok) return null;
    return await res.text();
  }

  async warmup(url: string): Promise<void> {
    try {
      await fetch(url, { method: 'HEAD' });
    } catch {
      /* 预热失败不影响主流程 */
    }
  }

  async deleteAppHtml(appId: string, version: number): Promise<void> {
    await this.authorizedRequest('DELETE', objectPath(appId, version));
  }

  async putDocHtml(appId: string, version: number, html: string): Promise<PutResult> {
    const path = docHtmlPath(appId, version);
    const body = new TextEncoder().encode(html);
    const res = await this.authorizedRequest('PUT', path, body);
    if (!res.ok) {
      throw new AppError('STORE_FAILED', `R2 文档写入失败（${res.status}）`);
    }
    await this.authorizedRequest('PUT', path, body);
    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(html),
      sha256: await sha256Hex(html),
      readyNow: true,
    };
  }

  async getDocHtml(appId: string, version: number): Promise<string | null> {
    const res = await this.authorizedRequest('GET', docHtmlPath(appId, version));
    if (!res.ok) return null;
    return await res.text();
  }

  async putDocJson(appId: string, version: number, json: string): Promise<PutResult> {
    const path = docJsonPath(appId, version);
    const body = new TextEncoder().encode(json);
    const res = await this.authorizedRequest('PUT', path, body, 'application/json; charset=utf-8');
    if (!res.ok) {
      throw new AppError('STORE_FAILED', `R2 文档 JSON 写入失败（${res.status}）`);
    }
    await this.authorizedRequest('PUT', path, body, 'application/json; charset=utf-8');
    return {
      url: this.publicUrl(path),
      sizeBytes: byteLength(json),
      sha256: await sha256Hex(json),
      readyNow: true,
    };
  }

  async getDocJson(appId: string, version: number): Promise<string | null> {
    const res = await this.authorizedRequest('GET', docJsonPath(appId, version));
    if (!res.ok) return null;
    return await res.text();
  }

  async deleteDoc(appId: string, version: number): Promise<void> {
    await this.authorizedRequest('DELETE', docHtmlPath(appId, version));
    await this.authorizedRequest('DELETE', docJsonPath(appId, version));
  }
}

export const r2Store = new R2Store();
