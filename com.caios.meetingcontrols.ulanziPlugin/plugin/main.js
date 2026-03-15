import { createServer } from "http";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

import { Server } from "socket.io";
import UlanzideckApi from "../libs/node/ulanzideckApi.js";

const APP_ID = "com.caios.ulanzideck.meetingcontrols";
const $UD = new UlanzideckApi();

const ACTIONS = new Map();
const CLIENTS = new Map();
const PORTS = [35623, 35624, 35625];

const REACTIONS = {
  thumbsup: { active: "assets/actions/reaction/thumbsup.svg", disabled: "assets/actions/reaction/+1Disabled.svg" },
  thumbsdown: { active: "assets/actions/reaction/thumbsdown.svg", disabled: "assets/actions/reaction/-1Disabled.svg" },
  clap: { active: "assets/actions/reaction/clap.svg", disabled: "assets/actions/reaction/clapDisabled.svg" },
  heart: { active: "assets/actions/reaction/sparklingHeart.svg", disabled: "assets/actions/reaction/sparklingHeartDisabled.svg" },
  laugh: { active: "assets/actions/reaction/joy.svg", disabled: "assets/actions/reaction/joyDisabled.svg" },
  sad: { active: "assets/actions/reaction/cry.svg", disabled: "assets/actions/reaction/cryDisabled.svg" },
  wow: { active: "assets/actions/reaction/openMouth.svg", disabled: "assets/actions/reaction/openMouthDisabled.svg" },
  thinking: { active: "assets/actions/reaction/thinkingFace.svg", disabled: "assets/actions/reaction/thinkingFaceDisabled.svg" },
  party: { active: "assets/actions/reaction/tada.svg", disabled: "assets/actions/reaction/tadaDisabled.svg" },
};

const MEETING = {
  activeProfile: "",
  isMeetingOpen: false,
  isMicOn: false,
  isCameraOn: false,
  isHandRaised: false,
  left: false,
};

let io = null;
let serverPort = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.resolve(__dirname, "../meeting-controls.log");

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (_e) {}
}

function getReaction(settings) {
  const key = String(settings?.reaction || "thumbsup");
  return REACTIONS[key] ? key : "thumbsup";
}

function anyMeetingOpen() {
  for (const client of CLIENTS.values()) {
    if (client?.meetingStatus) return true;
  }
  return false;
}

function setActionIcon(context, iconPath, title = "") {
  try {
    $UD.setStateIcon(context, 0, title || "");
    if (iconPath) {
      $UD.setBaseDataIcon(context, "", iconPath);
    }
  } catch (_e) {}
}

function computeIcon(actionUuid, settings) {
  const online = !!MEETING.isMeetingOpen;
  if (actionUuid.endsWith(".microphone")) {
    if (!online) return "assets/actions/microphone/toggleMicrophoneOffDisabled.svg";
    return MEETING.isMicOn
      ? "assets/actions/microphone/toggleMicrophoneOn.svg"
      : "assets/actions/microphone/toggleMicrophoneOff.svg";
  }
  if (actionUuid.endsWith(".camera")) {
    if (!online) return "assets/actions/camera/toggleCameraOffDisabled.svg";
    return MEETING.isCameraOn
      ? "assets/actions/camera/toggleCameraOn.svg"
      : "assets/actions/camera/toggleCameraOff.svg";
  }
  if (actionUuid.endsWith(".hand")) {
    if (!online) return "assets/actions/hand/raiseHandDisabled.svg";
    return MEETING.isHandRaised
      ? "assets/actions/hand/raiseHandLower.svg"
      : "assets/actions/hand/raiseHandUpper.svg";
  }
  if (actionUuid.endsWith(".leave")) {
    if (!online) return "assets/actions/leave/leaveCallDisabled.svg";
    return "assets/actions/leave/leaveCallOn.svg";
  }
  if (actionUuid.endsWith(".reaction")) {
    const reaction = getReaction(settings);
    return online ? REACTIONS[reaction].active : REACTIONS[reaction].disabled;
  }
  return "assets/icons/icon.png";
}

function updateOneAction(context) {
  const action = ACTIONS.get(context);
  if (!action) return;
  const icon = computeIcon(action.uuid, action.settings);
  setActionIcon(context, icon, "");
}

function updateAllActions() {
  for (const context of ACTIONS.keys()) {
    updateOneAction(context);
  }
}

function sendInspectorStatus(context, settings) {
  const payload = {
    ...settings,
    serverPort,
    serverStatus: serverPort ? `online:${serverPort}` : "offline",
    isMeetingOpen: !!MEETING.isMeetingOpen,
    activeProfile: MEETING.activeProfile || "",
  };
  $UD.sendParamFromPlugin(payload, context);
}

function broadcastCommand(command) {
  if (!io) return;
  const payload = { ...command, timestamp: Date.now() };
  io.emit("device-state", payload);
}

