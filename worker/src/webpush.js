// 網頁推播（Web Push）：自己實作，不使用 Firebase
// 白話：
//  1. 手機允許通知後，瀏覽器會給我們一個「推播地址」和兩把小鑰匙（p256dh、auth）。
//  2. 要通知時，我們用這兩把鑰匙把訊息「加密」，只有那支手機解得開（推播公司也看不到內容）。
//  3. 再用 VAPID 私鑰「簽名」，證明這則推播真的是語音助手發的。
// 規格：RFC 8291（訊息加密 aes128gcm）、RFC 8292（VAPID）

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** 依 RFC 8291 加密訊息，回傳要送給推播公司的內容 */
export async function encryptPayload(subscription, payload) {
  const clientPublic = b64urlDecode(subscription.p256dh); // 手機的公鑰（65 bytes）
  const authSecret = b64urlDecode(subscription.auth);     // 手機的 auth 密碼（16 bytes）

  // 每次推播都產生一組新的臨時鑰匙
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKeys.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), clientPublic, serverPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const plaintext = concat(enc.encode(payload), new Uint8Array([2])); // 0x02＝最後一段
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  return concat(header, ciphertext);
}

/** 依 RFC 8292 產生 VAPID 簽名（JWT，ES256） */
export async function vapidAuthorization(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    // 聯絡方式：用 APP 網址（不放個人 Email）
    sub: env.FRONTEND_URL || 'https://gghihi.github.io/notion-voice-assistant/',
  })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * 送出一則推播。回傳 'ok'、'gone'（這個訂閱已失效，應刪除）或 'error'。
 * message = { title, body, url, tag }
 */
export async function sendPush(subscription, message, env, fetchImpl = fetch) {
  try {
    const body = await encryptPayload(subscription, JSON.stringify(message));
    const res = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, env),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400', // 手機沒開機時，推播公司最多保留 1 天
        Urgency: 'high',
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.warn('推播失敗', res.status);
      return 'error';
    }
    return 'ok';
  } catch (err) {
    console.warn('推播失敗', err?.name);
    return 'error';
  }
}
