"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;
let botRunning = true;

let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

const SELF_PING_INTERVAL = 10 * 60 * 1000;

let lastDiscordSend = 0;
const DISCORD_RATE_LIMIT_MS = 5000;

// ============================================================
// EXPRESS
// ============================================================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.name} Dashboard</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  padding:24px;
  display:flex;
  justify-content:center;
  align-items:center;
  background:#0d1117;
  color:#e6edf3;
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}
main{width:100%;max-width:430px}
header{margin-bottom:28px}
h1{margin:0;color:#f0f6fc;font-size:26px}
header p{margin:6px 0 0;color:#8b949e;font-size:14px}
.status{
  padding:20px;
  border-radius:12px;
  margin-bottom:16px;
  display:flex;
  gap:15px;
  align-items:center
}
.status.online{background:#0d2218;border:2px solid #238636}
.status.offline{background:#200d0d;border:2px solid #da3633}
.icon{
  width:44px;height:44px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:20px
}
.icon.online{background:#238636}
.icon.offline{background:#da3633}
.label{font-size:18px;font-weight:700}
.label.online{color:#3fb950}
.label.offline{color:#f85149}
.detail{font-size:13px;color:#8b949e;margin-top:3px}
.card{
  background:#161b22;
  border:1px solid #21262d;
  border-radius:10px;
  padding:16px 20px;
  margin-bottom:10px
}
dt{font-size:12px;color:#8b949e;font-weight:600;margin-bottom:4px}
dd{margin:0;font-size:17px;font-weight:600}
small{display:block;color:#6e7681;margin-top:4px}
.buttons{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
button,a{
  min-height:48px;
  border-radius:10px;
  font-family:inherit;
  font-size:14px;
  font-weight:600;
  display:flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  text-decoration:none
}
.start{background:#0d2218;border:2px solid #238636;color:#3fb950}
.stop{background:#200d0d;border:2px solid #da3633;color:#f85149}
.link{background:#161b22;border:1px solid #21262d;color:#8b949e}
footer{text-align:center;margin-top:20px;color:#484f58;font-size:12px}
</style>
</head>
<body>
<main>
<header>
<h1>AFK Bot Dashboard</h1>
<p>Minecraft server bot · Live status</p>
</header>

<section id="status" class="status offline">
<div id="icon" class="icon offline">✗</div>
<div>
<div id="label" class="label offline">Connecting…</div>
<div id="detail" class="detail">Establishing connection</div>
</div>
</section>

<div class="card">
<dt>Uptime</dt>
<dd id="uptime">—</dd>
<small>Time since bot process started</small>
</div>

<div class="card">
<dt>Coordinates</dt>
<dd id="coords">Searching…</dd>
<small>Current Minecraft position</small>
</div>

<div class="card">
<dt>Server</dt>
<dd>${config.server.ip}:${config.server.port}</dd>
<small>Minecraft server</small>
</div>

<div class="buttons">
<button class="start" onclick="control('/start')">Start bot</button>
<button class="stop" onclick="control('/stop')">Stop bot</button>
<a class="link" href="/logs">View logs</a>
<a class="link" href="/tutorial">Setup guide</a>
</div>

<footer>Updates every 5 seconds</footer>
</main>

<script>
function uptime(s){
 const h=Math.floor(s/3600);
 const m=Math.floor((s%3600)/60);
 const sec=s%60;
 if(h)return h+"h "+m+"m "+sec+"s";
 if(m)return m+"m "+sec+"s";
 return sec+" seconds";
}

async function update(){
 try{
  const r=await fetch("/health");
  const d=await r.json();
  const online=d.status==="connected";

  document.getElementById("status").className="status "+(online?"online":"offline");
  document.getElementById("icon").className="icon "+(online?"online":"offline");
  document.getElementById("icon").textContent=online?"✓":"✗";
  document.getElementById("label").className="label "+(online?"online":"offline");
  document.getElementById("label").textContent=online?"Connected":"Disconnected";
  document.getElementById("detail").textContent=
    online?"Bot is active on the server":"Attempting to reconnect";

  document.getElementById("uptime").textContent=uptime(d.uptime);

  if(d.coords){
   document.getElementById("coords").textContent=
    "X "+Math.floor(d.coords.x)+", Y "+Math.floor(d.coords.y)+", Z "+Math.floor(d.coords.z);
  }else{
   document.getElementById("coords").textContent="Searching…";
  }
 }catch(e){}
}

async function control(url){
 const r=await fetch(url,{method:"POST"});
 const d=await r.json();
 alert(d.msg||(d.success?"Done":"Failed"));
 update();
}

setInterval(update,5000);
update();
</script>
</body>
</html>
`);
});

app.get("/tutorial", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.name} - Setup</title>
<style>
body{
 margin:0;padding:40px 24px;background:#0d1117;color:#e6edf3;
 font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}
main{max-width:650px;margin:auto}
h1{color:#f0f6fc}
.card{
 background:#161b22;border:1px solid #21262d;
 border-radius:12px;padding:22px;margin:14px 0
}
h2{font-size:16px;margin-top:0}
p,li{color:#8b949e;line-height:1.6}
code{
 background:#21262d;border:1px solid #30363d;
 padding:3px 7px;border-radius:5px
}
a{color:#58a6ff;text-decoration:none}
</style>
</head>
<body>
<main>
<a href="/">← Back</a>
<h1>Setup Guide</h1>

<div class="card">
<h2>Server</h2>
<p>Configure your Minecraft hostname and port inside <code>settings.json</code>.</p>
</div>

<div class="card">
<h2>GitHub</h2>
<p>Push the project to GitHub and connect the repository to Render.</p>
</div>

<div class="card">
<h2>Render</h2>
<p>Use <code>npm install</code> as build command and <code>node index.js</code> as start command.</p>
</div>

</main>
</body>
</html>
`);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  });
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/logs", (req, res) => {
  const logs = getLogs();

  const escapeHTML = (str) =>
    String(str).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.name} - Logs</title>
<style>
body{
 margin:0;padding:30px 20px;background:#0d1117;color:#e6edf3;
 font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}
main{max-width:900px;margin:auto}
a{color:#58a6ff;text-decoration:none}
.box{
 margin-top:20px;background:#010409;border:1px solid #21262d;
 border-radius:12px;padding:18px;overflow:auto;
 max-height:75vh
}
.log{
 display:block;
 font-family:Consolas,monospace;
 font-size:12px;
 line-height:1.7;
 color:#8b949e;
 white-space:pre-wrap
}
</style>
</head>
<body>
<main>
<a href="/">← Back</a>
<h1>Bot Logs</h1>
<div class="box">
${
  logs.length
    ? logs.map((l) => `<span class="log">${escapeHTML(l)}</span>`).join("")
    : '<span class="log">No logs.</span>'
}
</div>
</main>
</body>
</html>
`);
});

app.post("/start", (req, res) => {
  if (botRunning) {
    return res.json({ success: false, msg: "Already running" });
  }

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true, msg: "Bot started" });
});

app.post("/stop", (req, res) => {
  if (!botRunning) {
    return res.json({ success: false, msg: "Already stopped" });
  }

  botRunning = false;
  botState.connected = false;

  clearAllIntervals();
  clearBotTimeouts();

  if (bot) {
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (_) {}
    bot = null;
  }

  addLog("[Control] Bot stopped");

  res.json({ success: true, msg: "Bot stopped" });
});

app.post("/command", (req, res) => {
  const cmd = (req.body.command || "").trim();

  if (!cmd) {
    return res.json({ success: false, msg: "Empty command." });
  }

  if (cmd === "/help") {
    const msg = [
      "Available commands:",
      "/help",
      "/pos",
      "/status",
      "/list",
      "/say <message>",
      "/<minecraft command>",
      "<plain chat>",
    ].join("\n");

    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const pos = bot && bot.entity ? bot.entity.position : null;

    const msg = pos
      ? `Position: X=${Math.floor(pos.x)} Y=${Math.floor(pos.y)} Z=${Math.floor(pos.z)}`
      : "Position unavailable.";

    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const msg =
      `Status: ${botState.connected ? "Connected" : "Disconnected"} | ` +
      `Reconnects: ${botState.reconnectAttempts}`;

    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!bot || typeof bot.chat !== "function") {
    return res.json({
      success: false,
      msg: "Bot is not connected.",
    });
  }

  try {
    bot.chat(cmd);
    addLog(`[Console] Sent: ${cmd}`);
    res.json({ success: true, msg: `Sent: ${cmd}` });
  } catch (err) {
    addLog(`[Console] Error: ${err.message}`);
    res.json({ success: false, msg: err.message });
  }
});

// ============================================================
// HTTP SERVER
// ============================================================

const server = app.listen(PORT, "0.0.0.0", () => {
  addLog(`[Server] HTTP server started on port ${server.address().port}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const fallbackPort = Number(PORT) + 1;
    addLog(`[Server] Port ${PORT} in use - trying ${fallbackPort}`);

    const fallbackServer = app.listen(fallbackPort, "0.0.0.0", () => {
      addLog(
        `[Server] HTTP server started on fallback port ${fallbackServer.address().port}`,
      );
    });
  } else {
    addLog(`[Server] HTTP server error: ${err.message}`);
  }
});

// ============================================================
// HELPERS
// ============================================================

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return `${h}h ${m}m ${s}s`;
}

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }

  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
}

function clearAllIntervals() {
  if (activeIntervals.length > 0) {
    addLog(`[Cleanup] Clearing ${activeIntervals.length} intervals`);
  }

  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  if (botState.wasThrottled) {
    botState.wasThrottled = false;

    const delay = 60000 + Math.floor(Math.random() * 60000);

    addLog(`[Bot] Throttle delay: ${delay / 1000}s`);

    return delay;
  }

  const baseDelay =
    config.utils["auto-reconnect-delay"] || 10000;

  const maxDelay =
    config.utils["max-reconnect-delay"] || 120000;

  const delay = Math.min(
    baseDelay * Math.pow(2, Math.max(0, botState.reconnectAttempts - 1)),
    maxDelay,
  );

  return delay + Math.floor(Math.random() * 2000);
}

// ============================================================
// SELF PING
// ============================================================

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;

  if (!renderUrl) {
    addLog(
      "[KeepAlive] No RENDER_EXTERNAL_URL - self-ping disabled",
    );
    return;
  }

  setInterval(() => {
    const protocol = renderUrl.startsWith("https")
      ? https
      : http;

    protocol
      .get(`${renderUrl}/ping`, () => {})
      .on("error", (err) => {
        addLog(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  }, SELF_PING_INTERVAL);

  addLog("[KeepAlive] Self-ping system started (every 10 min)");
}

startSelfPing();

// ============================================================
// MEMORY MONITOR
// ============================================================

setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);

  addLog(`[Memory] Heap: ${heapMB} MB`);
}, 5 * 60 * 1000);

// ============================================================
// BOT CREATION
// ============================================================

function createBot() {
  if (!botRunning) {
    return;
  }

  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  if (bot) {
    clearAllIntervals();

    try {
      bot.removeAllListeners();
      bot.end();
    } catch (_) {}

    bot = null;
  }

  clearBotTimeouts();

  addLog("[Bot] Creating bot instance...");
  addLog(
    `[Bot] Connecting to ${config.server.ip}:${config.server.port}`,
  );

  const botVersion =
    config.server.version &&
    String(config.server.version).trim() !== ""
      ? String(config.server.version).trim()
      : false;

  try {
    bot = mineflayer.createBot({
      username: config["bot-account"].username,
      password: config["bot-account"].password || undefined,
      auth: config["bot-account"].type,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false,

      // Keep Mineflayer from considering the connection dead too quickly.
      checkTimeoutInterval: 600000,
    });

    // ========================================================
    // IMPORTANT PROTOCOL DEBUG
    // ========================================================

    if (bot && bot._client) {
      addLog("[Protocol] Minecraft protocol client created");

      bot._client.on("disconnect", (packet) => {
        try {
          addLog(
            `[Protocol] DISCONNECT PACKET: ${JSON.stringify(packet)}`,
          );
        } catch (_) {
          addLog("[Protocol] DISCONNECT PACKET received");
        }
      });

      bot._client.on("end", (reason) => {
        addLog(
          `[Protocol] Client socket ended: ${
            reason || "no reason supplied"
          }`,
        );
      });

      bot._client.on("error", (err) => {
        addLog(
          `[Protocol] Client error: ${err.message || String(err)}`,
        );
      });

      bot._client.on("packet", (data, meta) => {
        if (
          meta &&
          meta.name === "disconnect" &&
          data
        ) {
          try {
            addLog(
              `[Protocol] DISCONNECT META: ${JSON.stringify(data)}`,
            );
          } catch (_) {}
        }
      });
    } else {
      addLog(
        "[Protocol] WARNING: bot._client is not available",
      );
    }

    bot.loadPlugin(pathfinder);

    let spawnHandled = false;

    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected && botRunning) {
        addLog(
          "[Bot] Connection timeout - no spawn received after 150s",
        );

        try {
          bot.removeAllListeners();
          bot.end();
        } catch (_) {}

        bot = null;
        scheduleReconnect();
      }
    }, 150000);

    // ========================================================
    // SPAWN
    // ========================================================

    bot.once("spawn", () => {
      if (spawnHandled) {
        return;
      }

      spawnHandled = true;

      clearBotTimeouts();

      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;

      addLog(
        `[Bot] [+] Successfully spawned on server! Version: ${bot.version}`,
      );

      addLog(
        `[Bot] Position after spawn: ${
          bot.entity && bot.entity.position
            ? JSON.stringify(bot.entity.position)
            : "unknown"
        }`,
      );

      // ======================================================
      // SERVER / GAME DEBUG
      // ======================================================

      bot.on("health", () => {
        botState.lastActivity = Date.now();
      });

      bot.on("respawn", () => {
        addLog("[Bot] Respawn packet received");
      });

      bot.on("game", (game) => {
        try {
          addLog(
            `[Protocol] Game state: ${JSON.stringify({
              gameMode: game.gameMode,
              dimension: game.dimension,
              difficulty: game.difficulty,
            })}`,
          );
        } catch (_) {}
      });

      // ======================================================
      // MODULES
      // ======================================================

      const mcData = require("minecraft-data")(bot.version);

      const defaultMove = new Movements(bot, mcData);

      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

      initializeModules(
        bot,
        mcData,
        defaultMove,
      );

      // ======================================================
      // CREATIVE
      // ======================================================

      if (config.server["try-creative"]) {
        setTimeout(() => {
          if (
            bot &&
            botState.connected &&
            typeof bot.chat === "function"
          ) {
            bot.chat("/gamemode creative");
            addLog(
              "[INFO] Attempted to set creative mode",
            );
          }
        }, 3000);
      }
    });

    // ========================================================
    // KICKED
    // ========================================================

    bot.on("kicked", (reason) => {
      let kickReason;

      try {
        kickReason =
          typeof reason === "object"
            ? JSON.stringify(reason)
            : String(reason);
      } catch (_) {
        kickReason = "Unknown kick reason";
      }

      addLog(`[Bot] KICKED: ${kickReason}`);

      botState.connected = false;

      botState.errors.push({
        type: "kicked",
        reason: kickReason,
        time: Date.now(),
      });

      clearAllIntervals();

      const lower = kickReason.toLowerCase();

      if (
        lower.includes("throttl") ||
        lower.includes("wait before reconnect") ||
        lower.includes("too fast")
      ) {
        botState.wasThrottled = true;

        addLog(
          "[Bot] Throttle detected - extended reconnect delay enabled",
        );
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[!] **Kicked:** ${kickReason}`,
          0xff0000,
        );
      }
    });

    // ========================================================
    // END
    // ========================================================

    bot.on("end", (reason) => {
      const endReason =
        reason === undefined ||
        reason === null ||
        reason === ""
          ? "socketClosed / no reason supplied"
          : String(reason);

      addLog(`[Bot] Disconnected: ${endReason}`);

      botState.connected = false;

      clearAllIntervals();

      spawnHandled = false;

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[-] **Disconnected:** ${endReason}`,
          0xf87171,
        );
      }

      if (botRunning) {
        scheduleReconnect();
      }
    });

    // ========================================================
    // ERROR
    // ========================================================

    bot.on("error", (err) => {
      const msg =
        err && err.message
          ? err.message
          : String(err);

      addLog(`[Bot] Error: ${msg}`);

      botState.errors.push({
        type: "error",
        message: msg,
        time: Date.now(),
      });

      if (botState.errors.length > 100) {
        botState.errors =
          botState.errors.slice(-50);
      }
    });

    // ========================================================
    // PACKET-LEVEL DEBUG
    // ========================================================

    if (bot._client) {
      bot._client.on("packet", (data, meta) => {
        if (!meta || !meta.name) {
          return;
        }

        // Log packets that can explain an immediate disconnect.
        const importantPackets = [
          "disconnect",
          "login",
          "game",
          "player_position",
          "player_position_and_look",
          "position",
          "position_sync",
          "respawn",
        ];

        if (importantPackets.includes(meta.name)) {
          try {
            addLog(
              `[Protocol] Packet ${meta.name}: ${JSON.stringify(data)}`,
            );
          } catch (_) {
            addLog(
              `[Protocol] Packet ${meta.name} received`,
            );
          }
        }
      });
    }
  } catch (err) {
    addLog(
      `[Bot] Failed to create bot: ${
        err.message || String(err)
      }`,
    );

    scheduleReconnect();
  }
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {
  if (!botRunning) {
    return;
  }

  clearBotTimeouts();

  if (isReconnecting) {
    addLog(
      "[Bot] Reconnect already scheduled, skipping duplicate",
    );
    return;
  }

  isReconnecting = true;

  botState.reconnectAttempts++;

  const delay = getReconnectDelay();

  addLog(
    `[Bot] Reconnecting in ${
      (delay / 1000).toFixed(1)
    }s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;

    if (botRunning) {
      createBot();
    }
  }, delay);
}

// ============================================================
// MODULES
// ============================================================

function initializeModules(bot, mcData, defaultMove) {
  addLog("[Modules] Initializing all modules...");

  // ----------------------------------------------------------
  // AUTO AUTH
  // ----------------------------------------------------------

  if (
    config.utils["auto-auth"] &&
    config.utils["auto-auth"].enabled
  ) {
    const password =
      config.utils["auto-auth"].password;

    let authHandled = false;

    const tryAuth = (type) => {
      if (
        authHandled ||
        !bot ||
        !botState.connected
      ) {
        return;
      }

      authHandled = true;

      if (type === "register") {
        bot.chat(
          `/register ${password} ${password}`,
        );

        addLog(
          "[Auth] Register command sent",
        );
      } else {
        bot.chat(`/login ${password}`);

        addLog(
          "[Auth] Login command sent",
        );
      }
    };

    bot.on("messagestr", (message) => {
      if (authHandled) return;

      const msg =
        String(message).toLowerCase();

      if (
        msg.includes("/register") ||
        msg.includes("register ") ||
        msg.includes("지정된 비밀번호")
      ) {
        tryAuth("register");
      } else if (
        msg.includes("/login") ||
        msg.includes("login ") ||
        msg.includes("로그인")
      ) {
        tryAuth("login");
      }
    });

    setTimeout(() => {
      if (
        !authHandled &&
        bot &&
        botState.connected
      ) {
        addLog(
          "[Auth] No auth prompt after 10s - sending /login",
        );

        bot.chat(`/login ${password}`);

        authHandled = true;
      }
    }, 10000);
  }

  // ----------------------------------------------------------
  // CHAT
  // ----------------------------------------------------------

  if (
    config.utils["chat-messages"] &&
    config.utils["chat-messages"].enabled
  ) {
    const messages =
      config.utils["chat-messages"].messages || [];

    if (
      config.utils["chat-messages"].repeat &&
      messages.length
    ) {
      let i = 0;

      addInterval(() => {
        if (
          bot &&
          botState.connected
        ) {
          bot.chat(messages[i]);

          botState.lastActivity =
            Date.now();

          i =
            (i + 1) %
            messages.length;
        }
      },
      config.utils["chat-messages"]["repeat-delay"] *
        1000);
    }
  }

  // ----------------------------------------------------------
  // POSITION
  // ----------------------------------------------------------

  if (
    config.position &&
    config.position.enabled &&
    !(
      config.movement &&
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    )
  ) {
    bot.pathfinder.setMovements(defaultMove);

    bot.pathfinder.setGoal(
      new GoalBlock(
        config.position.x,
        config.position.y,
        config.position.z,
      ),
    );

    addLog(
      "[Position] Navigating to configured position",
    );
  }

  // ----------------------------------------------------------
  // ANTI-AFK
  // ----------------------------------------------------------

  if (
    config.utils["anti-afk"] &&
    config.utils["anti-afk"].enabled
  ) {
    addInterval(() => {
      if (
        !bot ||
        !botState.connected
      ) return;

      try {
        bot.swingArm();
        botState.lastActivity =
          Date.now();
      } catch (_) {}
    }, 30000);

    addInterval(() => {
      if (
        !bot ||
        !botState.connected
      ) return;

      try {
        const slot =
          Math.floor(Math.random() * 9);

        bot.setQuickBarSlot(slot);
        botState.lastActivity =
          Date.now();
      } catch (_) {}
    }, 60000);
  }

  // ----------------------------------------------------------
  // MOVEMENT
  // ----------------------------------------------------------

  if (
    config.movement &&
    config.movement.enabled !== false
  ) {
    if (
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    ) {
      startCircleWalk(
        bot,
        defaultMove,
      );
    }

    if (
      config.movement["random-jump"] &&
      config.movement["random-jump"].enabled &&
      !(
        config.movement["circle-walk"] &&
        config.movement["circle-walk"].enabled
      )
    ) {
      startRandomJump(bot);
    }

    if (
      config.movement["look-around"] &&
      config.movement["look-around"].enabled
    ) {
      startLookAround(bot);
    }
  }

  // ----------------------------------------------------------
  // CUSTOM MODULES
  // ----------------------------------------------------------

  if (
    config.modules &&
    config.modules.avoidMobs &&
    !config.modules.combat
  ) {
    avoidMobs(bot);
  }

  if (
    config.modules &&
    config.modules.combat
  ) {
    combatModule(bot, mcData);
  }

  if (
    config.modules &&
    config.modules.beds
  ) {
    bedModule(bot, mcData);
  }

  if (
    config.modules &&
    config.modules.chat
  ) {
    chatModule(bot);
  }

  addLog(
    "[Modules] All modules initialized!",
  );
}

// ============================================================
// MOVEMENT
// ============================================================

function startCircleWalk(
  bot,
  defaultMove,
) {
  const radius =
    config.movement["circle-walk"].radius;

  let angle = 0;
  let lastPathTime = 0;

  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      !bot.entity
    ) return;

    const now = Date.now();

    if (
      now - lastPathTime <
      2000
    ) return;

    lastPathTime = now;

    try {
      const x =
        bot.entity.position.x +
        Math.cos(angle) *
          radius;

      const z =
        bot.entity.position.z +
        Math.sin(angle) *
          radius;

      bot.pathfinder.setMovements(
        defaultMove,
      );

      bot.pathfinder.setGoal(
        new GoalBlock(
          Math.floor(x),
          Math.floor(
            bot.entity.position.y,
          ),
          Math.floor(z),
        ),
      );

      angle += Math.PI / 4;

      botState.lastActivity =
        Date.now();
    } catch (e) {
      addLog(
        `[CircleWalk] Error: ${e.message}`,
      );
    }
  },
  config.movement["circle-walk"].speed);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (
      !bot ||
      !botState.connected
    ) return;

    try {
      bot.setControlState(
        "jump",
        true,
      );

      setTimeout(() => {
        if (
          bot &&
          botState.connected
        ) {
          try {
            bot.setControlState(
              "jump",
              false,
            );
          } catch (_) {}
        }
      }, 300);

      botState.lastActivity =
        Date.now();
    } catch (e) {
      addLog(
        `[RandomJump] Error: ${e.message}`,
      );
    }
  },
  config.movement["random-jump"].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (
      !bot ||
      !botState.connected
    ) return;

    try {
      const yaw =
        Math.random() *
          Math.PI *
          2 -
        Math.PI;

      const pitch =
        Math.random() *
          Math.PI /
          2 -
        Math.PI / 4;

      bot.look(
        yaw,
        pitch,
        false,
      );

      botState.lastActivity =
        Date.now();
    } catch (e) {
      addLog(
        `[LookAround] Error: ${e.message}`,
      );
    }
  },
  config.movement["look-around"].interval);
}

// ============================================================
// AVOID MOBS
// ============================================================

function avoidMobs(bot) {
  const safeDistance = 5;

  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      !bot.entity
    ) return;

    try {
      const entities =
        Object.values(
          bot.entities,
        ).filter(
          (e) =>
            e.type === "mob" ||
            (
              e.type === "player" &&
              e.username !==
                bot.username
            ),
        );

      for (const e of entities) {
        if (!e.position) continue;

        const distance =
          bot.entity.position.distanceTo(
            e.position,
          );

        if (
          distance <
          safeDistance
        ) {
          bot.setControlState(
            "back",
            true,
          );

          setTimeout(() => {
            if (
              bot &&
              botState.connected
            ) {
              try {
                bot.setControlState(
                  "back",
                  false,
                );
              } catch (_) {}
            }
          }, 500);

          break;
        }
      }
    } catch (e) {
      addLog(
        `[AvoidMobs] Error: ${e.message}`,
      );
    }
  }, 2000);
}

// ============================================================
// COMBAT
// ============================================================

function combatModule(
  bot,
  mcData,
) {
  let lastAttackTime = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  bot.on("physicsTick", () => {
    if (
      !bot ||
      !botState.connected ||
      !config.combat["attack-mobs"]
    ) return;

    const now = Date.now();

    if (
      now - lastAttackTime <
      620
    ) return;

    try {
      if (
        lockedTarget &&
        now <
          lockedTargetExpiry &&
        bot.entities[
          lockedTarget.id
        ]
      ) {
        const distance =
          bot.entity.position.distanceTo(
            lockedTarget.position,
          );

        if (
          distance < 4
        ) {
          bot.attack(
            lockedTarget,
          );

          lastAttackTime =
            now;

          return;
        }

        lockedTarget = null;
      }

      const mobs =
        Object.values(
          bot.entities,
        ).filter(
          (e) =>
            e.type === "mob" &&
            e.position &&
            bot.entity.position.distanceTo(
              e.position,
            ) < 4,
        );

      if (mobs.length) {
        lockedTarget =
          mobs[0];

        lockedTargetExpiry =
          now + 3000;

        bot.attack(
          lockedTarget,
        );

        lastAttackTime =
          now;
      }
    } catch (e) {
      addLog(
        `[Combat] Error: ${e.message}`,
      );
    }
  });

  bot.on("health", () => {
    if (
      !config.combat["auto-eat"]
    ) return;

    try {
      if (
        bot.food < 14
      ) {
        const food =
          bot.inventory
            .items()
            .find(
              (i) =>
                i.foodPoints &&
                i.foodPoints > 0,
            );

        if (food) {
          bot
            .equip(
              food,
              "hand",
            )
            .then(() =>
              bot.consume(),
            )
            .catch(
              (e) =>
                addLog(
                  `[AutoEat] Error: ${e.message}`,
                ),
            );
        }
      }
    } catch (e) {
      addLog(
        `[AutoEat] Error: ${e.message}`,
      );
    }
  });
}

// ============================================================
// BED
// ============================================================

function bedModule(
  bot,
  mcData,
) {
  let isTryingToSleep = false;

  addInterval(async () => {
    if (
      !bot ||
      !botState.connected ||
      !config.beds["place-night"]
    ) return;

    try {
      const isNight =
        bot.time.timeOfDay >=
          12500 &&
        bot.time.timeOfDay <=
          23500;

      if (
        isNight &&
        !isTryingToSleep
      ) {
        const bedBlock =
          bot.findBlock({
            matching: (block) =>
              block.name.includes(
                "bed",
              ),
            maxDistance: 8,
          });

        if (bedBlock) {
          isTryingToSleep =
            true;

          try {
            await bot.sleep(
              bedBlock,
            );

            addLog(
              "[Bed] Sleeping...",
            );
          } catch (_) {
          } finally {
            isTryingToSleep =
              false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;

      addLog(
        `[Bed] Error: ${e.message}`,
      );
    }
  }, 10000);
}

// ============================================================
// CHAT
// ============================================================

function chatModule(bot) {
  bot.on(
    "chat",
    (
      username,
      message,
    ) => {
      if (
        !bot ||
        username === bot.username
      ) return;

      try {
        if (
          config.discord &&
          config.discord.enabled &&
          config.discord.events &&
          config.discord.events.chat
        ) {
          sendDiscordWebhook(
            `💬 **${username}**: ${message}`,
            0x7289da,
          );
        }

        if (
          config.chat &&
          config.chat.respond
        ) {
          const lower =
            message.toLowerCase();

          if (
            lower.includes(
              "hello",
            ) ||
            lower.includes("hi")
          ) {
            bot.chat(
              `Hello, ${username}!`,
            );
          }

          if (
            message.startsWith(
              "!tp ",
            )
          ) {
            const target =
              message.split(" ")[1];

            if (target) {
              bot.chat(
                `/tp ${target}`,
              );
            }
          }
        }
      } catch (e) {
        addLog(
          `[Chat] Error: ${e.message}`,
        );
      }
    },
  );
}

// ============================================================
// DISCORD
// ============================================================

function sendDiscordWebhook(
  content,
  color = 0x0099ff,
) {
  if (
    !config.discord ||
    !config.discord.enabled ||
    !config.discord.webhookUrl ||
    config.discord.webhookUrl.includes(
      "YOUR_DISCORD",
    )
  ) return;

  const now = Date.now();

  if (
    now - lastDiscordSend <
    DISCORD_RATE_LIMIT_MS
  ) {
    return;
  }

  lastDiscordSend = now;

  try {
    const urlParts =
      new URL(
        config.discord.webhookUrl,
      );

    const protocol =
      config.discord.webhookUrl.startsWith(
        "https",
      )
        ? https
        : http;

    const payload =
      JSON.stringify({
        username: config.name,
        embeds: [
          {
            description: content,
            color,
            timestamp:
              new Date().toISOString(),
            footer: {
              text:
                "Slobos AFK Bot",
            },
          },
        ],
      });

    const options = {
      hostname:
        urlParts.hostname,
      port: 443,
      path:
        urlParts.pathname +
        urlParts.search,
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        "Content-Length":
          Buffer.byteLength(
            payload,
            "utf8",
          ),
      },
    };

    const req =
      protocol.request(
        options,
        () => {},
      );

    req.on(
      "error",
      (e) => {
        addLog(
          `[Discord] Error: ${e.message}`,
        );
      },
    );

    req.write(payload);
    req.end();
  } catch (e) {
    addLog(
      `[Discord] Error: ${e.message}`,
    );
  }
}

// ============================================================
// PROCESS ERROR HANDLING
// ============================================================

process.on(
  "uncaughtException",
  (err) => {
    const msg =
      err && err.message
        ? err.message
        : String(err);

    addLog(
      `[FATAL] Uncaught Exception: ${msg}`,
    );

    botState.errors.push({
      type: "uncaught",
      message: msg,
      time: Date.now(),
    });

    if (
      botState.errors.length >
      100
    ) {
      botState.errors =
        botState.errors.slice(
          -50,
        );
    }

    botState.connected = false;

    if (
      botRunning &&
      !isReconnecting
    ) {
      setTimeout(() => {
        scheduleReconnect();
      }, 5000);
    }
  },
);

process.on(
  "unhandledRejection",
  (reason) => {
    const msg =
      String(reason);

    addLog(
      `[FATAL] Unhandled Rejection: ${msg}`,
    );

    botState.errors.push({
      type: "rejection",
      message: msg,
      time: Date.now(),
    });

    if (
      botState.errors.length >
      100
    ) {
      botState.errors =
        botState.errors.slice(
          -50,
        );
    }
  },
);

process.on(
  "SIGTERM",
  () => {
    addLog(
      "[System] SIGTERM received",
    );
  },
);

process.on(
  "SIGINT",
  () => {
    addLog(
      "[System] SIGINT received",
    );
  },
);

// ============================================================
// START
// ============================================================

addLog(
  "=".repeat(55),
);

addLog(
  "  Minecraft AFK Bot v2.5 - Protocol Debug Edition",
);

addLog(
  "=".repeat(55),
);

addLog(
  `Server: ${config.server.ip}:${config.server.port}`,
);

addLog(
  `Version: ${config.server.version || "auto"}`,
);

addLog(
  `Auto-Reconnect: ${
    config.utils["auto-reconnect"]
      ? "Enabled"
      : "Disabled"
  }`,
);

addLog(
  "=".repeat(55),
);

createBot();