function updateFromMeetingMessage(msg, socket) {
  try {
    const activeProfile = typeof msg?.activeProfile === "string" ? msg.activeProfile : "";
    const isMeetingOpen = !!msg?.isMeetingOpen;

    if (activeProfile) {
      if (msg?.profileNotInMeeting) {
        CLIENTS.delete(activeProfile);
      } else {
        CLIENTS.set(activeProfile, { socket, meetingStatus: isMeetingOpen });
      }
      MEETING.activeProfile = activeProfile;
    }

    MEETING.isMeetingOpen = anyMeetingOpen() || isMeetingOpen;

    if (typeof msg?.isMicOn === "boolean") MEETING.isMicOn = msg.isMicOn;
    if (typeof msg?.isCameraOn === "boolean") MEETING.isCameraOn = msg.isCameraOn;
    if (typeof msg?.isHandRaised === "boolean") MEETING.isHandRaised = msg.isHandRaised;
    if (typeof msg?.left === "boolean") MEETING.left = msg.left;

    updateAllActions();
  } catch (e) {
    log("meeting-message error", String(e?.message || e));
  }
}

function startServer() {
  let idx = 0;

  const tryNext = () => {
    if (idx >= PORTS.length) {
      log("no ports available", PORTS);
      return;
    }

    const port = PORTS[idx++];
    const httpServer = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, port: serverPort }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const socketServer = new Server(httpServer, {
      cors: { origin: "*" },
      transports: ["websocket"],
    });

    httpServer.on("error", (err) => {
      if (String(err?.code) === "EADDRINUSE") {
        try {
          socketServer.close();
        } catch (_e) {}
        tryNext();
        return;
      }
      log("http error", String(err?.message || err));
    });

    socketServer.on("connection", (socket) => {
      log("socket connected", socket.id);
      socket.on("meeting-message", (msg) => {
        updateFromMeetingMessage(msg, socket);
      });

      socket.on("disconnect", () => {
        for (const [profile, data] of CLIENTS.entries()) {
          if (data?.socket?.id === socket.id) {
            CLIENTS.delete(profile);
          }
        }
        MEETING.isMeetingOpen = anyMeetingOpen();
        updateAllActions();
      });
    });

    httpServer.listen(port, () => {
      io = socketServer;
      serverPort = port;
      log("socket.io server listening", port);
      for (const [context, action] of ACTIONS.entries()) {
        sendInspectorStatus(context, action.settings || {});
      }
    });
  };

  tryNext();
}

function defaultSettings(uuid) {
  const base = { reaction: "thumbsup" };
  if (String(uuid || "").endsWith(".reaction")) return base;
  return {};
}

$UD.connect(APP_ID);

$UD.onConnected(() => {
  log("connected");
  startServer();
});

$UD.onAdd((data) => {
  const settings = { ...defaultSettings(data.uuid), ...(data.param || {}) };
  ACTIONS.set(data.context, { uuid: data.uuid, settings });
  sendInspectorStatus(data.context, settings);
  updateOneAction(data.context);
});

$UD.onRun((data) => {
  const action = ACTIONS.get(data.context);
  if (!action) return;
  if (!MEETING.isMeetingOpen) {
    updateOneAction(data.context);
    return;
  }

  const profile = MEETING.activeProfile || "";

  if (action.uuid.endsWith(".microphone")) {
    MEETING.isMicOn = !MEETING.isMicOn;
    broadcastCommand({ element: "MICROPHONE", isMicOn: MEETING.isMicOn, activeProfile: profile });
  } else if (action.uuid.endsWith(".camera")) {
    MEETING.isCameraOn = !MEETING.isCameraOn;
    broadcastCommand({ element: "CAMERA", isCameraOn: MEETING.isCameraOn, activeProfile: profile });
  } else if (action.uuid.endsWith(".hand")) {
    MEETING.isHandRaised = !MEETING.isHandRaised;
    broadcastCommand({ element: "HAND", isHandRaised: MEETING.isHandRaised, activeProfile: profile });
  } else if (action.uuid.endsWith(".leave")) {
    MEETING.left = true;
    broadcastCommand({ element: "LEAVE", left: true, activeProfile: profile });
  } else if (action.uuid.endsWith(".reaction")) {
    const reaction = getReaction(action.settings || {});
    broadcastCommand({ element: "REACTION", emoji: reaction, activeProfile: profile });
  }

  updateAllActions();
});

$UD.onClear((data) => {
  for (const p of data.param || []) {
    ACTIONS.delete(p.context);
  }
});

function onSettings(data) {
  const curr = ACTIONS.get(data.context) || { uuid: data.uuid, settings: {} };
  const settings = { ...(curr.settings || {}), ...(data.param || {}) };
  ACTIONS.set(data.context, { uuid: curr.uuid || data.uuid, settings });
  sendInspectorStatus(data.context, settings);
  updateOneAction(data.context);
}

$UD.onParamFromApp(onSettings);
$UD.onParamFromPlugin(onSettings);
