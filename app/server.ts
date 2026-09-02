import "dotenv/config";
import express from "express";
import http from "http";
import https from "https";
import net from "net";
import stream from "stream";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import ssh2 from "ssh2";
const SshServer = (ssh2 as any).Server || (ssh2 as any).default?.Server || ssh2;
import { Agent as UndiciAgent, setGlobalDispatcher } from "undici";

// -----------------------------------------------------------------------------
// Global Dispatcher for Telegram Bot Calls
// -----------------------------------------------------------------------------
setGlobalDispatcher(new UndiciAgent({
  connections: 512,
  pipelining: 1,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000
}));

// -----------------------------------------------------------------------------
// Ports & Paths Configuration
// -----------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const DROPBEAR_PORT = 10093;
const SSH_WS_PATH = "/_mohalamia";
const FAKE_SNI_HOST = "";

const DATA_DIR = process.env.DATA_DIR ? process.env.DATA_DIR : process.cwd();
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch { /* ignore */ }

// -----------------------------------------------------------------------------
// Global Logging
// -----------------------------------------------------------------------------
const logs: string[] = [];
function addLog(message: string) {
  const timestamp = new Date().toISOString();
  const formattedLog = `[${timestamp}] ${message}`;
  logs.push(formattedLog);
  if (logs.length > 500) {
    logs.shift();
  }
  console.log(formattedLog);
}

process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err?.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Unhandled Rejection]", reason);
});

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// -----------------------------------------------------------------------------
// Host Auto-detection
// -----------------------------------------------------------------------------
const detectedHostFilePath = path.join(DATA_DIR, "detected-host.json");
let cachedPublicHost: string | null = null;

function isLikelyPublicHost(h: string): boolean {
  if (!h) return false;
  const host = h.split(":")[0].toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (!host.includes(".")) return false;
  return true;
}

