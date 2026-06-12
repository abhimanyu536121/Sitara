import React from "react";
import { motion } from "motion/react";
import { ShieldAlert, ExternalLink, Lock } from "lucide-react";

interface Props {
  error: string;
  onClose: () => void;
}

export default function AuthErrorModal({ error, onClose }: Props) {
  // Extract project ID if present or use a sensible placeholder
  const projectId = "bustling-decker-npnh2";
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-xl bg-[#090f14]/95 border border-cyan-500/20 rounded-3xl p-8 shadow-2xl flex flex-col relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500" />
        
        {/* Decorative corner glow */}
        <div className="absolute top-[-20%] right-[-10%] w-[35%] h-[35%] bg-cyan-500/10 blur-3xl rounded-full" />
        
        <div className="flex gap-4 items-start mb-6 border-b border-white/5 pb-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <ShieldAlert size={24} />
          </div>
          <div>
            <h2 className="text-xl font-serif font-bold text-white tracking-wide">Secure Sync Failure</h2>
            <p className="text-xs text-zinc-400 font-mono mt-1 pr-6 truncate" title={error}>
              Error details: <span className="text-red-400">{error}</span>
            </p>
          </div>
        </div>

        <div className="text-zinc-300 text-sm mb-6 leading-relaxed flex flex-col gap-3">
          <p>
            Standard browsers block <strong className="text-cyan-300">cross-site authorization cookies</strong> when websites run inside iframes. Since the AI Studio preview embeds this app in an iframe, Google Sign-In is blocked by your browser's partition rules.
          </p>
        </div>
        
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5 w-full mb-6">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Lock size={14} className="text-cyan-400" />
            <span>Resolutions to sync database:</span>
          </h3>
          
          <ul className="text-xs text-zinc-400 space-y-4">
            <li className="flex gap-2.5 items-start">
              <span className="w-5 h-5 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-mono text-[10px] text-cyan-300 shrink-0 mt-0.5">1</span>
              <div>
                <strong className="text-white block font-medium">Launch in a Standalone Tab (easiest & fastest)</strong>
                Click the <strong className="text-cyan-400">"Open in new tab"</strong> button at the top-right of the AI Studio preview window. Logging in will work immediately in a standard standalone window!
              </div>
            </li>
            
            <li className="flex gap-2.5 items-start">
              <span className="w-5 h-5 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-mono text-[10px] text-cyan-300 shrink-0 mt-0.5">2</span>
              <div>
                <strong className="text-white block font-medium">Enable Firebase Authorized Domains</strong>
                Make sure this app domain's hostname is allowlisted in the Firebase Console:
                <a 
                  href={`https://console.firebase.google.com/project/${projectId}/authentication/providers`}
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-1 text-cyan-400 hover:underline mt-1 bg-cyan-950/40 border border-cyan-500/10 px-2 py-0.5 rounded-md"
                >
                  Authorized domains settings <ExternalLink size={10} />
                </a>
              </div>
            </li>

            <li className="flex gap-2.5 items-start">
              <span className="w-5 h-5 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-mono text-[10px] text-cyan-300 shrink-0 mt-0.5">3</span>
              <div>
                <strong className="text-white block font-medium">Full Offline Engine fallback</strong>
                No connection? No problem! Your dynamic assistant memories, preferences, and custom settings still save perfectly in your local browser storage.
              </div>
            </li>
          </ul>
        </div>
        
        <div className="flex gap-3 mt-2">
          <button 
            type="button"
            onClick={() => {
              // Open in new tab
              window.open(window.location.href, "_blank");
            }}
            className="flex-1 py-3 px-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-black font-semibold rounded-xl transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
          >
            <ExternalLink size={16} />
            <span>Open in New Tab Now</span>
          </button>
          
          <button 
            type="button"
            onClick={onClose}
            className="px-6 py-3 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white font-medium rounded-xl transition-colors font-mono text-xs border border-white/10 active:scale-[0.98]"
          >
            Dismiss
          </button>
        </div>
      </motion.div>
    </div>
  );
}
