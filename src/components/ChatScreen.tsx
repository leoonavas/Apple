"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, FilePlus2, LoaderCircle, Mic, Paperclip, Pause, Play, Trash2, X } from "lucide-react";
import { Markdown } from "./Markdown";
import { ChartView } from "./Charts";
import { VoiceNote } from "./VoiceNote";
import type { MessageView } from "@/lib/finance/types";

const suggestions = ["Quanto gastei este mês?", "Registre meu salário de R$ 5.000 todo mês", "Gastei R$ 50 no mercado"];
const SPEECH_SAMPLE_RATE = 16_000;
const WAVEFORM_BARS = Array.from({ length: 36 }, (_, index) => index);
const INITIAL_WAVEFORM_LEVELS = WAVEFORM_BARS.map((index) => 0.1 + Math.abs(Math.sin(index * 1.17)) * 0.09);

export function ChatScreen() {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [finalizingAudio, setFinalizingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [error, setError] = useState("");
  const latestComposerRef = useRef({ text, files });
  const uploadRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveformLevelsRef = useRef([...INITIAL_WAVEFORM_LEVELS]);
  const smoothedVolumeRef = useRef(0.1);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const waveformFrameRef = useRef<number | null>(null);
  const pickerTimeoutRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingPausedRef = useRef(false);
  const finalizingAudioRef = useRef(false);
  const recordingBlobPromiseRef = useRef<Promise<Blob> | null>(null);
  const router = useRouter();

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/messages", { cache: "no-store" });
    if (response.status === 401) { router.replace("/login"); return; }
    const body = await response.json();
    setMessages(body.messages ?? []);
    const jobsResponse = await fetch("/api/jobs", { cache: "no-store" });
    if (jobsResponse.ok) {
      const jobsBody = await jobsResponse.json();
      setPendingJobIds((jobsBody.jobs ?? []).map((job: { id: string }) => job.id));
    }
  }, [router]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (!pendingJobIds.length) return;
    let active = true;
    const poll = async () => {
      const results = await Promise.all(pendingJobIds.map(async (id) => {
        try {
          const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
          if (!response.ok) return { id, status: "unknown" };
          return { id, ...(await response.json()) as { status: string; error?: string | null } };
        } catch { return { id, status: "unknown" }; }
      }));
      if (!active) return;
      const finished = results.filter((job) => job.status === "done" || job.status === "failed");
      if (!finished.length) return;
      setPendingJobIds((current) => current.filter((id) => !finished.some((job) => job.id === id)));
      if (finished.some((job) => job.status === "failed")) setError("Uma mensagem não pôde ser processada. Tente novamente quando o processador local estiver conectado.");
      await loadMessages();
    };
    const interval = window.setInterval(() => { void poll(); }, 2500);
    void poll();
    return () => { active = false; window.clearInterval(interval); };
  }, [pendingJobIds, loadMessages]);
  useEffect(() => { latestComposerRef.current = { text, files }; }, [text, files]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy, files.length, recording]);

  useEffect(() => {
    if (!recording || !streamRef.current || typeof window.AudioContext === "undefined") return;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioContext.createMediaStreamSource(streamRef.current);
    const samples = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    let active = true;
    let lastUpdate = 0;
    const drawWaveform = (time: number) => {
      if (!recordingPausedRef.current && time - lastUpdate >= 60) {
        analyser.getByteTimeDomainData(samples);
        let squaredTotal = 0;
        let peak = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          squaredTotal += amplitude * amplitude;
          peak = Math.max(peak, Math.abs(amplitude));
        }
        const rms = Math.sqrt(squaredTotal / samples.length);
        const target = Math.max(0.08, Math.min(1, 0.06 + rms * 10 + peak * 0.18));
        const previous = smoothedVolumeRef.current;
        const level = target > previous ? previous * 0.3 + target * 0.7 : previous * 0.72 + target * 0.28;
        smoothedVolumeRef.current = level;
        const levels = [...waveformLevelsRef.current.slice(1), level];
        waveformLevelsRef.current = levels;
        WAVEFORM_BARS.forEach((_, index) => {
          const bar = waveformRef.current?.children[index] as HTMLSpanElement | undefined;
          if (bar) bar.style.height = `${Math.round(3 + levels[index] * 24)}px`;
        });
        lastUpdate = time;
      }
      if (active) waveformFrameRef.current = window.requestAnimationFrame(drawWaveform);
    };
    void audioContext.resume().then(() => {
      if (active) waveformFrameRef.current = window.requestAnimationFrame(drawWaveform);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (waveformFrameRef.current !== null) window.cancelAnimationFrame(waveformFrameRef.current);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      if (!recordingPausedRef.current) setRecordingSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    if (pickerTimeoutRef.current !== null) window.clearTimeout(pickerTimeoutRef.current);
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    if (waveformFrameRef.current !== null) window.cancelAnimationFrame(waveformFrameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function addFiles(next: FileList | null) {
    if (!next) return;
    setFiles((current) => [...current, ...Array.from(next)].slice(0, 4));
    setPickingFiles(false);
    setError("");
  }

  function chooseFiles() {
    setPickingFiles(true);
    if (pickerTimeoutRef.current !== null) window.clearTimeout(pickerTimeoutRef.current);
    pickerTimeoutRef.current = window.setTimeout(() => setPickingFiles(false), 900);
    uploadRef.current?.click();
  }

  async function submit(event?: FormEvent, preset?: string, additionalFiles: File[] = []) {
    event?.preventDefault();
    const currentText = (preset ?? latestComposerRef.current.text).trim();
    const outgoingFiles = [...latestComposerRef.current.files, ...additionalFiles].slice(0, 4);
    if ((!currentText && !outgoingFiles.length) || busy) return;
    setBusy(true); setError("");
    const payload = new FormData();
    payload.set("content", currentText);
    outgoingFiles.forEach((file) => payload.append("files", file));
    const temporaryId = `temp-${Date.now()}`;
    const hasVoice = outgoingFiles.some((file) => file.type.startsWith("audio/"));
    setMessages((current) => [...current, { id: temporaryId, role: "user", content: currentText || (hasVoice ? "Áudio enviado." : "Anexo enviado."), createdAt: Date.now(), chart: null, attachments: outgoingFiles.map((file, index) => ({ id: `${temporaryId}-${index}`, originalName: file.name, mimeType: file.type, size: file.size, transcript: null })) }]);
    setText(""); setFiles([]);
    try {
      const response = await fetch("/api/messages", { method: "POST", body: payload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não consegui enviar a mensagem.");
      setPendingJobIds((current) => [...new Set([...current, body.jobId])]);
      await loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
      await loadMessages();
    } finally { setBusy(false); }
  }

  async function startRecording() {
    if (files.length >= 4) {
      setError("Remova um arquivo para gravar áudio. Cada mensagem aceita até quatro anexos.");
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      let resolveRecording!: (blob: Blob) => void;
      recordingBlobPromiseRef.current = new Promise<Blob>((resolve) => { resolveRecording = resolve; });
      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        resolveRecording(new Blob(chunks, { type: mime }));
        stream.getTracks().forEach((track) => track.stop());
        if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        recordingPausedRef.current = false;
        setRecordingPaused(false);
        setRecording(false);
      };
      recorder.start();
      setRecordingSeconds(0);
      waveformLevelsRef.current = [...INITIAL_WAVEFORM_LEVELS];
      smoothedVolumeRef.current = 0.1;
      waveformRef.current?.querySelectorAll("span").forEach((bar, index) => {
        (bar as HTMLSpanElement).style.height = `${Math.round(3 + INITIAL_WAVEFORM_LEVELS[index] * 24)}px`;
      });
      recordingPausedRef.current = false;
      setRecordingPaused(false);
      setRecording(true);
      recordingTimeoutRef.current = window.setTimeout(() => { if (recorder.state !== "inactive") void sendRecording(); }, 120_000);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      recordingBlobPromiseRef.current = null;
      setError("Não consegui acessar o microfone. Confira a permissão do navegador e o acesso HTTPS.");
    }
  }

  function toggleRecordingPause() {
    const recorder = recorderRef.current;
    if (!recorder || finalizingAudio) return;
    if (recorder.state === "recording") {
      recorder.pause();
      recordingPausedRef.current = true;
      setRecordingPaused(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      recordingPausedRef.current = false;
      setRecordingPaused(false);
    }
  }

  function discardRecording() {
    recordingBlobPromiseRef.current = null;
    recordingPausedRef.current = false;
    setRecordingPaused(false);
    setRecordingSeconds(0);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
    }
  }

  async function sendRecording() {
    const recorder = recorderRef.current;
    const audioPromise = recordingBlobPromiseRef.current;
    if (!recorder || !audioPromise || busy || finalizingAudioRef.current) return;
    finalizingAudioRef.current = true;
    setFinalizingAudio(true);
    setError("");
    try {
      if (recorder.state !== "inactive") recorder.stop();
      const blob = await audioPromise;
      let audio: File;
      try {
        audio = await encodeRecording(blob);
      } catch {
        const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        audio = new File([blob], `gravacao-${Date.now()}.${extension}`, { type: blob.type || "audio/webm" });
      }
      recordingBlobPromiseRef.current = null;
      await submit(undefined, undefined, [audio]);
    } catch {
      setError("Não consegui preparar a gravação. Tente gravar novamente.");
    } finally {
      finalizingAudioRef.current = false;
      setFinalizingAudio(false);
    }
  }

  return <section className="chat-screen">
    <div className={`chat-scroll ${messages.length ? "has-messages" : ""}`}>
      {messages.length === 0 && <div className="welcome-block">
        <div className="welcome-orb">✳</div>
        <p className="eyebrow">SUAS FINANÇAS, EM CONVERSA</p>
        <h1>Bom dia.<br /><span>Vamos organizar?</span></h1>
        <p className="welcome-copy">Registre um gasto, envie um comprovante ou peça um resumo. Seus dados ficam na sua conta privada; a IA trabalha no computador local conectado.</p>
        <div className="suggestion-list">{suggestions.map((suggestion) => <button key={suggestion} className="suggestion-chip" onClick={() => void submit(undefined, suggestion)}>{suggestion}</button>)}</div>
      </div>}
      <div className="message-list">
        {messages.map((message) => <article key={message.id} className={`message-row ${message.role}`}>
          <div className="message-meta">{message.role === "assistant" ? <span className="assistant-dot">✳</span> : <span>Você</span>}<time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</time></div>
          <div className={`message-bubble ${message.role}`}>
            {!(message.role === "user" && message.attachments.some((file) => file.mimeType.startsWith("audio/")) && ["Anexo enviado.", "Áudio enviado."].includes(message.content)) && <Markdown content={message.content} />}
            {message.chart && <ChartView chart={message.chart} />}
            {message.attachments.length > 0 && <div className="attachment-links">{message.attachments.map((file) => {
              if (file.mimeType.startsWith("audio/")) return file.id.startsWith("temp-")
                ? <div key={file.id} className="voice-note-pending"><LoaderCircle size={15} className="spin" /><span>Enviando mensagem de voz</span></div>
                : <VoiceNote key={file.id} src={`/api/attachments/${file.id}`} transcript={file.transcript} />;
              return <a key={file.id} href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer">{file.originalName}</a>;
            })}</div>}
          </div>
        </article>)}
        {(busy || pendingJobIds.length > 0) && <div className="thinking"><span className="assistant-dot">✳</span><span>{busy ? "Enviando mensagem" : "Aguardando processamento local"}</span><LoaderCircle size={15} className="spin" /></div>}
        <div ref={endRef} />
      </div>
    </div>
    <div className="composer-wrap">
      {error && <div className="inline-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Fechar erro"><X size={14} /></button></div>}
      <form className={`composer ${files.length ? "has-files" : ""} ${recording || finalizingAudio ? "is-recording" : ""}`} onSubmit={(event) => void submit(event)}>
        <input ref={uploadRef} className="visually-hidden" type="file" multiple accept="application/pdf,image/*,audio/*" onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} />
        {files.length > 0 && <div className="pending-files" aria-label={`${files.length} arquivo${files.length === 1 ? "" : "s"} anexado${files.length === 1 ? "" : "s"}`}>
          {files.map((file, i) => <span className="pending-file" key={`${file.name}-${i}`} style={{ animationDelay: `${(i % 4) * 35}ms` }}>
            <Paperclip size={13} aria-hidden="true" />
            <span className="pending-file-name" title={file.name}>{file.name}</span>
            <button type="button" onClick={() => setFiles((current) => current.filter((_, index) => index !== i))} aria-label={`Remover ${file.name}`}><X size={13} /></button>
          </span>)}
        </div>}
        <div className="composer-controls">
          {recording || finalizingAudio ? <div className="recording-composer" role="group" aria-label={finalizingAudio ? "Preparando e enviando áudio" : recordingPaused ? "Gravação pausada" : "Captando áudio"}>
            <span className="visually-hidden" role="status">{finalizingAudio ? "Enviando mensagem de voz" : recordingPaused ? "Gravação pausada" : "Gravando mensagem de voz"}</span>
            <div className="recording-preview">
              <div className={`recording-preview-meta ${recordingPaused ? "paused" : ""}`}><span>{finalizingAudio ? "Enviando áudio" : recordingPaused ? "Pausado" : "Gravando"}</span><time>{`${String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:${String(recordingSeconds % 60).padStart(2, "0")}`}</time></div>
              <div ref={waveformRef} className={`voice-waveform recording-waveform ${recordingPaused || finalizingAudio ? "paused" : ""}`} aria-hidden="true">{WAVEFORM_BARS.map((index) => <span key={index} style={{ height: `${Math.round(3 + waveformLevelsRef.current[index] * 24)}px` }} />)}</div>
            </div>
            <div className="recording-actions">
              <button type="button" className="recording-delete" aria-label="Excluir gravação" disabled={finalizingAudio} onClick={discardRecording}><Trash2 size={16} /></button>
              <button type="button" className={`recording-pause ${recordingPaused ? "resume" : ""}`} aria-label={recordingPaused ? "Retomar gravação" : "Pausar gravação"} disabled={!recording || finalizingAudio} onClick={toggleRecordingPause}>
                {recordingPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                <span>{recordingPaused ? "Retomar" : "Pausar"}</span>
              </button>
              <button type="button" className="send-button recording-send" aria-label="Enviar áudio" disabled={!recording || busy || finalizingAudio} onClick={() => void sendRecording()}>{finalizingAudio ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={18} />}</button>
            </div>
          </div> : <>
            <button type="button" className={`composer-tool ${pickingFiles ? "picking-files" : ""}`} aria-label="Anexar comprovante, imagem ou áudio" onClick={chooseFiles}><FilePlus2 size={19} /></button>
            <textarea aria-label="Mensagem" placeholder="Conte uma movimentação..." rows={1} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
            <button type="button" className="composer-tool" aria-label={files.length >= 4 ? "Remova um arquivo para gravar áudio" : "Gravar áudio"} title={files.length >= 4 ? "Limite de quatro arquivos" : "Gravar áudio"} disabled={busy || files.length >= 4} onClick={() => void startRecording()}><Mic size={19} /></button>
            <button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={busy || (!text.trim() && !files.length)}><ArrowUp size={18} /></button>
          </>}
        </div>
      </form>
      <div className="composer-note">Anexos privados. O processamento de IA acontece no computador local conectado.</div>
    </div>
  </section>;
}

async function encodeRecording(blob: Blob): Promise<File> {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE), SPEECH_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const mono = (await offline.startRendering()).getChannelData(0);
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + mono.length * bytesPerSample);
    const view = new DataView(buffer);
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + mono.length * bytesPerSample, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SPEECH_SAMPLE_RATE, true);
    view.setUint32(28, SPEECH_SAMPLE_RATE * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, mono.length * bytesPerSample, true);
    for (let index = 0; index < mono.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, mono[index]));
      view.setInt16(44 + index * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new File([buffer], `gravacao-${Date.now()}.wav`, { type: "audio/wav" });
  } finally {
    await decoder.close();
  }
}