function rememberPublicHost(host: string) {
  if (!isLikelyPublicHost(host) || host === cachedPublicHost) return;
  cachedPublicHost = host;
  try {
    fs.writeFileSync(detectedHostFilePath, JSON.stringify({ host, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch { /* ignore */ }
  addLog(`Auto-detected public domain: ${host}`);
}

function loadPersistedHost() {
  try {
    if (fs.existsSync(detectedHostFilePath)) {
      const data = JSON.parse(fs.readFileSync(detectedHostFilePath, "utf8"));
      if (data?.host && isLikelyPublicHost(data.host)) {
        cachedPublicHost = data.host;
      }
    }
  } catch { /* ignore */ }
}
loadPersistedHost();

async function detectCloudRunHostFromMetadata(): Promise<string | null> {
  const service = process.env.K_SERVICE;
  if (!service) return null;

  try {
    const metaHeaders = { "Metadata-Flavor": "Google" };
    const [regionRes, projectRes] = await Promise.all([
      fetch("http://metadata.google.internal/computeMetadata/v1/instance/region", { headers: metaHeaders }),
      fetch("http://metadata.google.internal/computeMetadata/v1/project/numeric-project-id", { headers: metaHeaders })
    ]);
    if (!regionRes.ok || !projectRes.ok) return null;

    const regionRaw = (await regionRes.text()).trim();
    const projectNumber = (await projectRes.text()).trim();
    const region = regionRaw.split("/").pop();
    if (!region || !projectNumber) return null;

    return `${service}-${projectNumber}.${region}.run.app`;
  } catch (e: any) {
    addLog(`Metadata-server domain auto-detection failed: ${e?.message || e}`);
    return null;
  }
}

detectCloudRunHostFromMetadata().then((detected) => {
  if (detected && !cachedPublicHost) rememberPublicHost(detected);
});

function getPublicDomain(): string {
  if (process.env.APP_URL) {
    try {
      const u = new URL(process.env.APP_URL);
      return u.hostname;
    } catch {
      return process.env.APP_URL.replace(/^https?:\/\//, "").split("/")[0];
    }
  }
  if (cachedPublicHost) return cachedPublicHost;
  return "0.0.0.0";
}

// -----------------------------------------------------------------------------
// Geo Location Helpers
// -----------------------------------------------------------------------------
function countryCodeToFlagEmoji(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌍";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function countryCodeToArabicName(code: string, fallback: string): string {
  if (!code || code.length !== 2) return fallback;
  try {
    const dn = new Intl.DisplayNames(["ar"], { type: "region" });
    return dn.of(code.toUpperCase()) || fallback;
  } catch {
    return fallback;
  }
}

interface ServerLocationInfo {
  flag: string;
  countryName: string;
  countryCode: string;
  ip: string;
  city: string;
  isp: string;
}

let cachedServerLocation: ServerLocationInfo | null = null;
let cachedServerLocationAt = 0;
const SERVER_LOCATION_CACHE_MS = 6 * 60 * 60 * 1000;

function formatServerLocationDetail(loc: ServerLocationInfo): string {
  const parts: string[] = [];
  if (loc.ip) parts.push(`🌐 IP: <code>${escapeHtml(loc.ip)}</code>`);
  if (loc.city) parts.push(`🏙️ ${escapeHtml(loc.city)}`);
  if (loc.isp) parts.push(`🛰️ ${escapeHtml(loc.isp)}`);
  return parts.join("  |  ");
}

async function fetchServerLocation(): Promise<ServerLocationInfo | null> {
  try {
    const res = await fetch("http://ip-api.com/json/?fields=status,country,countryCode,city,isp,query", { signal: AbortSignal.timeout(5000) });
    const json: any = await res.json();
    if (json && json.status === "success" && json.countryCode && json.country) {
      return {
        flag: countryCodeToFlagEmoji(json.countryCode),
        countryName: countryCodeToArabicName(json.countryCode, json.country),
        countryCode: json.countryCode,
        ip: json.query || "",
        city: json.city || "",
        isp: json.isp || ""
      };
    }
  } catch {}
  return null;
}

async function getServerLocation(): Promise<ServerLocationInfo | null> {
  const now = Date.now();
  if (cachedServerLocation && now - cachedServerLocationAt < SERVER_LOCATION_CACHE_MS) {
    return cachedServerLocation;
  }
  const loc = await fetchServerLocation();
  if (loc) {
    cachedServerLocation = loc;
    cachedServerLocationAt = now;
  }
  return cachedServerLocation;
}

// -----------------------------------------------------------------------------
// Admin & Bot Token Configuration
// -----------------------------------------------------------------------------
const adminFilePath = path.join(DATA_DIR, "admin.json");
const muradBotFilePath = path.join(DATA_DIR, "murad-bot.json");
const MURAD_SETUP_PASSWORD = process.env.MURAD_SETUP_PASSWORD || "mooh2026";

interface MuradBotConfig {
  botId: string;
  botToken: string;
  savedAt: string;
}

function getMuradBotConfig(): MuradBotConfig | null {
  if (!fs.existsSync(muradBotFilePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(muradBotFilePath, "utf8"));
    if (data && data.botId && data.botToken) return data as MuradBotConfig;
    return null;
  } catch {
    return null;
  }
}

function saveMuradBotConfigOnce(botId: string, botToken: string): boolean {
  if (getMuradBotConfig()) return false;
  const config: MuradBotConfig = { botId, botToken, savedAt: new Date().toISOString() };
  try {
    const fd = fs.openSync(muradBotFilePath, "wx");
    fs.writeFileSync(fd, JSON.stringify(config, null, 2), "utf8");
    fs.closeSync(fd);
    addLog(`[Murad Bot] Config saved permanently (bot id ${botId}).`);
    return true;
  } catch {
    return false;
  }
}

function getActiveBotTokenSafe(): string | null {
  const murad = getMuradBotConfig();
  if (murad && murad.botToken) return murad.botToken;
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";
function getWebhookSecret(): string {
  const token = getActiveBotTokenSafe() || "not-configured";
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
}

interface SecondaryAdmin {
  id: string;
  name: string;
  addedAt: string;
}

interface AdminData {
  primaryAdmin: string | null;
  secondaryAdmins: SecondaryAdmin[];
  updatedAt?: string;
}

function getPrimaryAdminId(): string {
  const murad = getMuradBotConfig();
  if (murad && murad.botId) return murad.botId;
  return process.env.TELEGRAM_ADMIN_CHAT_ID || "1772564386";
}

function getAdminConfig(): AdminData {
  const primaryId = getPrimaryAdminId();
  const defaults: AdminData = { primaryAdmin: primaryId, secondaryAdmins: [] };
  if (fs.existsSync(adminFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(adminFilePath, "utf8"));
      return {
        primaryAdmin: primaryId,
        secondaryAdmins: Array.isArray(data.secondaryAdmins) ? data.secondaryAdmins : [],
        updatedAt: data.updatedAt
      };
    } catch {
      return defaults;
    }
  }
  return defaults;
}

function saveAdminConfig(data: AdminData) {
  try {
    data.primaryAdmin = getPrimaryAdminId();
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(adminFilePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err: any) {
    addLog(`Failed to save admin config: ${err?.message || err}`);
  }
}

function addSecondaryAdmin(targetId: string, name?: string): { success: boolean; message: string } {
  targetId = String(targetId).trim();
  if (!targetId || !/^\d+$/.test(targetId)) {
    return { success: false, message: "❌ معرف الحساب غير صالح. أرقام فقط." };
  }
  const config = getAdminConfig();
  if (config.primaryAdmin === targetId) return { success: false, message: "⚠️ هذا المعرف هو الأدمن الرئيسي المثبت." };
  if (config.secondaryAdmins.some(a => a.id === targetId)) return { success: false, message: "⚠️ هذا الحساب مضاف مسبقاً كأدمن ثانوي." };

  const newAdmin: SecondaryAdmin = {
    id: targetId,
    name: name?.trim() || `Admin_${targetId.slice(-4)}`,
    addedAt: new Date().toISOString()
  };
  config.secondaryAdmins.push(newAdmin);
  saveAdminConfig(config);
  return { success: true, message: `✅ تم إضافة الأدمن الثانوي (<b>${escapeHtml(newAdmin.name)}</b> - <code>${targetId}</code>).` };
}

function removeSecondaryAdmin(targetId: string): { success: boolean; message: string } {
  targetId = String(targetId).trim();
  const config = getAdminConfig();
  if (config.primaryAdmin === targetId) return { success: false, message: "🚫 لا يمكن حذف الأدمن الرئيسي." };
  const initial = config.secondaryAdmins.length;
  config.secondaryAdmins = config.secondaryAdmins.filter(a => a.id !== targetId);
  if (config.secondaryAdmins.length === initial) return { success: false, message: "❌ الأدمن الثانوي غير موجود." };
  saveAdminConfig(config);
  return { success: true, message: `✅ تم حذف الأدمن الثانوي (ID: <code>${targetId}</code>).` };
}

function isAuthorizedAdmin(chatId: string | number): boolean {
  const idStr = String(chatId).trim();
  const config = getAdminConfig();
  if (!config.primaryAdmin) return false;
  if (config.primaryAdmin === idStr) return true;
  if (config.secondaryAdmins.some(a => a.id === idStr)) return true;
  return false;
}

// -----------------------------------------------------------------------------
// SSH Credentials & Host Key
// -----------------------------------------------------------------------------
let sshServerInstance: any = null;
const sshCredsFilePath = path.join(DATA_DIR, "ssh-credentials.json");

interface SshCredentials {
  username: string;
  password: string;
}

const activeSshConnections = new Set<{ client: any; user: string; pingTimer?: NodeJS.Timeout; connectedAt: number }>();

function getSshCredentials(): SshCredentials {
  if (fs.existsSync(sshCredsFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sshCredsFilePath, "utf8"));
      if (data && data.username && data.password) return data;
    } catch {}
  }
  return {
    username: process.env.SSH_USERNAME || "mohaalamia",
    password: process.env.SSH_PASSWORD || "mooh2026"
  };
}

function saveSshCredentials(creds: SshCredentials) {
  try {
    fs.writeFileSync(sshCredsFilePath, JSON.stringify(creds, null, 2), "utf8");
    addLog(`[SSH] Saved new credentials for user '${creds.username}'.`);

    for (const conn of Array.from(activeSshConnections)) {
      try { conn.client.end(); } catch {}
      try { conn.client.destroy(); } catch {}
    }
    activeSshConnections.clear();
  } catch (e: any) {
    addLog(`[SSH] Error saving credentials: ${e?.message || e}`);
  }
}

function getOrCreateSshHostKey(): string {
  const keyPath = path.join(DATA_DIR, "ssh_host_rsa_key.pem");
  if (fs.existsSync(keyPath)) {
    try {
      const key = fs.readFileSync(keyPath, "utf8");
      if (key && key.includes("PRIVATE KEY")) return key;
    } catch {}
  }

  try {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });

    try {
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
      addLog(`[SSH] Generated new RSA host key.`);
    } catch {}
    return privateKey;
  } catch (err: any) {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });
    return privateKey;
  }
}

