import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Mic, 
  MicOff, 
  Loader2, 
  Volume2, 
  VolumeX, 
  Keyboard, 
  Send, 
  Trash2, 
  Settings, 
  LogIn, 
  LogOut, 
  Sparkles, 
  X, 
  Check, 
  Database 
} from "lucide-react";
import { 
  getSitaraResponse, 
  getSitaraAudio, 
  resetSitaraSession 
} from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import AuthErrorModal from "./components/AuthErrorModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";

// Firebase Imports
import { 
  auth, 
  db, 
  handleFirestoreError, 
  OperationType 
} from "./lib/firebase";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  writeBatch
} from "firebase/firestore";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "zoya"; // zoya alias for assistant in visual UI
  text: string;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);

  // User auth state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Profile preferences (Default to Abhimanyu and Sitara)
  const [creatorName, setCreatorName] = useState(() => localStorage.getItem("sitara_creator_name") || "Abhimanyu");
  const [assistantName, setAssistantName] = useState(() => localStorage.getItem("sitara_assistant_name") || "Sitara");
  const [preferences, setPreferences] = useState(() => localStorage.getItem("sitara_preferences") || "");

  // Settings UI
  const [showSettings, setShowSettings] = useState(false);
  const [tempCreator, setTempCreator] = useState(creatorName);
  const [tempAssistant, setTempAssistant] = useState(assistantName);
  const [tempPrefs, setTempPrefs] = useState(preferences);

  // Success Memory update notification state
  const [memoryNotification, setMemoryNotification] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cache history state in Ref
  useEffect(() => {
    messagesRef.current = messages;
    if (!currentUser) {
      localStorage.setItem("zoya_chat_history", JSON.stringify(messages));
    }
  }, [messages, currentUser]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthLoading(true);
      
      if (user) {
        // Load settings & database history
        try {
          const profileDocRef = doc(db, "profiles", user.uid);
          const profileSnap = await getDoc(profileDocRef);
          
          if (profileSnap.exists()) {
            const data = profileSnap.data();
            setCreatorName(data.creatorName || "Abhimanyu");
            setAssistantName(data.assistantName || "Sitara");
            setPreferences(data.preferences || "");
            
            // Sync temp settings
            setTempCreator(data.creatorName || "Abhimanyu");
            setTempAssistant(data.assistantName || "Sitara");
            setTempPrefs(data.preferences || "");
          } else {
            // Document doesn't exist yet, save current local preferences as initial
            await setDoc(profileDocRef, {
              uid: user.uid,
              creatorName: creatorName,
              assistantName: assistantName,
              preferences: preferences,
              updatedAt: serverTimestamp()
            });
          }

          // Fetch past messages from Firestore subcollection for this user
          const messagesColRef = collection(db, `profiles/${user.uid}/messages`);
          const q = query(messagesColRef, orderBy("timestamp", "asc"), limit(50));
          const querySnap = await getDocs(q);
          const historicalMessages: ChatMessage[] = [];
          
          querySnap.forEach((doc) => {
            const data = doc.data();
            historicalMessages.push({
              id: data.id,
              sender: data.sender === "sitara" ? "zoya" : "user",
              text: data.text
            });
          });

          if (historicalMessages.length > 0) {
            setMessages(historicalMessages);
          } else {
            // Load messages from local storage if db is empty on first login
            const saved = localStorage.getItem("zoya_chat_history");
            if (saved) {
              try {
                const parsed = JSON.parse(saved);
                setMessages(parsed);
                // Bulk save to firestore in background
                const batch = writeBatch(db);
                parsed.forEach((m: ChatMessage) => {
                  const mId = m.id;
                  const mRef = doc(db, `profiles/${user.uid}/messages`, mId);
                  batch.set(mRef, {
                    id: mId,
                    sender: m.sender === "zoya" ? "sitara" : "user",
                    text: m.text,
                    timestamp: serverTimestamp(),
                    uid: user.uid
                  });
                });
                await batch.commit();
              } catch (e) {
                console.error("Local storage migrate fail:", e);
              }
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `profiles/${user.uid}`);
        }
      } else {
        // Load offline chat history
        const saved = localStorage.getItem("zoya_chat_history");
        if (saved) {
          try {
            setMessages(JSON.parse(saved));
          } catch (e) {
            console.error("Failed parsing guest voice history", e);
          }
        }
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const [authError, setAuthError] = useState<string | null>(null);

  // Google Login action
  const handleGoogleLogin = async () => {
    try {
      setAuthError(null);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      console.error("Google login failed:", e);
      const code = e?.code || "";
      const message = e?.message || "";
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request" ||
        message.includes("popup-closed-by-user") ||
        message.includes("cancelled-popup-request")
      ) {
        // Log gently and return, as the user manually closed the popup
        console.log("User closed or cancelled the login popup.");
        return;
      }
      setAuthError(e?.message || String(e));
    }
  };

  // Logout action
  const handleLogout = async () => {
    try {
      if (confirm("Disconnect database sync?")) {
        await signOut(auth);
        setMessages([]);
        resetSitaraSession();
      }
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  // Helper inside memory parsing to sync updates to storage
  const persistPreferences = async (newPrefs: string, forceCreator: string = creatorName, forceAssistant: string = assistantName) => {
    setPreferences(newPrefs);
    setTempPrefs(newPrefs);
    
    if (currentUser) {
      try {
        const profileDocRef = doc(db, "profiles", currentUser.uid);
        await setDoc(profileDocRef, {
          uid: currentUser.uid,
          creatorName: forceCreator,
          assistantName: forceAssistant,
          preferences: newPrefs,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `profiles/${currentUser.uid}`);
      }
    } else {
      localStorage.setItem("sitara_preferences", newPrefs);
    }
  };

  // Memory tag extraction engine
  const parseMemoryAndAddMessage = useCallback(async (sender: "user" | "zoya", fullText: string) => {
    let cleanedText = fullText;
    const savePrefRegex = /\[SAVE_PREF:\s*([^\]]+)\]/i;
    const match = fullText.match(savePrefRegex);

    if (match && match[1]) {
      const detectedPreference = match[1].trim();
      cleanedText = fullText.replace(savePrefRegex, "").trim();

      // Update preference block (accumulate memories)
      const currentMemories = preferences ? preferences.split(";").map(p => p.trim()).filter(Boolean) : [];
      if (!currentMemories.includes(detectedPreference)) {
        currentMemories.push(detectedPreference);
        const aggregatedMemory = currentMemories.join("; ");
        
        // Persist preferences
        await persistPreferences(aggregatedMemory);

        // Visual confirmation toast
        setMemoryNotification(detectedPreference);
        setTimeout(() => {
          setMemoryNotification(null);
        }, 5000);
      }
    }

    const messageId = Date.now().toString() + "-" + (sender === "zoya" ? "sitara" : "user");
    
    // Save to Firestore if authenticated
    if (currentUser) {
      try {
        const messageRef = doc(db, `profiles/${currentUser.uid}/messages`, messageId);
        await setDoc(messageRef, {
          id: messageId,
          sender: sender === "zoya" ? "sitara" : "user",
          text: cleanedText,
          timestamp: serverTimestamp(),
          uid: currentUser.uid
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `profiles/${currentUser.uid}/messages/${messageId}`);
      }
    }

    setMessages((prev) => [...prev, { id: messageId, sender, text: cleanedText }]);
    return cleanedText;
  }, [currentUser, preferences, creatorName, assistantName]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    // Write user message to DB & State
    await parseMemoryAndAddMessage("user", finalTranscript);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      await parseMemoryAndAddMessage("zoya", responseText);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSitaraAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. Chat with Memory Engine via Gemini
      responseText = await getSitaraResponse(
        finalTranscript, 
        messagesRef.current, 
        creatorName, 
        assistantName, 
        preferences
      );
      
      const cleanedReponse = await parseMemoryAndAddMessage("zoya", responseText);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getSitaraAudio(cleanedReponse);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, creatorName, assistantName, preferences, parseMemoryAndAddMessage]);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetSitaraSession();
    } else {
      try {
        setIsSessionActive(true);
        resetSitaraSession();
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onMessage = async (sender, text) => {
          const uiSender = sender === "sitara" ? "zoya" : "user";
          await parseMemoryAndAddMessage(uiSender, text);
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        await session.start(creatorName, assistantName, preferences);
      } catch (e: any) {
        const errorMsg = String(e);
        const isExpectedMicError = 
          e?.name === "NotAllowedError" || 
          e?.name === "NotFoundError" || 
          e?.name === "PermissionDeniedError" || 
          errorMsg.includes("Permission denied") || 
          errorMsg.includes("Requested device not found") ||
          errorMsg.includes("DevicesNotFoundError");

        if (isExpectedMicError) {
          console.warn("Session could not access microphone (blocked or no device found):", e);
        } else {
          console.error("Failed to start session:", e);
        }
        setShowPermissionModal(true);
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const formattedCreator = tempCreator.trim() || "Abhimanyu";
    const formattedAssistant = tempAssistant.trim() || "Sitara";
    
    setCreatorName(formattedCreator);
    setAssistantName(formattedAssistant);
    
    localStorage.setItem("sitara_creator_name", formattedCreator);
    localStorage.setItem("sitara_assistant_name", formattedAssistant);

    await persistPreferences(tempPrefs, formattedCreator, formattedAssistant);
    
    setShowSettings(false);
    resetSitaraSession();
  };

  const clearChatHistory = async () => {
    if (confirm("Are you sure you want to clear your chat history?")) {
      if (currentUser) {
        try {
          const batch = writeBatch(db);
          const messagesColRef = collection(db, `profiles/${currentUser.uid}/messages`);
          const querySnap = await getDocs(messagesColRef);
          querySnap.forEach((doc) => {
            batch.delete(doc.ref);
          });
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `profiles/${currentUser.uid}/messages`);
        }
      } else {
        localStorage.removeItem("zoya_chat_history");
      }
      setMessages([]);
      resetSitaraSession();
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#02080a] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {authError && (
        <AuthErrorModal
          error={authError}
          onClose={() => setAuthError(null)}
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-cyan-900/10 blur-[120px] rounded-full" />
      </div>

      {/* Dynamic Memory Success Toast Notification */}
      <AnimatePresence>
        {memoryNotification && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 16, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gradient-to-r from-cyan-950 to-blue-950 border border-cyan-500/30 px-5 py-3 rounded-2xl shadow-xl backdrop-blur-xl"
          >
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Sparkles size={16} className="animate-pulse" />
            </div>
            <div>
              <div className="text-xs text-white/50 font-mono tracking-wider uppercase">Memory Saved</div>
              <div className="text-sm font-semibold text-cyan-300">{memoryNotification}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 flex items-center justify-center font-bold text-sm shadow-lg text-black">
            {assistantName[0]}
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">{assistantName}</h1>
            <span className="text-[10px] font-mono opacity-40">Creator: {creatorName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Cloud Sync Database Indicators */}
          {currentUser ? (
            <div 
              className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full text-xs font-mono"
              title={`Logged in as ${currentUser.displayName || currentUser.email}`}
            >
              <Database size={12} className="animate-pulse" />
              <span>Synced</span>
            </div>
          ) : (
            <button
              onClick={handleGoogleLogin}
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full text-xs transition-all font-mono"
              title="Sign in with Google to enable permanent assistant brain sync"
            >
              <LogIn size={12} />
              <span>Offline</span>
            </button>
          )}

          {/* Action buttons */}
          {messages.length > 0 && (
            <button
              onClick={clearChatHistory}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>

          <button
            onClick={() => {
              setTempCreator(creatorName);
              setTempAssistant(assistantName);
              setTempPrefs(preferences);
              setShowSettings(true);
            }}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title="Sitara Settings & Memories"
          >
            <Settings size={18} className="opacity-70" />
          </button>

          {currentUser && (
            <button
              onClick={handleLogout}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/10 hover:text-red-400 transition-colors border border-white/10"
              title="Sign Out"
            >
              <LogOut size={18} className="opacity-70" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content - Visualizer & Chat Logs */}
      <main className="absolute inset-0 flex flex-col md:flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-24 pb-28 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Logged messages or activity */}
        <div className="flex w-full md:w-[35%] h-[40dvh] md:h-full flex-col justify-end z-10 pointer-events-auto">
          <div className="w-full text-left font-mono text-[10px] text-zinc-500 mb-2 border-b border-zinc-800 pb-1 flex items-center justify-between">
            <span>MUTUAL DIALOGUE LOG</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
              ACTIVE
            </span>
          </div>
          <div className="w-full h-full overflow-y-auto scrollbar-hide flex flex-col gap-3 pr-2 scroll-smooth">
            {messages.length === 0 ? (
              <div className="my-auto text-zinc-600 flex flex-col gap-1 items-center justify-center p-4 text-center font-mono text-xs">
                <Sparkles size={24} className="opacity-20 animate-spin text-cyan-400 duration-10000 mb-2" />
                <span>Sitara database initialized.</span>
                <span>Type some guidelines or say Hello!</span>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col max-w-[85%] ${
                    message.sender === "user" ? "self-end items-end" : "self-start items-start"
                  }`}
                >
                  <span className="text-[9px] font-mono text-zinc-500 mb-0.5">
                    {message.sender === "user" ? creatorName : assistantName}
                  </span>
                  <div
                    className={`px-3 py-2 rounded-2xl text-xs md:text-sm font-sans tracking-wide leading-relaxed shadow-md ${
                      message.sender === "user"
                        ? "bg-gradient-to-r from-cyan-950 to-blue-900 border border-cyan-700/30 text-cyan-100 rounded-br-none"
                        : "bg-zinc-900/80 border border-zinc-800 text-zinc-200 rounded-bl-none"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} assistantName={assistantName} />
        </div>

        {/* Right Column: Assistant Status indicators */}
        <div className="flex w-full md:w-[35%] h-[15dvh] md:h-full flex-col justify-center gap-4 z-10 select-none">
          <div className="h-12 flex flex-col justify-center items-center md:items-end font-mono">
            <AnimatePresence mode="wait">
              {appState === "processing" ? (
                <motion.div
                  key="rep"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-400 italic text-sm"
                >
                  <Loader2 size={14} className="animate-spin text-cyan-400" />
                  <span>{assistantName.toUpperCase()} RECALLS...</span>
                </motion.div>
              ) : appState === "listening" ? (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-blue-400 animate-pulse text-sm"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
                  <span>LISTENING TO {creatorName.toUpperCase()}...</span>
                </motion.div>
              ) : appState === "speaking" ? (
                <motion.div
                  key="speak"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-indigo-400 italic text-sm"
                >
                  <Volume2 size={14} className="animate-bounce" />
                  <span>{assistantName.toUpperCase()} VOCALIZING...</span>
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 0.3, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-zinc-400 italic text-sm"
                >
                  <span>{assistantName.toUpperCase()} DEEP ENGINE SLEEP</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </main>

      {/* Settings Panel & Memories Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 w-full h-full bg-black/80 backdrop-blur-md z-40 flex items-center justify-center p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-zinc-950/90 border border-zinc-800 max-w-lg w-full rounded-2xl p-6 shadow-2xl relative"
            >
              <button 
                onClick={() => setShowSettings(false)}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3 mb-6">
                <Settings className="text-cyan-400" size={24} />
                <h2 className="text-lg font-serif font-bold">Preferences & Dynamic Memories</h2>
              </div>

              <form onSubmit={handleSaveSettings} className="flex flex-col gap-4 font-sans">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Creator Name</label>
                  <input 
                    type="text"
                    value={tempCreator}
                    onChange={(e) => setTempCreator(e.target.value)}
                    placeholder="Abhimanyu"
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                    maxLength={50}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Assistant Name</label>
                  <input 
                    type="text"
                    value={tempAssistant}
                    onChange={(e) => setTempAssistant(e.target.value)}
                    placeholder="Sitara"
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/50"
                    maxLength={50}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Memories & Preferences (Semicolon-Separated)</label>
                    <span className="text-[10px] text-cyan-400 font-mono">Dynamic database</span>
                  </div>
                  <textarea 
                    value={tempPrefs}
                    onChange={(e) => setTempPrefs(e.target.value)}
                    placeholder="e.g. Loves design; Builds coding applications; Drinks green tea"
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white min-h-[100px] max-h-[160px] focus:outline-none focus:border-cyan-500/50 font-mono text-xs"
                    maxLength={2000}
                  />
                </div>

                {/* Cloud storage note */}
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 text-xs text-white/70 flex gap-2.5 items-start">
                  <Sparkles size={16} className="text-cyan-400 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-cyan-300 font-mono text-[10px] tracking-wider uppercase">Self-Memory Engine</span>
                    <span>Sitara updates this memory list in real-time during conversations when she learns things about you!</span>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-4">
                  <button 
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="px-4 py-2 rounded-xl text-xs hover:bg-white/5 text-zinc-400 hover:text-white transition-all font-mono"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-semibold rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-cyan-500/20 active:scale-95 transition-all"
                  >
                    <Check size={14} />
                    <span>Save Core Profile</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls Footer */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl pointer-events-auto"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Type a message to ${assistantName}...`}
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm font-sans"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 disabled:hover:bg-cyan-500 transition-colors text-black"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4 pointer-events-auto">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Realtime Voice</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Realtime Voice</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
              title="Type instead"
            >
              <Keyboard size={20} className="opacity-70" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
