// 登入與通行證（token）。
// 通行證＝「到期時間.簽章」，簽章用只存在 Cloudflare 的 SESSION_SECRET 產生，
// 別人沒有這把秘密就造不出有效的通行證。
const enc = new TextEncoder();
const TOKEN_DAYS = 30;

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 比較兩段文字時花一樣的時間，避免被用「回應快慢」猜出密碼
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(env, password) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET || typeof password !== 'string') return false;
  // 先各自簽章再比較，長度不同也不會洩漏
  const [a, b] = await Promise.all([hmac(env.SESSION_SECRET, 'pw:' + password), hmac(env.SESSION_SECRET, 'pw:' + env.APP_PASSWORD)]);
  return sameText(a, b);
}

export async function issueToken(env, now = Date.now()) {
  const exp = String(now + TOKEN_DAYS * 86400000);
  return exp + '.' + (await hmac(env.SESSION_SECRET, 'tok:' + exp));
}

export async function verifyToken(env, token, now = Date.now()) {
  if (!env.SESSION_SECRET || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return sameText(sig, await hmac(env.SESSION_SECRET, 'tok:' + exp));
}