const SSH_BANNER_TEXT = `<div style="text-align: center; font-family: Arial, sans-serif; line-height: 1.6; padding: 15px; border-radius: 10px; background-color: #f9f9f9; border: 2px dashed #00ced1;">
  <h2 style="color: red; margin-bottom: 10px;">✦ Connected to Secure Server ✦</h2>

  <p style="color: #00ced1;">🌍 <strong>Location:</strong> EUROPE</p>
  <p style="color: #7fff00;">🛰️ <strong>VPS SERVER</strong></p>
  <p style="color: #dda0dd;">🌙 <strong>Powered by Secure Admin</strong></p>
  <p style="color: #1e90ff;">🔗 <strong>SECURE-CONFIG</strong></p>
  <p style="color: #ff4500;">🚫 <strong>No Torrent Allowed</strong></p>
  <p style="color: #ff0000;">❌ <strong>Rule Violation = Terminate</strong></p>

  <hr style="border: none; border-top: 1px dashed #ccc; margin: 20px 0;">

  <p style="color: #ffd700;">✨ <strong>Enjoy Internet</strong> ✨</p>
  <p style="color: #32cd32;">🔋 <strong>Support by Secure Admin</strong></p>
</div>`;

function checkSshAuth(user: string, pass: string): boolean {
  const creds = getSshCredentials();
  return user === creds.username && pass === creds.password;
}

function startSshServer() {
  if (sshServerInstance) return;

  const hostKey = getOrCreateSshHostKey();

  const server = new SshServer({
    hostKeys: [hostKey],
    banner: SSH_BANNER_TEXT
  }, (client: any) => {
    let authUser = "";

    // Send banner to client
    try {
      if (typeof client.banner === "function") {
        client.banner(SSH_BANNER_TEXT);
      }
    } catch {}

    client.on("authentication", (ctx: any) => {
      const user = ctx.username;

      // Ensure banner is sent during authentication if client supports it
      try {
        if (typeof client.banner === "function") {
          client.banner(SSH_BANNER_TEXT);
        }
      } catch {}

      if (ctx.method === "password") {
        if (checkSshAuth(user, ctx.password)) {
          authUser = user;
          addLog(`[SSH] ✅ Accepted password login for user '${user}'.`);
          ctx.accept();
          return;
        }
      }

      if (ctx.method === "keyboard-interactive") {
        ctx.prompt([{ prompt: "Password: ", echo: false }], (answers: string[]) => {
          if (answers.length > 0 && checkSshAuth(user, answers[0])) {
            authUser = user;
            addLog(`[SSH] ✅ Accepted keyboard-interactive login for user '${user}'.`);
            ctx.accept();
          } else {
            addLog(`[SSH] ❌ Rejected keyboard-interactive login for user '${user}'.`);
            ctx.reject();
          }
        });
        return;
      }

      addLog(`[SSH] ❌ Rejected auth method '${ctx.method}' for user '${user}'.`);
      ctx.reject(["password", "keyboard-interactive"]);
    });

    const handleTcpIp = (accept: any, reject: any, info: any) => {
      const destHost = info?.destIP || info?.dstIP || info?.destHost || "127.0.0.1";
      const destPort = info?.destPort || info?.dstPort || info?.port || 80;

      let stream: any;
      try {
        stream = accept();
      } catch {
        if (reject) reject();
        return;
      }

      if (!stream) return;

      let closed = false;
      const proxySocket = net.connect({ host: destHost, port: destPort });

      try { proxySocket.setNoDelay(true); } catch {}
      try { proxySocket.setTimeout(0); } catch {}
      try { proxySocket.setKeepAlive(true, 1000); } catch {}
      try { (stream as any).setTimeout?.(0); } catch {}

      stream.pipe(proxySocket);
      proxySocket.pipe(stream);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        try { stream.end(); } catch {}
        try { proxySocket.destroy(); } catch {}
      };

      proxySocket.on("error", cleanup);
      stream.on("error", cleanup);
      proxySocket.on("close", cleanup);
      stream.on("close", cleanup);
    };

    client.on("tcpip", handleTcpIp);
    client.on("direct-tcpip", handleTcpIp);

    client.on("request", (accept: any) => {
      if (accept) { try { accept(); } catch {} }
    });

    client.on("tcpip-forward", (accept: any) => {
      if (accept) { try { accept(); } catch {} }
    });

    client.on("cancel-tcpip-forward", (accept: any) => {
      if (accept) { try { accept(); } catch {} }
    });

    client.on("session", (accept: any) => {
      let session: any;
      try { session = accept(); } catch { return; }
      if (!session) return;

      session.on("pty", (accept: any) => { if (accept) { try { accept(); } catch {} } });
      session.on("window-change", (accept: any) => { if (accept) { try { accept(); } catch {} } });
      session.on("env", (accept: any) => { if (accept) { try { accept(); } catch {} } });
      session.on("subsystem", (accept: any) => { if (accept) { try { accept(); } catch {} } });

      session.on("shell", (accept: any) => {
        const stream = accept();
        if (!stream) return;
        try {
          stream.write(SSH_BANNER_TEXT + "\r\n\r\nConnected as " + authUser + "\r\n\r\nmohaalamia-ssh$ ");
        } catch {}
        stream.on("data", (d: Buffer) => {
          const s = d.toString();
          if (s.includes("\r") || s.includes("\n")) {
            try { stream.write("\r\nmohaalamia-ssh$ "); } catch {}
          }
        });
      });

      session.on("exec", (accept: any) => {
        const stream = accept();
        if (!stream) return;
        try {
          stream.write(SSH_BANNER_TEXT + "\r\n");
          stream.exit(0);
          stream.end();
        } catch {}
      });
    });

    // Multi-tier Keepalive & Active Refresh System:
    // 1. High-frequency protocol pings every 1.5s to prevent immediate idle drop
    // 2. Global OpenSSH keepalive requests every 10s
    // 3. Periodic minute-by-minute session state refresh signal
    const pingInterval = setInterval(() => {
      try {
        if ((client as any)._protocol) {
          if (typeof (client as any)._protocol.ping === "function") {
            (client as any)._protocol.ping((_err: any) => {});
          }
          if (typeof (client as any)._protocol.sendGlobalRequest === "function") {
            (client as any)._protocol.sendGlobalRequest("keepalive@openssh.com", true, (_err: any) => {});
          }
        }
        if (typeof (client as any).ping === "function") {
          (client as any).ping((_err: any) => {});
        }
      } catch {}
    }, 1500);

    // Explicit 60-second Keepalive & Stream Refresh Timer
    const minuteRefreshInterval = setInterval(() => {
      try {
        connInfo.lastSeen = Date.now();
        if ((client as any)._protocol && typeof (client as any)._protocol.sendGlobalRequest === "function") {
          (client as any)._protocol.sendGlobalRequest("keepalive@openssh.com", false, (_err: any) => {});
          (client as any)._protocol.sendGlobalRequest("hostkeys-prove-00@openssh.com", false, (_err: any) => {});
        }
        addLog(`[SSH-Keepalive] 🔄 Refreshed active keepalive session for ${authUser}`);
      } catch {}
    }, 60000);

    const connInfo = { 
      client, 
      user: authUser, 
      pingTimer: pingInterval, 
      minuteTimer: minuteRefreshInterval,
      connectedAt: Date.now(),
      lastSeen: Date.now() 
    };
    activeSshConnections.add(connInfo);

    const cleanupClient = () => {
      clearInterval(pingInterval);
      clearInterval(minuteRefreshInterval);
      activeSshConnections.delete(connInfo);
    };

    client.on("close", cleanupClient);
    client.on("end", cleanupClient);
    client.on("error", cleanupClient);
    client.on("ready", () => { 
      connInfo.user = authUser; 
      connInfo.lastSeen = Date.now();
    });
  });

  server.listen(DROPBEAR_PORT, "127.0.0.1", () => {
    addLog(`[SSH] ✅ Mohaalamia SSH Server listening on 127.0.0.1:${DROPBEAR_PORT}`);
  });

  server.on("error", (err: any) => {
    addLog(`[SSH] Server error: ${err?.message || err}`);
  });

  sshServerInstance = server;
}

