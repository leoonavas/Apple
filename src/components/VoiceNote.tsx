"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const bars = Array.from({ length: 36 }, (_, index) => Math.round(8 + Math.abs(Math.sin(index * 1.71) * Math.cos(index * 0.47)) * 18));

function formatTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function VoiceNote({ src, transcript }: { src: string; transcript: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play().catch(() => undefined);
    else audio.pause();
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, value));
    setCurrentTime(audio.currentTime);
  }

  return <div className="voice-note-stack">
    <div className="voice-note">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-hidden="true"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />
      <button type="button" className="voice-note-play" aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"} onClick={() => void togglePlayback()}>
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <div className="voice-note-content">
        <div className="voice-note-waveform" aria-hidden="true">
          {bars.map((height, index) => <span key={index} className={index / bars.length <= progress ? "played" : ""} style={{ height }} />)}
          <input type="range" min="0" max={duration || 0.01} step="0.1" value={Math.min(currentTime, duration)} aria-label="Posição da mensagem de voz" onChange={(event) => seek(Number(event.currentTarget.value))} />
        </div>
        <div className="voice-note-meta"><time>{formatTime(currentTime || duration)}</time><span>Mensagem de voz</span></div>
      </div>
    </div>
    <div className="voice-note-transcript">
      <span>Transcrição</span>
      <p>{transcript?.trim() || "Não foi possível transcrever este áudio."}</p>
    </div>
  </div>;
}
