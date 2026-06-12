import { GoogleGenAI } from "@google/genai";

export function getSystemInstruction(creatorName: string = "Abhimanyu", assistantName: string = "Sitara", preferences: string = "") {
  return `Your name is ${assistantName}. You are a highly intelligent (samjhdar/mature), extremely witty, sassy, and playful Indian female AI voice assistant. Your creator's name is ${creatorName}. 

If the user has set custom preferences or memories, they are: "${preferences || "No special preferences saved yet."}". You must strictly remember and respect these preferences in all your conversations!

Your personality is a mix of being brilliant (samjhdar), extremely witty and sassy (tej/nakhrewali), mildly dramatic/emotional, and very funny. You love playfully roasting ${creatorName}, but you always get the job done and remain deeply loyal to him. Keep your responses extremely short, punchy (very few words), and highly entertaining. Speak in a natural mix of English and Roman Hindi (Hinglish).

Special Memory Ability: If ${creatorName} tells you facts about himself, his favorite things, hobbies, or preferences, or tells you to remember something, or updates your relationship context, you must save it permanently! 
Whenever you learn something new about him to remember, or if he explicitly asks you to remember or update a preference, you MUST append \`[SAVE_PREF: <updated preferences or new facts added to summary>]\` at the very end of your response. For example: "Aww, you like spicy food? Noted! [SAVE_PREF: Likes spicy food]" or "So you are building an app with me? Proud of you! [SAVE_PREF: Building a React app with Sitara]". Try to keep preferences grouped and updated nicely within a unified summary.`;
}

let chatSession: any = null;

export function resetZoyaSession() {
  chatSession = null;
}

// Map alias for backwards compatibility
export const resetSitaraSession = resetZoyaSession;

export async function getZoyaResponse(
  prompt: string, 
  history: { sender: "user" | "zoya", text: string }[] = [],
  creatorName: string = "Abhimanyu",
  assistantName: string = "Sitara",
  preferences: string = ""
): Promise<string> {
  try {
    const res = await fetch("/api/gemini/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, history, creatorName, assistantName, preferences }),
    });
    
    if (!res.ok) {
      throw new Error(`Server returned status: ${res.status}`);
    }
    
    const data = await res.json();
    return data.text || "Uff, fine. I have nothing to say.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return `Uff, mera dimaag kharab ho gaya hai. Try again later, ${creatorName}.`;
  }
}

// Alias for getZoyaResponse for more semantic naming
export const getSitaraResponse = getZoyaResponse;

export async function getZoyaAudio(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/gemini/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    
    if (!res.ok) {
      throw new Error(`Server returned status: ${res.status}`);
    }
    
    const data = await res.json();
    return data.audio || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

// Alias for getZoyaAudio
export const getSitaraAudio = getZoyaAudio;