// -----------------------------------------------------------------------------
// Payload Generation
// -----------------------------------------------------------------------------
function getSshWsPayloadText(domain: string): string {
  return `GET ${SSH_WS_PATH} HTTP/1.1[crlf]Host: ${domain}[crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf]Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==[crlf]Sec-WebSocket-Version: 13[crlf][crlf]`;
}

// -----------------------------------------------------------------------------
// Telegram Bot API Helper
// -----------------------------------------------------------------------------
async function telegramApi(method: string, payload: any): Promise<any> {
  const token = getActiveBotTokenSafe();
  if (!token) {
    addLog(`Telegram API (${method}) skipped: No bot token.`);
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json: any = await res.json();
    if (json && !json.ok) {
      addLog(`Telegram API (${method}) ok=false: ${json.description || JSON.stringify(json)}`);
    }
    return json;
  } catch (err: any) {
    addLog(`Telegram API Error (${method}): ${err?.message || err}`);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Keyboards for Telegram Bot
// -----------------------------------------------------------------------------
const MAIN_REPLY_KEYBOARD = {
  keyboard: [
    [{ text: "🔐 بيانات Mohaalamia SSH" }, { text: "🌐 إعداد WebSocket" }],
    [{ text: "👤 إدارة حساب SSH" }, { text: "📊 حالة الخدمة" }],
    [{ text: "📡 الأجهزة المتصلة" }, { text: "👑 المشرفون" }],
    [{ text: "📝 سجلات الخدمة" }, { text: "🆔 معرفي" }],
    [{ text: "🏠 القائمة الرئيسية" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

async function sendMainMenu(chatId: number | string) {
  const domain = getPublicDomain();
  const creds = getSshCredentials();
  const running = !!sshServerInstance;
  const location = await getServerLocation();
  const locationText = location ? `${location.flag} ${location.countryName}` : "🌍 غير معروف";
  const locationDetail = location ? formatServerLocationDetail(location) : "";

  const text =
    `🚀 <b>مرحباً بك في لوحة تحكم سيرفر Mohaalamia SSH:</b>\n\n` +
    `🟢 <b>حالة السيرفر:</b> ${running ? "يعمل بنجاح 🟢" : "متوقف 🔴"}\n` +
    `🗺️ <b>موقع السيرفر:</b> ${locationText}\n` +
    (locationDetail ? `${locationDetail}\n` : "") +
    `🌐 <b>النطاق النشط (Domain):</b> <code>${escapeHtml(domain)}</code>\n` +
    `🔌 <b>المنفذ العام:</b> <code>443 (TLS/SSL)</code>\n` +
    `🧭 <b>المسار (Path):</b> <code>${SSH_WS_PATH}</code>\n` +
    `🕵️ <b>SNI:</b> <code>${FAKE_SNI_HOST}</code>\n` +
    `👤 <b>اسم المستخدم:</b> <code>${escapeHtml(creds.username)}</code>\n` +
    `🔑 <b>كلمة المرور:</b> <code>${escapeHtml(creds.password)}</code>\n\n` +
    `⚡ <b>بروتوكول الاتصال المدعوم:</b>\n` +
    `🌐 <b>WebSocket Payload (HTTP 101):</b> عبر مسار <code>${SSH_WS_PATH}</code>.\n\n` +
    `اختر من الأزرار بالأسفل لإدارة الخادم أو نسخ بيانات الاتصال:`;

  const inlineKeyboard = [
    [{ text: "🌐 إعداد WebSocket", callback_data: "send_payload_ws" }, { text: "🔐 بيانات Mohaalamia SSH", callback_data: "cfg_ssh" }],
    [{ text: "📊 حالة الخادم", callback_data: "show_status" }, { text: "📡 الأجهزة المتصلة", callback_data: "show_devices" }],
    [{ text: "👤 تغيير اسم المستخدم", callback_data: "ssh_change_username" }, { text: "🔑 تغيير كلمة المرور", callback_data: "ssh_change_password" }],
    [{ text: "🔒 وصول خاص", callback_data: "bot_private_info" }, { text: "🌐 وصول عام", callback_data: "bot_public_info" }]
  ];

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: "⚡ اختر من لوحة التحكم بالأسفل:",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}

async function sendSshInfo(chatId: number | string) {
  const domain = getPublicDomain();
  const creds = getSshCredentials();
  const running = !!sshServerInstance;
  const location = await getServerLocation();
  const locationText = location ? `${location.flag} ${location.countryName}` : "🌍 غير معروف";
  const locationDetail = location ? formatServerLocationDetail(location) : "";
  const wsPayload = getSshWsPayloadText(domain);

  const text =
    `🔐 <b>بيانات اتصال سيرفر Mohaalamia (WebSocket):</b>\n\n` +
    `🟢 <b>حالة السيرفر:</b> ${running ? "يعمل بنجاح 🟢" : "متوقف 🔴"}\n` +
    `🗺️ <b>موقع السيرفر:</b> ${locationText}\n` +
    (locationDetail ? `${locationDetail}\n` : "") +
    `🌐 <b>الهوست (Host):</b> <code>${escapeHtml(domain)}</code>\n` +
    `🔌 <b>المنفذ (Port):</b> <code>443</code>\n` +
    `🕵️ <b>SNI:</b> <code>${escapeHtml(domain)}</code> أو <code>${FAKE_SNI_HOST}</code>\n` +
    `👤 <b>اسم المستخدم:</b> <code>${escapeHtml(creds.username)}</code>\n` +
    `🔑 <b>كلمة المرور:</b> <code>${escapeHtml(creds.password)}</code>\n\n` +
    `🌐 <b>بايلود WebSocket (HTTP 101):</b>\n` +
    `<code>${escapeHtml(wsPayload)}</code>`;

  const inlineKeyboard = [
    [{ text: "🌐 إعداد WebSocket", callback_data: "send_payload_ws" }, { text: "🏠 القائمة الرئيسية", callback_data: "main_menu" }],
    [{ text: "👤 تغيير اسم المستخدم", callback_data: "ssh_change_username" }, { text: "🔑 تغيير كلمة المرور", callback_data: "ssh_change_password" }]
  ];

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}

async function sendWsPayloadOnly(chatId: number | string) {
  const domain = getPublicDomain();
  const wsPayload = getSshWsPayloadText(domain);

  const text =
    `🌐 <b>بايلود بروتوكول WebSocket لـ Mohaalamia SSH:</b>\n\n` +
    `<code>${escapeHtml(wsPayload)}</code>\n\n` +
    `💡 <i>السيرفر يقوم بالرد التلقائي بـ <code>HTTP/1.1 101 Switching Protocols</code> وتمرير نفق الـ SSH مباشرة!</i>`;

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}

async function sendServerStatus(chatId: number | string) {
  const memUsage = process.memoryUsage();
  const freeMemGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
  const totalMemGB = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
  const uptimeHours = (process.uptime() / 3600).toFixed(1);
  const location = await getServerLocation();
  const locationText = location ? `${location.flag} ${location.countryName}` : "🌍 غير معروف";
  const locationDetail = location ? formatServerLocationDetail(location) : "";

  const activeSshCount = activeSshConnections.size;

  const statusText = `📊 <b>حالة خادم Mohaalamia SSH:</b>\n\n` +
    `🟢 <b>الخدمة:</b> Mohaalamia WebSocket TLS (Dropbear Engine)\n` +
    `📡 <b>جلسات SSH النشطة:</b> ${activeSshCount}\n` +
    `⏱️ <b>مدة تشغيل السيرفر:</b> ${uptimeHours} ساعة\n` +
    `💾 <b>الذاكرة المستخدمة:</b> ${(memUsage.rss / (1024 * 1024)).toFixed(1)} MB\n` +
    `🖥️ <b>الذاكرة الإجمالية:</b> ${freeMemGB} GB / ${totalMemGB} GB\n` +
    `🗺️ <b>موقع السيرفر:</b> ${locationText}\n` +
    (locationDetail ? `${locationDetail}\n` : "") +
    `🌐 <b>النطاق الحالي:</b> <code>${getPublicDomain()}</code>`;

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: statusText,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}

async function sendConnectedDevicesReport(chatId: number | string) {
  const sshCount = activeSshConnections.size;

  if (sshCount === 0) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "📡 <b>المتصلون الآن:</b>\n\nلا يوجد أي جهاز متصل حالياً عبر SSH.",
      parse_mode: "HTML",
      reply_markup: MAIN_REPLY_KEYBOARD
    });
    return;
  }

  let text = `📡 <b>المتصلون الآن بـ Mohaalamia SSH (${sshCount}):</b>\n\n`;
  const now = Date.now();
  let sIdx = 1;
  for (const conn of Array.from(activeSshConnections)) {
    const mins = Math.floor((now - conn.connectedAt) / 60000);
    text += `${sIdx++}. 👤 المستخدم: <b>${escapeHtml(conn.user || "مجهول")}</b> — متصل منذ ${mins} دقيقة\n`;
  }

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}

async function sendAdminsList(chatId: number | string) {
  const config = getAdminConfig();
  const primary = config.primaryAdmin || "غير محدد";
  const secondaries = config.secondaryAdmins;

  let text = `👑 <b>إدارة مشرفي البوت:</b>\n\n` +
    `🥇 <b>الأدمن الرئيسي:</b>\n• <code>${primary}</code>\n\n` +
    `🥈 <b>الآدمنز الثانويين (${secondaries.length}):</b>\n`;

  if (secondaries.length === 0) {
    text += `<i>لا يوجد أي أدمن ثانوي مضاف حالياً.</i>\n`;
  } else {
    secondaries.forEach((sec, idx) => {
      text += `${idx + 1}. 👤 <b>${escapeHtml(sec.name)}</b> - <code>${sec.id}</code>\n`;
    });
  }

  const inlineButtons: any[] = [];
  if (secondaries.length > 0) {
    secondaries.forEach(sec => {
      inlineButtons.push([{ text: `❌ حذف الثانوي: ${sec.name}`, callback_data: `del_sec_admin_${sec.id}` }]);
    });
  }

  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: inlineButtons.length > 0 ? { inline_keyboard: inlineButtons } : MAIN_REPLY_KEYBOARD
  });
}

async function registerBotCommands() {
  try {
    await telegramApi("setMyCommands", {
      commands: [
        { command: "start", description: "🏠 القائمة الرئيسية والبيانات" },
        { command: "ssh", description: "🔐 بيانات Mohaalamia SSH" },
        { command: "ws", description: "🌐 إعداد WebSocket" },
        { command: "user", description: "👤 تغيير اسم المستخدم لـ SSH" },
        { command: "pass", description: "🔑 تغيير كلمة المرور لـ SSH" },
        { command: "status", description: "📊 حالة الخدمة" },
        { command: "devices", description: "📡 الأجهزة المتصلة" },
        { command: "admins", description: "👑 المشرفون" },
        { command: "logs", description: "📝 عرض السجلات" },
        { command: "id", description: "🆔 معرف حسابك" }
      ]
    });
  } catch (err: any) {
    addLog(`Failed to register bot commands: ${err?.message || err}`);
  }
}

// -----------------------------------------------------------------------------
// Telegram Bot Message Handler
// -----------------------------------------------------------------------------
interface UserSession {
  action?: string;
  data?: any;
}
const userSessions: Record<string, UserSession> = {};

async function handleTelegramUpdate(update: any) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    const text = msg.text?.trim() || "";
    const textLower = text.toLowerCase();

    if (text === "/id" || text === "/myid" || text === "🆔 معرفي" || text === "معرف حسابي") {
      const currentConf = getAdminConfig();
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `🆔 <b>معرف حسابك (Chat ID):</b> <code>${chatId}</code>\n` +
              `👑 <b>الأدمن الرئيسي:</b> <code>${currentConf.primaryAdmin}</code>\n` +
              `👥 <b>عدد الأدمنز الثانويين:</b> ${currentConf.secondaryAdmins.length}`,
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }

    if (!isAuthorizedAdmin(userId) && !isAuthorizedAdmin(chatId)) {
      // Silently ignore any non-admin sender -- do NOT send the main menu
      // (it exposes live SSH host/username/password). This used to call
      // sendMainMenu(chatId) here by mistake, which meant ANY Telegram
      // user who messaged the bot got full access regardless of the
      // configured TELEGRAM_ADMIN_CHAT_ID.
      addLog(`[Access Denied] Ignored message from unauthorized Chat ID: ${chatId}, User ID: ${userId}`);
      return;
    }

    if (text === "/start" || text === "/menu" || text === "/help" ||
        text === "🏠 القائمة الرئيسية" || text === "القائمة الرئيسية" || text === "الرئيسية" ||
        textLower === "start" || textLower === "menu") {
      delete userSessions[chatId];
      await sendMainMenu(chatId);
      return;
    }

    if (text === "/ssh" || text === "🔐 بيانات Mohaalamia SSH" || text === "🔐 بيانات Mohaalamia SSH" || text === "SSH" || textLower === "ssh") {
      delete userSessions[chatId];
      await sendSshInfo(chatId);
      return;
    }

    if (text === "/ws" || text === "/payload_ws" || text === "/payload" || text === "🌐 إعداد WebSocket" || text === "بايلود WebSocket" ||
        text === "📄 نسخ الـ Payload" || text === "📄 الـ Payload" || text === "Payload" ||
        textLower === "ws" || textLower === "payload") {
      delete userSessions[chatId];
      await sendWsPayloadOnly(chatId);
      return;
    }

    if (text === "👤 إدارة حساب SSH" || text === "👤 تغيير اسم المستخدم" || text === "/user" || text === "تغيير اسم المستخدم") {
      userSessions[chatId] = { action: "ssh_change_username" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "👤 <b>أرسل اسم المستخدم الجديد لـ SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }

    if (text === "🔑 تغيير كلمة المرور" || text === "/pass" || text === "تغيير كلمة المرور") {
      userSessions[chatId] = { action: "ssh_change_password" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "🔑 <b>أرسل كلمة المرور الجديدة لـ SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }

    if (text === "/status" || text === "/server" || text === "📊 حالة الخدمة" || text === "حالة السيرفر") {
      await sendServerStatus(chatId);
      return;
    }

    if (text === "/devices" || text === "📡 الأجهزة المتصلة" || text === "المتصلون الآن") {
      await sendConnectedDevicesReport(chatId);
      return;
    }

    if (text === "/admins" || text === "👑 المشرفون" || text === "إدارة المشرفين") {
      await sendAdminsList(chatId);
      return;
    }

    if (text === "/logs" || text === "📝 سجلات الخدمة" || text === "سجلات الخادم") {
      const recent = escapeHtml(logs.slice(-25).join("\n"));
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `📝 <b>آخر سجلات الخادم:</b>\n\n<pre>${recent || "لا توجد سجلات بعد."}</pre>`,
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }

    // Interactive session handling
    const session = userSessions[chatId];
    if (session && session.action) {
      if (session.action === "ssh_change_username") {
        delete userSessions[chatId];
        const newUsername = text.trim();
        if (!newUsername || newUsername.length < 2) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "❌ اسم المستخدم يجب ألا يقل عن حرفين.", reply_markup: MAIN_REPLY_KEYBOARD });
          return;
        }
        const creds = getSshCredentials();
        creds.username = newUsername;
        saveSshCredentials(creds);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `✅ <b>تم تحديث اسم المستخدم لـ SSH بنجاح إلى:</b> <code>${escapeHtml(newUsername)}</code>`,
          parse_mode: "HTML",
          reply_markup: MAIN_REPLY_KEYBOARD
        });
        await sendSshInfo(chatId);
        return;
      }

      if (session.action === "ssh_change_password") {
        delete userSessions[chatId];
        const newPassword = text.trim();
        if (!newPassword || newPassword.length < 2) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "❌ كلمة المرور يجب ألا تقل عن حرفين.", reply_markup: MAIN_REPLY_KEYBOARD });
          return;
        }
        const creds = getSshCredentials();
        creds.password = newPassword;
        saveSshCredentials(creds);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `✅ <b>تم تحديث كلمة المرور لـ SSH بنجاح إلى:</b> <code>${escapeHtml(newPassword)}</code>`,
          parse_mode: "HTML",
          reply_markup: MAIN_REPLY_KEYBOARD
        });
        await sendSshInfo(chatId);
        return;
      }
    }

    await sendMainMenu(chatId);
  } else if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data;
    const chatId = cb.message?.chat?.id;
    const userId = cb.from?.id || chatId;

    await telegramApi("answerCallbackQuery", { callback_query_id: cb.id });

    // Same authorization check as the message handler -- inline buttons
    // (e.g. "change SSH password") must never be reachable by non-admins.
    if (!isAuthorizedAdmin(userId) && !isAuthorizedAdmin(chatId)) {
      addLog(`[Access Denied] Ignored callback_query from unauthorized Chat ID: ${chatId}, User ID: ${userId}`);
      return;
    }

    if (data === "cfg_ssh") {
      await sendSshInfo(chatId);
    } else if (data === "send_payload_ws") {
      await sendWsPayloadOnly(chatId);
    } else if (data === "main_menu") {
      await sendMainMenu(chatId);
    } else if (data === "show_status") {
      await sendServerStatus(chatId);
    } else if (data === "show_devices") {
      await sendConnectedDevicesReport(chatId);
    } else if (data === "ssh_change_username") {
      userSessions[chatId] = { action: "ssh_change_username" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "👤 <b>أرسل اسم المستخدم الجديد لـ SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
    } else if (data === "ssh_change_password") {
      userSessions[chatId] = { action: "ssh_change_password" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "🔑 <b>أرسل كلمة المرور الجديدة لـ SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
    } else if (data?.startsWith("del_sec_admin_")) {
      const targetId = data.replace("del_sec_admin_", "");
      const res = removeSecondaryAdmin(targetId);
      await telegramApi("sendMessage", { chat_id: chatId, text: res.message, parse_mode: "HTML", reply_markup: MAIN_REPLY_KEYBOARD });
    }
  }
}

