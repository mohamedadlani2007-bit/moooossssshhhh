var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_http = __toESM(require("http"), 1);
var import_net = __toESM(require("net"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_os = __toESM(require("os"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_ssh2 = __toESM(require("ssh2"), 1);
var import_undici = require("undici");
var SshServer = import_ssh2.default.Server || import_ssh2.default.default?.Server || import_ssh2.default;
(0, import_undici.setGlobalDispatcher)(new import_undici.Agent({
  connections: 512,
  pipelining: 1,
  keepAliveTimeout: 3e4,
  keepAliveMaxTimeout: 6e4
}));
var PORT = Number(process.env.PORT) || 3e3;
var DROPBEAR_PORT = 10093;
var SSH_WS_PATH = process.env.SSH_WS_PATH || "/app70";
var SSH_WS_PORT = Number(process.env.SSH_WS_PORT) || 443;
var FAKE_SNI_HOST = "";
var DATA_DIR = process.env.DATA_DIR ? process.env.DATA_DIR : process.cwd();
try {
  if (!import_fs.default.existsSync(DATA_DIR)) import_fs.default.mkdirSync(DATA_DIR, { recursive: true });
} catch {
}
var logs = [];
function addLog(message) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
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
function escapeHtml(str) {
  if (str === null || str === void 0) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var detectedHostFilePath = import_path.default.join(DATA_DIR, "detected-host.json");
var cachedPublicHost = null;
function isLikelyPublicHost(h) {
  if (!h) return false;
  const host = h.split(":")[0].toLowerCase();
  if (host === "localhost" || host === "0.0.0.0") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (!host.includes(".")) return false;
  return true;
}
function rememberPublicHost(host) {
  if (!isLikelyPublicHost(host) || host === cachedPublicHost) return;
  cachedPublicHost = host;
  try {
    import_fs.default.writeFileSync(detectedHostFilePath, JSON.stringify({ host, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2), "utf8");
  } catch {
  }
  addLog(`Auto-detected public domain: ${host}`);
}
function loadPersistedHost() {
  try {
    if (import_fs.default.existsSync(detectedHostFilePath)) {
      const data = JSON.parse(import_fs.default.readFileSync(detectedHostFilePath, "utf8"));
      if (data?.host && isLikelyPublicHost(data.host)) {
        cachedPublicHost = data.host;
      }
    }
  } catch {
  }
}
loadPersistedHost();
async function detectCloudRunHostFromMetadata() {
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
  } catch (e) {
    addLog(`Metadata-server domain auto-detection failed: ${e?.message || e}`);
    return null;
  }
}
detectCloudRunHostFromMetadata().then((detected) => {
  if (detected) rememberPublicHost(detected);
});
function getPublicDomain() {
  const configuredHost = process.env.PUBLIC_HOST || process.env.APP_URL;
  if (configuredHost) {
    try {
      const u = new URL(configuredHost);
      return u.hostname;
    } catch {
      return configuredHost.replace(/^https?:\/\//, "").split("/")[0];
    }
  }
  if (cachedPublicHost) return cachedPublicHost;
  return "0.0.0.0";
}
function countryCodeToFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "\u{1F30D}";
  const codePoints = countryCode.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
function countryCodeToArabicName(code, fallback) {
  if (!code || code.length !== 2) return fallback;
  try {
    const dn = new Intl.DisplayNames(["ar"], { type: "region" });
    return dn.of(code.toUpperCase()) || fallback;
  } catch {
    return fallback;
  }
}
var cachedServerLocation = null;
var cachedServerLocationAt = 0;
var SERVER_LOCATION_CACHE_MS = 6 * 60 * 60 * 1e3;
function formatServerLocationDetail(loc) {
  const parts = [];
  if (loc.ip) parts.push(`\u{1F310} IP: <code>${escapeHtml(loc.ip)}</code>`);
  if (loc.city) parts.push(`\u{1F3D9}\uFE0F ${escapeHtml(loc.city)}`);
  if (loc.isp) parts.push(`\u{1F6F0}\uFE0F ${escapeHtml(loc.isp)}`);
  return parts.join("  |  ");
}
async function fetchServerLocation() {
  try {
    const res = await fetch("http://ip-api.com/json/?fields=status,country,countryCode,city,isp,query", { signal: AbortSignal.timeout(5e3) });
    const json = await res.json();
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
  } catch {
  }
  return null;
}
async function getServerLocation() {
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
var adminFilePath = import_path.default.join(DATA_DIR, "admin.json");
var muradBotFilePath = import_path.default.join(DATA_DIR, "murad-bot.json");
var MURAD_SETUP_PASSWORD = process.env.MURAD_SETUP_PASSWORD || "mooh2026";
function getMuradBotConfig() {
  if (!import_fs.default.existsSync(muradBotFilePath)) return null;
  try {
    const data = JSON.parse(import_fs.default.readFileSync(muradBotFilePath, "utf8"));
    if (data && data.botId && data.botToken) return data;
    return null;
  } catch {
    return null;
  }
}
function saveMuradBotConfigOnce(botId, botToken) {
  if (getMuradBotConfig()) return false;
  const config = { botId, botToken, savedAt: (/* @__PURE__ */ new Date()).toISOString() };
  try {
    const fd = import_fs.default.openSync(muradBotFilePath, "wx");
    import_fs.default.writeFileSync(fd, JSON.stringify(config, null, 2), "utf8");
    import_fs.default.closeSync(fd);
    addLog(`[Murad Bot] Config saved permanently (bot id ${botId}).`);
    return true;
  } catch {
    return false;
  }
}
function getActiveBotTokenSafe() {
  const murad = getMuradBotConfig();
  if (murad && murad.botToken) return murad.botToken;
  return process.env.TELEGRAM_BOT_TOKEN || null;
}
var TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";
function getWebhookSecret() {
  const token = getActiveBotTokenSafe() || "not-configured";
  return import_crypto.default.createHash("sha256").update(token).digest("hex").slice(0, 32);
}
function getPrimaryAdminId() {
  const murad = getMuradBotConfig();
  if (murad && murad.botId) return murad.botId;
  return process.env.TELEGRAM_ADMIN_CHAT_ID || "1772564386";
}
function getAdminConfig() {
  const primaryId = getPrimaryAdminId();
  const defaults = { primaryAdmin: primaryId, secondaryAdmins: [] };
  if (import_fs.default.existsSync(adminFilePath)) {
    try {
      const data = JSON.parse(import_fs.default.readFileSync(adminFilePath, "utf8"));
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
function saveAdminConfig(data) {
  try {
    data.primaryAdmin = getPrimaryAdminId();
    data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    import_fs.default.writeFileSync(adminFilePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    addLog(`Failed to save admin config: ${err?.message || err}`);
  }
}
function removeSecondaryAdmin(targetId) {
  targetId = String(targetId).trim();
  const config = getAdminConfig();
  if (config.primaryAdmin === targetId) return { success: false, message: "\u{1F6AB} \u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0630\u0641 \u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A." };
  const initial = config.secondaryAdmins.length;
  config.secondaryAdmins = config.secondaryAdmins.filter((a) => a.id !== targetId);
  if (config.secondaryAdmins.length === initial) return { success: false, message: "\u274C \u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u062B\u0627\u0646\u0648\u064A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F." };
  saveAdminConfig(config);
  return { success: true, message: `\u2705 \u062A\u0645 \u062D\u0630\u0641 \u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u062B\u0627\u0646\u0648\u064A (ID: <code>${targetId}</code>).` };
}
function isAuthorizedAdmin(chatId) {
  const idStr = String(chatId).trim();
  const config = getAdminConfig();
  if (!config.primaryAdmin) return false;
  if (config.primaryAdmin === idStr) return true;
  if (config.secondaryAdmins.some((a) => a.id === idStr)) return true;
  return false;
}
var sshServerInstance = null;
var activeSshConnections = /* @__PURE__ */ new Set();
var inMemorySshCredentials = null;
function getSshCredentials() {
  if (inMemorySshCredentials) return inMemorySshCredentials;
  return {
    username: process.env.SSH_USERNAME || "mohaalamia",
    password: process.env.SSH_PASSWORD || "mooh2026"
  };
}
function saveSshCredentials(creds) {
  inMemorySshCredentials = { username: creds.username, password: creds.password };
  addLog(`[SSH] Updated in-memory credentials for user '${creds.username}'.`);
  for (const conn of Array.from(activeSshConnections)) {
    try {
      conn.client.end();
    } catch {
    }
    try {
      conn.client.destroy();
    } catch {
    }
  }
  activeSshConnections.clear();
}
function generateRandomSshCredentials() {
  const suffix = import_crypto.default.randomBytes(4).toString("hex");
  const password = import_crypto.default.randomBytes(9).toString("base64url").slice(0, 12);
  return { username: `mg_${suffix}`, password };
}
async function createPrivateSsh(chatId) {
  const creds = generateRandomSshCredentials();
  saveSshCredentials(creds);
  const domain = getPublicDomain();
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: `💠 <b>محمد العالمية</b>\n\n✅ <b>تم إنشاء حساب SSH عشوائي</b>\n\n🌐 <b>Host:</b> <code>${escapeHtml(domain)}</code>\n🔌 <b>Port:</b> <code>${SSH_WS_PORT}</code>\n🧭 <b>Path:</b> <code>${SSH_WS_PATH}</code>\n👤 <b>Username:</b> <code>${escapeHtml(creds.username)}</code>\n🔑 <b>Password:</b> <code>${escapeHtml(creds.password)}</code>\n\n⚠️ هذا الحساب يستبدل بيانات الدخول السابقة لأن الخادم الحالي يدعم حساب SSH نشطًا واحدًا فقط.`,
    parse_mode: "HTML"
  });
}
function getOrCreateSshHostKey() {
  const keyPath = import_path.default.join(DATA_DIR, "ssh_host_rsa_key.pem");
  if (import_fs.default.existsSync(keyPath)) {
    try {
      const key = import_fs.default.readFileSync(keyPath, "utf8");
      if (key && key.includes("PRIVATE KEY")) return key;
    } catch {
    }
  }
  try {
    const { privateKey } = import_crypto.default.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });
    try {
      import_fs.default.writeFileSync(keyPath, privateKey, { mode: 384 });
      addLog(`[SSH] Generated new RSA host key.`);
    } catch {
    }
    return privateKey;
  } catch (err) {
    const { privateKey } = import_crypto.default.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });
    return privateKey;
  }
}
var SSH_BANNER_TEXT = `<div style="text-align: center; font-family: Arial, sans-serif; line-height: 1.8; padding: 15px; border-radius: 10px; background-color: #111827; border: 2px solid #00FFFF;">
  <h2 style="color: #00FFFF; margin-bottom: 10px;">💠 Mohamed Global 💠</h2>
  <p style="color: #FF00FF; margin: 6px 0;"><strong>محمد العالمية</strong></p>
  <p style="color: #FFD700; margin: 6px 0;"><strong>⚡ Fast</strong></p>
  <p style="color: #00FF00; margin: 6px 0;"><strong>🎮 Gaming</strong></p>
  <p style="color: #00BFFF; margin: 6px 0;"><strong>🔐 Secure</strong></p>
</div>`;
function checkSshAuth(user, pass) {
  const creds = getSshCredentials();
  return user === creds.username && pass === creds.password;
}
function startSshServer() {
  if (sshServerInstance) return;
  const hostKey = getOrCreateSshHostKey();
  const server2 = new SshServer({
    hostKeys: [hostKey],
    banner: SSH_BANNER_TEXT
  }, (client) => {
    let authUser = "";
    try {
      if (typeof client.banner === "function") {
        client.banner(SSH_BANNER_TEXT);
      }
    } catch {
    }
    client.on("authentication", (ctx) => {
      const user = ctx.username;
      try {
        if (typeof client.banner === "function") {
          client.banner(SSH_BANNER_TEXT);
        }
      } catch {
      }
      if (ctx.method === "password") {
        if (checkSshAuth(user, ctx.password)) {
          authUser = user;
          addLog(`[SSH] \u2705 Accepted password login for user '${user}'.`);
          ctx.accept();
          return;
        }
      }
      if (ctx.method === "keyboard-interactive") {
        ctx.prompt([{ prompt: "Password: ", echo: false }], (answers) => {
          if (answers.length > 0 && checkSshAuth(user, answers[0])) {
            authUser = user;
            addLog(`[SSH] \u2705 Accepted keyboard-interactive login for user '${user}'.`);
            ctx.accept();
          } else {
            addLog(`[SSH] \u274C Rejected keyboard-interactive login for user '${user}'.`);
            ctx.reject();
          }
        });
        return;
      }
      addLog(`[SSH] \u274C Rejected auth method '${ctx.method}' for user '${user}'.`);
      ctx.reject(["password", "keyboard-interactive"]);
    });
    const handleTcpIp = (accept, reject, info) => {
      const destHost = info?.destIP || info?.dstIP || info?.destHost || "127.0.0.1";
      const destPort = info?.destPort || info?.dstPort || info?.port || 80;
      let stream;
      try {
        stream = accept();
      } catch {
        if (reject) reject();
        return;
      }
      if (!stream) return;
      let closed = false;
      const proxySocket = import_net.default.connect({ host: destHost, port: destPort });
      try {
        proxySocket.setNoDelay(true);
      } catch {
      }
      try {
        proxySocket.setTimeout(0);
      } catch {
      }
      try {
        proxySocket.setKeepAlive(true, 1e3);
      } catch {
      }
      try {
        stream.setTimeout?.(0);
      } catch {
      }
      stream.pipe(proxySocket);
      proxySocket.pipe(stream);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        try {
          stream.end();
        } catch {
        }
        try {
          proxySocket.destroy();
        } catch {
        }
      };
      proxySocket.on("error", cleanup);
      stream.on("error", cleanup);
      proxySocket.on("close", cleanup);
      stream.on("close", cleanup);
    };
    client.on("tcpip", handleTcpIp);
    client.on("direct-tcpip", handleTcpIp);
    client.on("request", (accept) => {
      if (accept) {
        try {
          accept();
        } catch {
        }
      }
    });
    client.on("tcpip-forward", (accept) => {
      if (accept) {
        try {
          accept();
        } catch {
        }
      }
    });
    client.on("cancel-tcpip-forward", (accept) => {
      if (accept) {
        try {
          accept();
        } catch {
        }
      }
    });
    client.on("session", (accept) => {
      let session;
      try {
        session = accept();
      } catch {
        return;
      }
      if (!session) return;
      session.on("pty", (accept2) => {
        if (accept2) {
          try {
            accept2();
          } catch {
          }
        }
      });
      session.on("window-change", (accept2) => {
        if (accept2) {
          try {
            accept2();
          } catch {
          }
        }
      });
      session.on("env", (accept2) => {
        if (accept2) {
          try {
            accept2();
          } catch {
          }
        }
      });
      session.on("subsystem", (accept2) => {
        if (accept2) {
          try {
            accept2();
          } catch {
          }
        }
      });
      session.on("shell", (accept2) => {
        const stream = accept2();
        if (!stream) return;
        try {
          stream.write(SSH_BANNER_TEXT + "\r\n\r\nConnected as " + authUser + "\r\n\r\nmohaalamia-ssh$ ");
        } catch {
        }
        stream.on("data", (d) => {
          const s = d.toString();
          if (s.includes("\r") || s.includes("\n")) {
            try {
              stream.write("\r\nmohaalamia-ssh$ ");
            } catch {
            }
          }
        });
      });
      session.on("exec", (accept2) => {
        const stream = accept2();
        if (!stream) return;
        try {
          stream.write(SSH_BANNER_TEXT + "\r\n");
          stream.exit(0);
          stream.end();
        } catch {
        }
      });
    });
    const pingInterval = setInterval(() => {
      try {
        if (client._protocol) {
          if (typeof client._protocol.ping === "function") {
            client._protocol.ping((_err) => {
            });
          }
          if (typeof client._protocol.sendGlobalRequest === "function") {
            client._protocol.sendGlobalRequest("keepalive@openssh.com", true, (_err) => {
            });
          }
        }
        if (typeof client.ping === "function") {
          client.ping((_err) => {
          });
        }
      } catch {
      }
    }, 1500);
    const minuteRefreshInterval = setInterval(() => {
      try {
        connInfo.lastSeen = Date.now();
        if (client._protocol && typeof client._protocol.sendGlobalRequest === "function") {
          client._protocol.sendGlobalRequest("keepalive@openssh.com", false, (_err) => {
          });
          client._protocol.sendGlobalRequest("hostkeys-prove-00@openssh.com", false, (_err) => {
          });
        }
        addLog(`[SSH-Keepalive] \u{1F504} Refreshed active keepalive session for ${authUser}`);
      } catch {
      }
    }, 6e4);
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
  server2.listen(DROPBEAR_PORT, "127.0.0.1", () => {
    addLog(`[SSH] \u2705 Mohaalamia SSH Server listening on 127.0.0.1:${DROPBEAR_PORT}`);
  });
  server2.on("error", (err) => {
    addLog(`[SSH] Server error: ${err?.message || err}`);
  });
  sshServerInstance = server2;
}
function getSshWsPayloadText(domain) {
  return `GET ${SSH_WS_PATH} HTTP/1.1[crlf]Host: ${domain}[crlf]Connection: Upgrade[crlf]Upgrade: websocket[crlf]User-Agent: MohamedGlobalVPN/1.0[crlf][crlf]`;
}
async function telegramApi(method, payload) {
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
    const json = await res.json();
    if (json && !json.ok) {
      addLog(`Telegram API (${method}) ok=false: ${json.description || JSON.stringify(json)}`);
    }
    return json;
  } catch (err) {
    addLog(`Telegram API Error (${method}): ${err?.message || err}`);
    return null;
  }
}
var MAIN_REPLY_KEYBOARD = {
  keyboard: [[{ text: "➕ إنشاء SSH" }]],
  resize_keyboard: true,
  is_persistent: true
};
async function sendMainMenu(chatId) {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: "💠 <b>محمد العالمية</b>\n\nاضغط الزر بالأسفل لإنشاء SSH.",
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}
async function sendSshInfo(chatId) {
  const domain = getPublicDomain();
  const creds = getSshCredentials();
  const running = !!sshServerInstance;
  const location = await getServerLocation();
  const locationText = location ? `${location.flag} ${location.countryName}` : "\u{1F30D} \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641";
  const locationDetail = location ? formatServerLocationDetail(location) : "";
  const wsPayload = getSshWsPayloadText(domain);
  const text = `\u{1F510} <b>\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u062A\u0635\u0627\u0644 \u0633\u064A\u0631\u0641\u0631 Mohaalamia (WebSocket):</b>

\u{1F7E2} <b>\u062D\u0627\u0644\u0629 \u0627\u0644\u0633\u064A\u0631\u0641\u0631:</b> ${running ? "\u064A\u0639\u0645\u0644 \u0628\u0646\u062C\u0627\u062D \u{1F7E2}" : "\u0645\u062A\u0648\u0642\u0641 \u{1F534}"}
\u{1F5FA}\uFE0F <b>\u0645\u0648\u0642\u0639 \u0627\u0644\u0633\u064A\u0631\u0641\u0631:</b> ${locationText}
` + (locationDetail ? `${locationDetail}
` : "") + `\u{1F310} <b>\u0627\u0644\u0647\u0648\u0633\u062A (Host):</b> <code>${escapeHtml(domain)}</code>
\u{1F50C} <b>\u0627\u0644\u0645\u0646\u0641\u0630 (Port):</b> <code>443</code>
\u{1F575}\uFE0F <b>SNI:</b> <code>${escapeHtml(domain)}</code> \u0623\u0648 <code>${FAKE_SNI_HOST}</code>
\u{1F464} <b>\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645:</b> <code>${escapeHtml(creds.username)}</code>
\u{1F511} <b>\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631:</b> <code>${escapeHtml(creds.password)}</code>

\u{1F310} <b>\u0628\u0627\u064A\u0644\u0648\u062F WebSocket (HTTP 101):</b>
<code>${escapeHtml(wsPayload)}</code>`;
  const inlineKeyboard = [
    [{ text: "➕ إنشاء SSH", callback_data: "create_private_ssh" }]
  ];
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: inlineKeyboard }
  });
}
async function sendWsPayloadOnly(chatId) {
  const domain = getPublicDomain();
  const wsPayload = getSshWsPayloadText(domain);
  const text = `\u{1F310} <b>\u0628\u0627\u064A\u0644\u0648\u062F \u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 WebSocket \u0644\u0640 Mohaalamia SSH:</b>

<code>${escapeHtml(wsPayload)}</code>

\u{1F4A1} <i>\u0627\u0644\u0633\u064A\u0631\u0641\u0631 \u064A\u0642\u0648\u0645 \u0628\u0627\u0644\u0631\u062F \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A \u0628\u0640 <code>HTTP/1.1 101 Switching Protocols</code> \u0648\u062A\u0645\u0631\u064A\u0631 \u0646\u0641\u0642 \u0627\u0644\u0640 SSH \u0645\u0628\u0627\u0634\u0631\u0629!</i>`;
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}
async function sendServerStatus(chatId) {
  const memUsage = process.memoryUsage();
  const freeMemGB = (import_os.default.freemem() / (1024 * 1024 * 1024)).toFixed(2);
  const totalMemGB = (import_os.default.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
  const uptimeHours = (process.uptime() / 3600).toFixed(1);
  const location = await getServerLocation();
  const locationText = location ? `${location.flag} ${location.countryName}` : "\u{1F30D} \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641";
  const locationDetail = location ? formatServerLocationDetail(location) : "";
  const activeSshCount = activeSshConnections.size;
  const statusText = `\u{1F4CA} <b>\u062D\u0627\u0644\u0629 \u062E\u0627\u062F\u0645 Mohaalamia SSH:</b>

\u{1F7E2} <b>\u0627\u0644\u062E\u062F\u0645\u0629:</b> Mohaalamia WebSocket TLS (Dropbear Engine)
\u{1F4E1} <b>\u062C\u0644\u0633\u0627\u062A SSH \u0627\u0644\u0646\u0634\u0637\u0629:</b> ${activeSshCount}
\u23F1\uFE0F <b>\u0645\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0633\u064A\u0631\u0641\u0631:</b> ${uptimeHours} \u0633\u0627\u0639\u0629
\u{1F4BE} <b>\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629:</b> ${(memUsage.rss / (1024 * 1024)).toFixed(1)} MB
\u{1F5A5}\uFE0F <b>\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A\u0629:</b> ${freeMemGB} GB / ${totalMemGB} GB
\u{1F5FA}\uFE0F <b>\u0645\u0648\u0642\u0639 \u0627\u0644\u0633\u064A\u0631\u0641\u0631:</b> ${locationText}
` + (locationDetail ? `${locationDetail}
` : "") + `\u{1F310} <b>\u0627\u0644\u0646\u0637\u0627\u0642 \u0627\u0644\u062D\u0627\u0644\u064A:</b> <code>${getPublicDomain()}</code>`;
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: statusText,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}
async function sendConnectedDevicesReport(chatId) {
  const sshCount = activeSshConnections.size;
  if (sshCount === 0) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "\u{1F4E1} <b>\u0627\u0644\u0645\u062A\u0635\u0644\u0648\u0646 \u0627\u0644\u0622\u0646:</b>\n\n\u0644\u0627 \u064A\u0648\u062C\u062F \u0623\u064A \u062C\u0647\u0627\u0632 \u0645\u062A\u0635\u0644 \u062D\u0627\u0644\u064A\u0627\u064B \u0639\u0628\u0631 SSH.",
      parse_mode: "HTML",
      reply_markup: MAIN_REPLY_KEYBOARD
    });
    return;
  }
  let text = `\u{1F4E1} <b>\u0627\u0644\u0645\u062A\u0635\u0644\u0648\u0646 \u0627\u0644\u0622\u0646 \u0628\u0640 Mohaalamia SSH (${sshCount}):</b>

`;
  const now = Date.now();
  let sIdx = 1;
  for (const conn of Array.from(activeSshConnections)) {
    const mins = Math.floor((now - conn.connectedAt) / 6e4);
    text += `${sIdx++}. \u{1F464} \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645: <b>${escapeHtml(conn.user || "\u0645\u062C\u0647\u0648\u0644")}</b> \u2014 \u0645\u062A\u0635\u0644 \u0645\u0646\u0630 ${mins} \u062F\u0642\u064A\u0642\u0629
`;
  }
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}
async function sendAdminsList(chatId) {
  const config = getAdminConfig();
  const primary = config.primaryAdmin || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F";
  const secondaries = config.secondaryAdmins;
  let text = `\u{1F451} <b>\u0625\u062F\u0627\u0631\u0629 \u0645\u0634\u0631\u0641\u064A \u0627\u0644\u0628\u0648\u062A:</b>

\u{1F947} <b>\u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A:</b>
\u2022 <code>${primary}</code>

\u{1F948} <b>\u0627\u0644\u0622\u062F\u0645\u0646\u0632 \u0627\u0644\u062B\u0627\u0646\u0648\u064A\u064A\u0646 (${secondaries.length}):</b>
`;
  if (secondaries.length === 0) {
    text += `<i>\u0644\u0627 \u064A\u0648\u062C\u062F \u0623\u064A \u0623\u062F\u0645\u0646 \u062B\u0627\u0646\u0648\u064A \u0645\u0636\u0627\u0641 \u062D\u0627\u0644\u064A\u0627\u064B.</i>
`;
  } else {
    secondaries.forEach((sec, idx) => {
      text += `${idx + 1}. \u{1F464} <b>${escapeHtml(sec.name)}</b> - <code>${sec.id}</code>
`;
    });
  }
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: MAIN_REPLY_KEYBOARD
  });
}
async function registerBotCommands() {
  try {
    await telegramApi("setMyCommands", {
      commands: []
    });
  } catch (err) {
    addLog(`Failed to register bot commands: ${err?.message || err}`);
  }
}
var userSessions = {};
async function handleTelegramUpdate(update) {
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from?.id || chatId;
    const text = msg.text?.trim() || "";
    const textLower = text.toLowerCase();
    if (text === "/id" || text === "/myid" || text === "\u{1F194} \u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628\u064A" || text === "\u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628\u064A") {
      const currentConf = getAdminConfig();
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u{1F194} <b>\u0645\u0639\u0631\u0641 \u062D\u0633\u0627\u0628\u0643 (Chat ID):</b> <code>${chatId}</code>
\u{1F451} <b>\u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A:</b> <code>${currentConf.primaryAdmin}</code>
\u{1F465} <b>\u0639\u062F\u062F \u0627\u0644\u0623\u062F\u0645\u0646\u0632 \u0627\u0644\u062B\u0627\u0646\u0648\u064A\u064A\u0646:</b> ${currentConf.secondaryAdmins.length}`,
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }
    if (!isAuthorizedAdmin(userId) && !isAuthorizedAdmin(chatId)) {
      addLog(`[Access Denied] Ignored message from unauthorized Chat ID: ${chatId}, User ID: ${userId}`);
      return;
    }
    if (text === "/start" || text === "/menu" || text === "/help" || text === "\u{1F3E0} \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629" || text === "\u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629" || text === "\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629" || textLower === "start" || textLower === "menu") {
      delete userSessions[chatId];
      await sendMainMenu(chatId);
      return;
    }
    if (text === "/ssh" || text === "\u{1F510} بيانات Mohaalamia SSH" || text === "\u{1F510} \u0628\u064A\u0627\u0646\u0627\u062A SSH" || text === "SSH" || textLower === "ssh") {
      delete userSessions[chatId];
      await sendSshInfo(chatId);
      return;
    }
    if (text === "/ws" || text === "/payload_ws" || text === "/payload" || text === "\u{1F310} إعداد WebSocket" || text === "\u0628\u0627\u064A\u0644\u0648\u062F WebSocket" || text === "\u{1F4C4} \u0646\u0633\u062E \u0627\u0644\u0640 Payload" || text === "\u{1F4C4} \u0627\u0644\u0640 Payload" || text === "Payload" || textLower === "ws" || textLower === "payload") {
      delete userSessions[chatId];
      await sendWsPayloadOnly(chatId);
      return;
    }
    if (text === "\u{1F464} \u062A\u063A\u064A\u064A\u0631 \u064A\u0648\u0632\u0631 \u0648\u0628\u0627\u0633\u0648\u0631\u062F SSH" || text === "\u{1F464} \u062A\u063A\u064A\u064A\u0631 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645" || text === "/user" || text === "\u062A\u063A\u064A\u064A\u0631 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645") {
      userSessions[chatId] = { action: "ssh_change_username" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u{1F464} <b>\u0623\u0631\u0633\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0640 SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }
    if (text === "\u{1F511} \u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631" || text === "/pass" || text === "\u062A\u063A\u064A\u064A\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631") {
      userSessions[chatId] = { action: "ssh_change_password" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u{1F511} <b>\u0623\u0631\u0633\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0644\u0640 SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }
    if (text === "/status" || text === "/server" || text === "\u{1F4CA} \u062D\u0627\u0644\u0629 \u0627\u0644\u0633\u064A\u0631\u0641\u0631" || text === "\u062D\u0627\u0644\u0629 \u0627\u0644\u0633\u064A\u0631\u0641\u0631") {
      await sendServerStatus(chatId);
      return;
    }
    if (text === "/devices" || text === "\u{1F4E1} \u0627\u0644\u0645\u062A\u0635\u0644\u0648\u0646 \u0627\u0644\u0622\u0646" || text === "\u0627\u0644\u0645\u062A\u0635\u0644\u0648\u0646 \u0627\u0644\u0622\u0646") {
      await sendConnectedDevicesReport(chatId);
      return;
    }
    if (text === "/admins" || text === "\u{1F451} \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0641\u064A\u0646" || text === "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0641\u064A\u0646") {
      await sendAdminsList(chatId);
      return;
    }
    if (text === "/logs" || text === "\u{1F4DD} \u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062E\u0627\u062F\u0645" || text === "\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062E\u0627\u062F\u0645") {
      const recent = escapeHtml(logs.slice(-25).join("\n"));
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u{1F4DD} <b>\u0622\u062E\u0631 \u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062E\u0627\u062F\u0645:</b>

<pre>${recent || "\u0644\u0627 \u062A\u0648\u062C\u062F \u0633\u062C\u0644\u0627\u062A \u0628\u0639\u062F."}</pre>`,
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
      return;
    }
    const session = userSessions[chatId];
    if (session && session.action) {
      if (session.action === "ssh_change_username") {
        delete userSessions[chatId];
        const newUsername = text.trim();
        if (!newUsername || newUsername.length < 2) {
          await telegramApi("sendMessage", { chat_id: chatId, text: "\u274C \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u064A\u062C\u0628 \u0623\u0644\u0627 \u064A\u0642\u0644 \u0639\u0646 \u062D\u0631\u0641\u064A\u0646.", reply_markup: MAIN_REPLY_KEYBOARD });
          return;
        }
        const creds = getSshCredentials();
        creds.username = newUsername;
        saveSshCredentials(creds);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `\u2705 <b>\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u0640 SSH \u0628\u0646\u062C\u0627\u062D \u0625\u0644\u0649:</b> <code>${escapeHtml(newUsername)}</code>`,
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
          await telegramApi("sendMessage", { chat_id: chatId, text: "\u274C \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064A\u062C\u0628 \u0623\u0644\u0627 \u062A\u0642\u0644 \u0639\u0646 \u062D\u0631\u0641\u064A\u0646.", reply_markup: MAIN_REPLY_KEYBOARD });
          return;
        }
        const creds = getSshCredentials();
        creds.password = newPassword;
        saveSshCredentials(creds);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `\u2705 <b>\u062A\u0645 \u062A\u062D\u062F\u064A\u062B \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0644\u0640 SSH \u0628\u0646\u062C\u0627\u062D \u0625\u0644\u0649:</b> <code>${escapeHtml(newPassword)}</code>`,
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
    const isAdmin = isAuthorizedAdmin(userId) || isAuthorizedAdmin(chatId);
    if (!isAdmin) {
      addLog(`[Access Denied] Ignored callback_query from unauthorized Chat ID: ${chatId}, User ID: ${userId}`);
      return;
    }
    if (data === "create_private_ssh") {
      await createPrivateSsh(chatId);
    } else if (data === "cfg_ssh") {
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
        text: "\u{1F464} <b>\u0623\u0631\u0633\u0644 \u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0640 SSH:</b>",
        parse_mode: "HTML",
        reply_markup: MAIN_REPLY_KEYBOARD
      });
    } else if (data === "ssh_change_password") {
      userSessions[chatId] = { action: "ssh_change_password" };
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u{1F511} <b>\u0623\u0631\u0633\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0644\u0640 SSH:</b>",
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
      addLog(`[Telegram Webhook] \u2705 Webhook successfully set to: ${webhookUrl}`);
    } else {
      addLog(`[Telegram Webhook] Failed to set webhook: ${JSON.stringify(res)}`);
    }
  } catch (err) {
    addLog(`[Telegram Webhook] Error: ${err?.message || err}`);
  }
}
function bridgeSocketToDropbear(socket, initialData, responseHeader) {
  try {
    socket.setNoDelay?.(true);
  } catch {
  }
  try {
    socket.setTimeout?.(0);
  } catch {
  }
  try {
    socket.setKeepAlive?.(true, 1e3);
  } catch {
  }
  let bridgeClosed = false;
  const tcpSocket = import_net.default.connect({ host: "127.0.0.1", port: DROPBEAR_PORT }, () => {
    try {
      if (responseHeader) {
        socket.write(responseHeader);
      }
      if (initialData && initialData.length > 0) {
        tcpSocket.write(initialData);
      }
      socket.on("data", (chunk) => {
        if (!bridgeClosed) {
          try {
            tcpSocket.write(chunk);
          } catch {
          }
        }
      });
      tcpSocket.on("data", (chunk) => {
        if (!bridgeClosed) {
          try {
            socket.write(chunk);
          } catch {
          }
        }
      });
    } catch {
      destroyBoth();
    }
  });
  try {
    tcpSocket.setNoDelay(true);
  } catch {
  }
  try {
    tcpSocket.setTimeout(0);
  } catch {
  }
  try {
    tcpSocket.setKeepAlive(true, 1e3);
  } catch {
  }
  const destroyBoth = () => {
    if (bridgeClosed) return;
    bridgeClosed = true;
    try {
      socket.destroy();
    } catch {
    }
    try {
      tcpSocket.destroy();
    } catch {
    }
  };
  tcpSocket.on("error", destroyBoth);
  socket.on("error", destroyBoth);
  tcpSocket.on("close", destroyBoth);
  socket.on("close", destroyBoth);
}
var app = (0, import_express.default)();
app.use(import_express.default.json());
app.use(import_express.default.urlencoded({ extended: true }));
app.use((req, res, next) => {
  const isWs = req.headers["upgrade"]?.toString().toLowerCase() === "websocket";
  const isWsTunnel = isWs && req.path === SSH_WS_PATH;
  if (isWsTunnel && req.path !== "/api/verify-password" && req.path !== "/api/setup-bot" && req.path !== TELEGRAM_WEBHOOK_PATH) {
    const socket = req.socket;
    if (socket && !socket.destroyed) {
      addLog(`[Tunnel-Bridge] Bridging WebSocket ${req.method} ${req.path} directly to Dropbear SSH`);
      const key = req.headers["sec-websocket-key"] || import_crypto.default.randomBytes(16).toString("base64");
      const digest = import_crypto.default.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      const resp = `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${digest}\r
\r
`;
      bridgeSocketToDropbear(socket, void 0, resp);
      return;
    }
  }
  next();
});
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
  } catch (err) {
    addLog(`[Telegram Update Error] ${err?.message || err}`);
  }
});
app.post("/api/verify-password", (req, res) => {
  const { password } = req.body;
  if (password === MURAD_SETUP_PASSWORD) {
    return res.json({ success: true, message: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0635\u062D\u064A\u062D\u0629." });
  }
  return res.status(401).json({ success: false, message: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629." });
});
app.post("/api/setup-bot", (req, res) => {
  const { botId, botToken, password } = req.body;
  if (password !== MURAD_SETUP_PASSWORD) {
    return res.status(401).json({ success: false, message: "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629." });
  }
  if (!botId || !botToken) {
    return res.status(400).json({ success: false, message: "\u0645\u0639\u0631\u0641 \u0627\u0644\u0623\u062F\u0645\u0646 \u0648\u062A\u0648\u0643\u0646 \u0627\u0644\u0628\u0648\u062A \u0645\u0637\u0644\u0648\u0628\u0627\u0646." });
  }
  const saved = saveMuradBotConfigOnce(String(botId).trim(), String(botToken).trim());
  if (saved) {
    setupTelegramWebhook();
    registerBotCommands();
    return res.json({ success: true, message: "\u062A\u0645 \u062D\u0641\u0638 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0628\u0648\u062A \u0628\u0646\u062C\u0627\u062D!" });
  } else {
    return res.status(400).json({ success: false, message: "\u062A\u0645 \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u0628\u0648\u062A \u0645\u0633\u0628\u0642\u0627\u064B \u0628\u0627\u0644\u0641\u0639\u0644." });
  }
});
app.get("/", (req, res) => {
  const domain = getPublicDomain();
  const botToken = getActiveBotTokenSafe();
  if (botToken) {
    return res.status(200).send(`<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>تم الاتصال بنجاح</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07111f;color:#ecfdf5;font-family:system-ui, sans-serif}.card{text-align:center;padding:42px 28px;border:1px solid #14532d;border-radius:22px;background:#0f1f2e;box-shadow:0 20px 50px #0005}.ok{font-size:54px;color:#4ade80}h1{margin:12px 0;font-size:28px}p{color:#a7f3d0}</style></head><body><main class="card"><div class="ok">✓</div><h1>تم الاتصال بنجاح</h1><p>الخدمة تعمل بشكل صحيح.</p></main></body></html>`);
  }
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u0625\u0639\u062F\u0627\u062F \u062E\u0627\u062F\u0645 Mohaalamia SSH</title>
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
        <div class="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-3xl">\u{1F512}</div>
        <h1 class="text-2xl font-extrabold text-white">\u062E\u0627\u062F\u0645 Mohaalamia SSH</h1>
        <p class="text-slate-400 text-sm">\u0623\u062F\u062E\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0648\u0636\u0628\u0637 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A</p>
      </div>

      <form id="authForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">\u{1F511} \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631:</label>
          <input type="password" id="authPassword" required placeholder="\u0623\u062F\u062E\u0644 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631..." class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500" autofocus />
        </div>

        <div id="authStatus" class="hidden text-sm p-3 rounded-xl"></div>

        <button type="submit" id="authBtn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition shadow-lg shadow-emerald-900/30">
          \u062F\u062E\u0648\u0644
        </button>
      </form>
    </div>

    <!-- Step 2: Bot Setup Form (Revealed after password verification) -->
    <div id="stepSetup" class="hidden space-y-6">
      <div class="text-center space-y-2">
        <div class="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-3xl">\u{1F916}</div>
        <h1 class="text-2xl font-extrabold text-white">\u0625\u0639\u062F\u0627\u062F \u0628\u0648\u062A \u062A\u0644\u062C\u0631\u0627\u0645</h1>
        <p class="text-slate-400 text-sm">\u0623\u062F\u062E\u0644 \u062A\u0648\u0643\u0646 \u0627\u0644\u0628\u0648\u062A \u0648\u0645\u0639\u0631\u0641 \u0627\u0644\u0623\u062F\u0645\u0646 \u0644\u0644\u0631\u0628\u0637 \u0645\u0639 \u0627\u0644\u0633\u064A\u0631\u0641\u0631</p>
      </div>

      <form id="setupForm" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">\u{1F916} \u062A\u0648\u0643\u0646 \u0627\u0644\u0628\u0648\u062A (Bot Token):</label>
          <input type="text" id="botToken" required placeholder="123456789:ABCdefGhIJKlmNoPQRstuVWXyz" class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-1">\u{1F451} \u0622\u064A\u062F\u064A \u0627\u0644\u0623\u062F\u0645\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A (Chat ID):</label>
          <input type="text" id="botId" required placeholder="1772564386" class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-emerald-500 font-mono" />
        </div>

        <div id="setupStatus" class="hidden text-sm p-3 rounded-xl"></div>

        <button type="submit" id="setupBtn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition shadow-lg shadow-emerald-900/30">
          \u062D\u0641\u0638 \u0648\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0633\u064A\u0631\u0641\u0631
        </button>
      </form>

      <div class="text-center text-xs text-slate-500 border-t border-slate-800/80 pt-4">
        \u0628\u0639\u062F \u0627\u0644\u062D\u0641\u0638\u060C \u0633\u064A\u062A\u062D\u0648\u0644 \u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0625\u0644\u0649 \u062D\u0627\u0644\u0629 \u0627\u0644\u0640 JSON \u0648\u0633\u064A\u0639\u0645\u0644 \u0627\u0644\u0628\u0648\u062A \u0641\u0648\u0631\u0627\u064B \u0641\u064A \u062A\u0644\u062C\u0631\u0627\u0645.
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
      authStatus.textContent = '\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0642\u0642...';
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
          authStatus.textContent = '\u274C ' + (data.message || '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629.');
          authBtn.disabled = false;
        }
      } catch (err) {
        authStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
        authStatus.textContent = '\u274C \u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0633\u064A\u0631\u0641\u0631.';
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
      setupStatus.textContent = '\u062C\u0627\u0631\u064A \u0627\u0644\u062D\u0641\u0638 \u0648\u0627\u0644\u0631\u0628\u0637 \u0645\u0639 \u062A\u0644\u062C\u0631\u0627\u0645...';
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
          setupStatus.textContent = '\u2705 ' + data.message + ' \u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0648\u064A\u0644...';
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        } else {
          setupStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
          setupStatus.textContent = '\u274C ' + (data.message || '\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062D\u0641\u0638.');
          setupBtn.disabled = false;
        }
      } catch (err) {
        setupStatus.className = 'text-sm p-3 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-300';
        setupStatus.textContent = '\u274C \u062A\u0639\u0630\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0633\u064A\u0631\u0641\u0631.';
        setupBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
var server = import_http.default.createServer(app);
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.maxConnections = 1e4;
server.on("clientError", (_err, socket) => {
  try {
    socket.destroy();
  } catch {
  }
});
server.on("upgrade", (req, socket, head) => {
  addLog(`[Upgrade-Bridge] Intercepted WebSocket upgrade request, responding 101 Switching Protocols & bridging`);
  const key = req.headers["sec-websocket-key"] || import_crypto.default.randomBytes(16).toString("base64");
  const digest = import_crypto.default.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  const responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${digest}`,
    "\r\n"
  ].join("\r\n");
  bridgeSocketToDropbear(socket, head && head.length ? head : void 0, responseHeaders);
});
startSshServer();
server.listen(PORT, "0.0.0.0", () => {
  addLog(`[HTTP Server] Listening on 0.0.0.0:${PORT}`);
  setupTelegramWebhook();
  registerBotCommands();
});
//# sourceMappingURL=server.cjs.map
