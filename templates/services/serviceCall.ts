/**
 * Template for the frontend → /api/generate call.
 * Replace the existing `new GoogleGenAI(...)` / `new OpenAI(...)` direct calls
 * with a function that builds your prompt parts and ends with `return callGenerate(parts)`.
 *
 * Keep your original prompt-building logic untouched — only the network call changes.
 */
import { readMasterKey, readUserApiKey } from '../lib/settings';

const MODEL = 'gemini-2.5-flash-image-preview'; // ← change per project

export async function callGenerate(
  parts: Array<{ text: string } | { image: { base64: string; mimeType: string } }>
): Promise<string> {
  const masterKey = readMasterKey();
  const userApiKey = readUserApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (masterKey) headers['x-master-key'] = masterKey;
  if (userApiKey) headers['x-user-api-key'] = userApiKey;

  let resp: Response;
  try {
    resp = await fetch('/api/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: MODEL, parts }),
    });
  } catch {
    throw new Error('网络请求失败，请检查连接');
  }

  let data: any;
  try { data = await resp.json(); }
  catch { throw new Error('服务器返回异常'); }

  if (resp.status === 429 || data?.error === 'rate_limit') {
    throw new Error(data?.message || '今天免费体验次数用完了，请在 ⚙️ 设置里填主密码或自己的 API Key');
  }
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.message || data?.error || '生成失败');
  }
  if (!data.image) throw new Error('未收到图像数据');
  return data.image as string;
}
