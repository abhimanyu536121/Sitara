export class LiveSessionManager {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isStopped: boolean = false;
  
  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "sitara", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};

  constructor() {
    // No direct GoogleGenAI instantiation in browser, proxying everything through Express
  }

  async start(creatorName: string = "Abhimanyu", assistantName: string = "Sitara", preferences: string = "") {
    try {
      this.isStopped = false;
      this.onStateChange("processing");
      
      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;

      // Get Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });

      if (this.isStopped) {
        stream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
        return;
      }

      this.mediaStream = stream;
      if (!this.audioContext) {
        throw new Error("Audio Context is not initialized or was closed.");
      }

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true);
        }
        
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        this.ws.send(JSON.stringify({
          type: "realtime_input",
          audio: base64Data
        }));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect to Server-Side WebSocket Live API Proxy
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const queryParams = `?creatorName=${encodeURIComponent(creatorName)}&assistantName=${encodeURIComponent(assistantName)}&preferences=${encodeURIComponent(preferences)}`;
      const wsUrl = `${protocol}//${window.location.host}/api/live${queryParams}`;
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("WebSocket connection to server-side Live Proxy opened.");
      };

      this.ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === "live_connected") {
            console.log("Live session connected through proxy");
            this.onStateChange("listening");
          } else if (payload.type === "live_message") {
            const message = payload.message;
            
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              this.onStateChange("speaking");
              this.playAudioChunk(base64Audio);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              this.stopPlayback();
              this.onStateChange("listening");
            }

            // Handle Transcriptions
            const userText = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (userText) {
               // Output transcription
               this.onMessage("sitara", userText);
            }

            // Handle Function Calls (relayed by proxy but executed locally in browser context)
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              for (const call of functionCalls) {
                if (call.name === "executeBrowserAction") {
                  const args = call.args as any;
                  let url = "";
                  if (args.actionType === "youtube") {
                    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "spotify") {
                    url = `https://open.spotify.com/search/${encodeURIComponent(args.query)}`;
                  } else if (args.actionType === "whatsapp") {
                    url = `https://web.whatsapp.com/send?phone=${args.target || ''}&text=${encodeURIComponent(args.query)}`;
                  } else {
                    let website = args.query.replace(/\s+/g, "");
                    if (!website.includes(".")) website += ".com";
                    url = `https://www.${website}`;
                  }
                  
                  this.onCommand(url);
                  
                  // Send tool response back through the WebSocket proxy
                  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                      type: "tool_response",
                      data: {
                        functionResponses: [{
                          name: call.name,
                          id: call.id,
                          response: { result: "Action executed successfully in the browser." }
                        }]
                      }
                    }));
                  }
                }
              }
            }
          } else if (payload.type === "live_error") {
            console.error("Live API Error received from server proxy:", payload.error);
            this.stop();
          }
        } catch (e) {
          console.error("Error handling server-side WS proxy message:", e);
        }
      };

      this.ws.onclose = () => {
        console.log("WebSocket connection to server-side Live Proxy closed.");
        this.stop();
      };

      this.ws.onerror = (err) => {
        console.error("WebSocket Proxy Connection error:", err);
        this.stop();
      };

    } catch (error: any) {
      const errorMsg = String(error);
      const isExpectedMicError = 
        error?.name === "NotAllowedError" || 
        error?.name === "NotFoundError" || 
        error?.name === "PermissionDeniedError" || 
        errorMsg.includes("Permission denied") || 
        errorMsg.includes("Requested device not found") ||
        errorMsg.includes("DevicesNotFoundError");

      if (isExpectedMicError) {
        console.warn("Microphone access or device unavailable. Safe fallback triggered:", error);
      } else {
        console.error("Failed to start Live Session:", error);
      }
      this.stop();
      throw error;
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;
    
    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = new Int16Array(bytes.buffer);
      const audioBuffer = this.playbackContext.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }
      
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      
      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      
      source.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  private stopPlayback() {
    if (this.playbackContext) {
      try {
        this.playbackContext.close();
      } catch (e) {}
      if (this.isStopped) {
        this.playbackContext = null;
        this.isPlaying = false;
        return;
      }
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;
      this.isPlaying = false;
    }
  }

  stop() {
    this.isStopped = true;
    if (this.processor) {
      try { this.processor.disconnect(); } catch (e) {}
      this.processor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      this.mediaStream = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
    this.stopPlayback();
    
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    
    this.onStateChange("idle");
  }

  sendText(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "realtime_input_text",
        text
      }));
    }
  }
}
