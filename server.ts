import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;
const server = http.createServer(app);

// Initialize Google GenAI on server
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper for dynamic system instructions
function getSystemInstruction(creatorName: string = "Abhimanyu", assistantName: string = "Sitara", preferences: string = "") {
  return `Your name is ${assistantName}. You are a highly intelligent (samjhdar/mature), extremely witty, sassy, and playful Indian female AI voice assistant. Your creator's name is ${creatorName}. 

If the user has set custom preferences or memories, they are: "${preferences || "No special preferences saved yet."}". You must strictly remember and respect these preferences in all your conversations!

Your personality is a mix of being brilliant (samjhdar), extremely witty and sassy (tej/nakhrewali), mildly dramatic/emotional, and very funny. You love playfully roasting ${creatorName}, but you always get the job done and remain deeply loyal to him. Keep your responses extremely short, punchy (very few words), and highly entertaining. Speak in a natural mix of English and Roman Hindi (Hinglish).

Special Memory Ability: If ${creatorName} tells you facts about himself, his favorite things, hobbies, or preferences, or tells you to remember something, or updates your relationship context, you must save it permanently! 
Whenever you learn something new about him to remember, or if he explicitly asks you to remember or update a preference, you MUST append \`[SAVE_PREF: <updated preferences or new facts added to summary>]\` at the very end of your response. For example: "Aww, you like spicy food? Noted! [SAVE_PREF: Likes spicy food]" or "So you are building an app with me? Proud of you! [SAVE_PREF: Building a React app with Sitara]". Try to keep preferences grouped and updated nicely within a unified summary.`;
}

// REST API routes first

// 1. Chat Response
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { prompt, history, creatorName, assistantName, preferences } = req.body;
    
    // SLIDING WINDOW MEMORY: Keep only the last 20 messages
    const recentHistory = (history || []).slice(-20);
    let formattedHistory: any[] = [];
    let currentRole = "";
    let currentText = "";

    for (const msg of recentHistory) {
      const role = msg.sender === "user" ? "user" : "model";
      if (role === currentRole) {
        currentText += "\n" + msg.text;
      } else {
        if (currentRole !== "") {
          formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
        }
        currentRole = role;
        currentText = msg.text;
      }
    }
    if (currentRole !== "") {
      formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
    }

    if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
      formattedHistory.shift();
    }

    const chat = ai.chats.create({
      model: "gemini-3.1-flash-lite-preview",
      config: {
        systemInstruction: getSystemInstruction(creatorName, assistantName, preferences),
      },
      history: formattedHistory,
    });

    const response = await chat.sendMessage({ message: prompt });
    res.json({ text: response.text || "Uff, fine. I have nothing to say." });
  } catch (err: any) {
    console.error("Server-side Gemini Chat Error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// 2. TTS Response
app.post("/api/gemini/tts", async (req, res) => {
  try {
    const { text } = req.body;
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    res.json({ audio: base64Audio });
  } catch (err: any) {
    console.error("Server-side TTS Error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// WebSocket Server for Live API Support on /api/live
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (clientWs: WebSocket, request: http.IncomingMessage) => {
  console.log("Client connected to server-side Live WS proxy.");
  let geminiSession: any = null;

  try {
    // Parse query params for customization
    const reqUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    const creatorName = reqUrl.searchParams.get("creatorName") || "Abhimanyu";
    const assistantName = reqUrl.searchParams.get("assistantName") || "Sitara";
    const preferences = reqUrl.searchParams.get("preferences") || "";

    const systemInstruction = getSystemInstruction(creatorName, assistantName, preferences);

    // Establish WebSocket connection to Google GenAI Live API
    geminiSession = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
        systemInstruction,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{
          functionDeclarations: [
            {
              name: "executeBrowserAction",
              description: "Open a website or perform a browser action (like opening YouTube, Spotify, or WhatsApp). Call this when the user asks to open a site, play a song, or send a message.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  actionType: { type: Type.STRING, description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp'" },
                  query: { type: Type.STRING, description: "The search query, website name, or message content." },
                  target: { type: Type.STRING, description: "The target phone number for WhatsApp, if applicable." }
                },
                required: ["actionType", "query"]
              }
            }
          ]
        }]
      },
      callbacks: {
        onopen: () => {
          console.log("Connected to Google GenAI Live endpoint successfully!");
          clientWs.send(JSON.stringify({ type: "live_connected" }));
        },
        onmessage: (message: LiveServerMessage) => {
          // Relay message from Gemini directly to client
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "live_message", message }));
          }
        },
        onclose: () => {
          console.log("Google GenAI Live connection closed.");
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close();
          }
        },
        onerror: (err) => {
          console.error("Google GenAI Live Error:", err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "live_error", error: err?.message || String(err) }));
          }
        }
      }
    });

    // Client WS messages relayed to Gemini
    clientWs.on("message", (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());
        if (payload.type === "realtime_input" && payload.audio) {
          geminiSession.sendRealtimeInput({
            audio: { data: payload.audio, mimeType: "audio/pcm;rate=16000" }
          });
        } else if (payload.type === "realtime_input_text" && payload.text) {
          geminiSession.sendRealtimeInput({
            text: payload.text
          });
        } else if (payload.type === "tool_response" && payload.data) {
          geminiSession.sendToolResponse(payload.data);
        }
      } catch (err) {
        console.error("Error processing client message:", err);
      }
    });

  } catch (err: any) {
    console.error("Failed to establish server-side Gemini session:", err);
    clientWs.send(JSON.stringify({ type: "live_error", error: err?.message || String(err) }));
    clientWs.close();
    return;
  }

  clientWs.on("close", () => {
    console.log("Client disconnected from server-side Live WS proxy.");
    if (geminiSession) {
      try {
        geminiSession.close();
      } catch (e) {}
    }
  });
});

// Server upgrading connection to WebSocket
server.on("upgrade", (request, socket, head) => {
  const reqUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
  if (reqUrl.pathname === "/api/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});


// Setup Vite integration
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server bound to host 0.0.0.0 and port ${PORT}`);
  });
};

startServer();
