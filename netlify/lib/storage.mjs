import { currentStore } from '../../cloudflare/context.mjs';
export const store = currentStore;
export const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function readBody(request) {
  if (Number(request.headers.get("content-length")) > 4096)
    throw new Error("Request too large");
  const text = await request.text();
  if (text.length > 4096) throw new Error("Request too large");
  return JSON.parse(text);
}
export function sameOrigin(request) {
  const from = request.headers.get("origin");
  return from === new URL(request.url).origin;
}