// -----------------------------------------------------------------------------
// Webhook Setup
// -----------------------------------------------------------------------------
async function setupTelegramWebhook() {
  const token = getActiveBotTokenSafe();
  if (!token) return;

  const domain = getPublicDomain();
  if (domain === "0.0.0.0" || domain === "localhost") {
    addLog("[Telegram Webhook] Skipping setWebhook: No public domain known yet.");
    return;
  }

  const webhookUrl = `https://${domain}${TELEGRAM_WEBHOOK_PATH}`;
  const secret = getWebhookSecret();

  try {
    const res = await telegramApi("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"]
    });
    if (res?.ok) {
      addLog(`[Telegram Webhook] ✅ Webhook successfully set to: ${webhookUrl}`);
    } else {
      addLog(`[Telegram Webhook] Failed to set webhook: ${JSON.stringify(res)}`);
    }
  } catch (err: any) {
    addLog(`[Telegram Webhook] Error: ${err?.message || err}`);
  }
}

// -----------------------------------------------------------------------------
// Transparent TCP Stream Bridge to Dropbear SSH
// -----------------------------------------------------------------------------
function bridgeSocketToDropbear(socket: net.Socket | stream.Duplex | any, initialData?: Buffer, responseHeader?: string) {
  try { (socket as any).setNoDelay?.(true); } catch {}
  try { (socket as any).setTimeout?.(0); } catch {}
  try { (socket as any).setKeepAlive?.(true, 1000); } catch {}

  let bridgeClosed = false;
  const tcpSocket = net.connect({ host: "127.0.0.1", port: DROPBEAR_PORT }, () => {
    try {
      if (responseHeader) {
        socket.write(responseHeader);
      }
      if (initialData && initialData.length > 0) {
        tcpSocket.write(initialData);
      }

      socket.on("data", (chunk) => {
        if (!bridgeClosed) {
          try { tcpSocket.write(chunk); } catch {}
        }
      });

      tcpSocket.on("data", (chunk) => {
        if (!bridgeClosed) {
          try { socket.write(chunk); } catch {}
        }
      });
    } catch {
      destroyBoth();
    }
  });

  try { tcpSocket.setNoDelay(true); } catch {}
  try { tcpSocket.setTimeout(0); } catch {}
  try { tcpSocket.setKeepAlive(true, 1000); } catch {}

  const destroyBoth = () => {
    if (bridgeClosed) return;
    bridgeClosed = true;
    try { socket.destroy(); } catch {}
    try { tcpSocket.destroy(); } catch {}
  };

  tcpSocket.on("error", destroyBoth);
  socket.on("error", destroyBoth);
  tcpSocket.on("close", destroyBoth);
  socket.on("close", destroyBoth);
}

// -----------------------------------------------------------------------------
// Express Web Application
// -----------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// WebSocket Tunneling Middleware for Dropbear SSH
// (CONNECT-method / raw "direct SNI" tunneling was removed -- only a
// genuine WebSocket upgrade to SSH_WS_PATH is bridged to the SSH backend.)
app.use((req, res, next) => {
  const isWs = req.headers["upgrade"]?.toString().toLowerCase() === "websocket";
  const isWsTunnel = isWs && req.path === SSH_WS_PATH;

  if (isWsTunnel && req.path !== "/api/verify-password" && req.path !== "/api/setup-bot" && req.path !== TELEGRAM_WEBHOOK_PATH) {
    const socket = req.socket;
    if (socket && !socket.destroyed) {
      addLog(`[Tunnel-Bridge] Bridging WebSocket ${req.method} ${req.path} directly to Dropbear SSH`);
      const key = (req.headers["sec-websocket-key"] as string) || crypto.randomBytes(16).toString("base64");
      const digest = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      const resp = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${digest}\r\n\r\n`;
      bridgeSocketToDropbear(socket, undefined, resp);
      return;
    }
  }
  next();
});

// Auto-detect public host from incoming HTTP requests
app.use((req, res, next) => {
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers["host"];
  if (forwardedHost) {
    const hostStr = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    const cleanHost = hostStr.split(",")[0].trim().split(":")[0];
    if (isLikelyPublicHost(cleanHost) && cleanHost !== cachedPublicHost) {
      rememberPublicHost(cleanHost);
      setupTelegramWebhook();
    }
  }
  next();
});

// Telegram Webhook endpoint
app.post(TELEGRAM_WEBHOOK_PATH, async (req, res) => {
  res.status(200).send({ ok: true });
  const update = req.body;
  if (!update) return;

  const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
  const expectedSecret = getWebhookSecret();
  if (headerSecret && headerSecret !== expectedSecret) {
    addLog(`[Telegram Webhook] Warning: Secret token mismatch`);
  }

  try {
    await handleTelegramUpdate(update);
  } catch (err: any) {
    addLog(`[Telegram Update Error] ${err?.message || err}`);
  }
});

// Verify Murad Setup Password endpoint
app.post("/api/verify-password", (req, res) => {
  const { password } = req.body;
  if (password === MURAD_SETUP_PASSWORD) {
    return res.json({ success: true, message: "كلمة المرور صحيحة." });
  }
  return res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة." });
});

// Setup Murad Bot endpoint (one-time)
app.post("/api/setup-bot", (req, res) => {
  const { botId, botToken, password } = req.body;
  if (password !== MURAD_SETUP_PASSWORD) {
    return res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة." });
  }
  if (!botId || !botToken) {
    return res.status(400).json({ success: false, message: "معرف الأدمن وتوكن البوت مطلوبان." });
  }
  const saved = saveMuradBotConfigOnce(String(botId).trim(), String(botToken).trim());
  if (saved) {
    setupTelegramWebhook();
    registerBotCommands();
    return res.json({ success: true, message: "تم حفظ إعدادات البوت بنجاح!" });
  } else {
    return res.status(400).json({ success: false, message: "تم إعداد البوت مسبقاً بالفعل." });
  }
});

// Root Endpoint - Setup Page if not configured, or JSON Status if configured
app.get("/", (req, res) => {
  const domain = getPublicDomain();
  const botToken = getActiveBotTokenSafe();

  if (botToken) {
    return res.status(200).send(`<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>تم الاتصال بنجاح</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#ecfdf5;font-family:system-ui, sans-serif}.card{text-align:center;padding:42px 28px;border:1px solid #14532d;border-radius:22px;background:#0f1f2e;box-shadow:0 20px 50px #0005}.ok{font-size:54px;color:#4ade80}h1{margin:12px 0;font-size:28px}p{color:#a7f3d0}</style></head><body><main class="card"><div class="ok">✓</div><h1>تم الاتصال بنجاح</h1><p>الخدمة تعمل بشكل صحيح.</p></main></body></html>`);
  }

  // If bot is not configured yet, show the password-gated setup page
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>إعداد خادم Mohaalamia SSH</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Cairo', sans-serif; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen p-4 md:p-8 flex items-center justify-center">
  <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
    
    <!-- Step 1: Password Lock Screen -->
    <div id="stepPassword" class="space-y-6">
      <div class="text-center space-y-2">
        <div class="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-3xl">🔒</div>
        <h1 class="text-2xl font-extrabold text-white">خادم Mohaalamia SSH</h1>
        <p class="text-slate-400 text-sm">أدخل كلمة المرور للمتابعة وضبط الإعدادات</p>
      </div>

      <form id="authForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">🔑 كلمة المرور:</label>
          <input type="password" id="authPassword" required placeholder="أدخل كلمة المرور..." class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500" autofocus />
        </div>

        <div id="authStatus" class="hidden text-sm p-3 rounded-xl"></div>

        <button type="submit" id="authBtn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition shadow-lg shadow-emerald-900/30">
          دخول
        </button>
      </form>
    </div>

    <!-- Step 2: Bot Setup Form (Revealed after password verification) -->
    <div id="stepSetup" class="hidden space-y-6">
      <div class="text-center space-y-2">
        <div class="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-3xl">🤖</div>
        <h1 class="text-2xl font-extrabold text-white">إعداد بوت تلجرام</h1>
        <p class="text-slate-400 text-sm">أدخل توكن البوت ومعرف الأدمن للربط مع السيرفر</p>
      </div>

      <form id="setupForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">🤖 توكن البوت (Bot Token):</label>
          <input type="text" id="botToken" required placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWXyz" class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">👑 آيدي الأدمن الرئيسي (Chat ID):</label>
          <input type="text" id="botId" required placeholder="1772564386" class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
        </div>

        <div id="setupStatus" class="hidden text-sm p-3 rounded-xl"></div>

        <button type="submit" id="setupBtn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition shadow-lg shadow-emerald-900/30">
          حفظ وتفعيل السيرفر
        </button>
      </form>

      <div class="text-center text-xs text-slate-500 border-t border-slate-800/80 pt-4">
        بعد الحفظ، سيتحول هذا الرابط تلقائياً إلى حالة الـ JSON وسيعمل البوت فوراً في تلجرام.
      </div>
    </div>

  </div>

  <script>
    let verifiedPassword = '';

    // Step 1: Handle password verification
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = document.getElementById('authPassword').value.trim();
      const authStatus = document.getElementById('authStatus');
      const authBtn = document.getElementById('authBtn');

      authStatus.className = 'text-sm p-3 rounded-xl bg-slate-800 text-slate-200';
      authStatus.textContent = 'جاري التحقق...';
      authStatus.classList.remove('hidden');
      authBtn.disabled = true;

      try {
        const res = await fetch('/api/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          verifiedPassword = pass;
          document.getElementById('stepPassword').classList.add('hidden');
          document.getElementById('stepSetup').classList.remove('hidden');
        } else {
          authStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
          authStatus.textContent = '❌ ' + (data.message || 'كلمة المرور غير صحيحة.');
          authBtn.disabled = false;
        }
      } catch (err) {
        authStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
        authStatus.textContent = '❌ تعذر الاتصال بالسيرفر.';
        authBtn.disabled = false;
      }
    });

    // Step 2: Handle saving Bot Token & Admin ID
    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const botToken = document.getElementById('botToken').value.trim();
      const botId = document.getElementById('botId').value.trim();
      const setupStatus = document.getElementById('setupStatus');
      const setupBtn = document.getElementById('setupBtn');

      setupStatus.className = 'text-sm p-3 rounded-xl bg-slate-800 text-slate-200';
      setupStatus.textContent = 'جاري الحفظ والربط مع تلجرام...';
      setupStatus.classList.remove('hidden');
      setupBtn.disabled = true;

      try {
        const res = await fetch('/api/setup-bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botToken, botId, password: verifiedPassword })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setupStatus.className = 'text-sm p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-300';
          setupStatus.textContent = '✅ ' + data.message + ' جاري التحويل...';
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        } else {
          setupStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
          setupStatus.textContent = '❌ ' + (data.message || 'حدث خطأ أثناء الحفظ.');
          setupBtn.disabled = false;
        }
      } catch (err) {
        setupStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
        setupStatus.textContent = '❌ تعذر الاتصال بالسيرفر.';
        setupBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// -----------------------------------------------------------------------------
// HTTP Server & Reverse Proxy for Dropbear SSH (WebSocket only)
// -----------------------------------------------------------------------------
const server = http.createServer(app);

// Zero out all HTTP timeouts to prevent disconnections
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.maxConnections = 10000;

// Malformed / non-HTTP requests are rejected outright -- previously this
// handler blindly bridged ANY unparseable raw packet (and any bare
// CONNECT/GET/POST/HEAD line) straight to the SSH backend, which is what
// powered the "Direct SSL/TLS SNI" bypass. Only the real WebSocket
// upgrade path below is supported now.
server.on("clientError", (_err: any, socket: net.Socket) => {
  try { socket.destroy(); } catch {}
});

// WebSocket Upgrade Handler: direct transparent TCP stream bridge to Dropbear SSH
server.on("upgrade", (req, socket, head) => {
  addLog(`[Upgrade-Bridge] Intercepted WebSocket upgrade request, responding 101 Switching Protocols & bridging`);
  const key = (req.headers["sec-websocket-key"] as string) || crypto.randomBytes(16).toString("base64");
  const digest = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${digest}`,
    "\r\n"
  ].join("\r\n");

  bridgeSocketToDropbear(socket, head && head.length ? head : undefined, responseHeaders);
});

// -----------------------------------------------------------------------------
// Server Bootstrap
// -----------------------------------------------------------------------------
startSshServer();

server.listen(PORT, "0.0.0.0", () => {
  addLog(`[HTTP Server] Listening on 0.0.0.0:${PORT}`);
  setupTelegramWebhook();
  registerBotCommands();
});
